# Design: Column-aware "Build with AI" prompts

**Date:** 2026-06-02
**Feature:** column-aware-ai-prompts
**Priority:** High
**Labels:** ai, ux, configuration

---

## Problem

`_startWithAI` in `KanbanPanel.ts` always sends the same prompt — `"Implement this feature: …"` — regardless of which column the feature is in. A card in `review` needs a code-review instruction; a card in `backlog` needs a research/planning instruction. The mismatch makes the AI response less useful without manual prompt editing.

---

## Solution overview

Introduce a three-level prompt resolution chain, identical `.md` template format at every level:

| Priority | Source | Who controls it |
|---|---|---|
| 1 (highest) | `.kanban/instructions/{columnId}.md` | Project team (committed to repo — `.kanban/` is not git-ignored) |
| 2 | `prompt` field on column in `kanban-markdown.columns` VS Code setting | Individual user |
| 3 (lowest) | `prompts/{columnId}.md` bundled with extension | Extension defaults (editable in source) |

If no level produces a non-blank template, a generic inline fallback is used.

`{{filePath}}` behaviour: check the **raw template** for the literal string `{{filePath}}` before any substitution. If present, substitute it in place along with other variables. If absent, append `\nSee full details in: {filePath}` after all substitutions. This single pre-check prevents double-appending.

**`{{filePath}}` privacy note:** `{{filePath}}` expands to an absolute local path. This is no change in privacy posture from the current implementation, which already appends `See full details in: ${feature.filePath}` unconditionally. The path is passed as a CLI argument to a local agent process; whether that agent transmits it externally depends on the agent and its configuration — the same consideration that applies today.

---

## Template variables

| Variable | Rendered value |
|---|---|
| `{{title}}` | Feature title from first `# heading`; falls back to `getTitleFromContent(content)` |
| `{{priority}}` | Exact priority string: `critical`, `high`, `medium`, or `low` |
| `{{status}}` | Column ID as-is, e.g. `in-progress` |
| `{{columnName}}` | Column display name, e.g. `In Progress` |
| `{{labels}}` | ` [label1, label2]` (leading space + brackets) when labels exist; empty string when none |
| `{{description}}` | Normalized content: newlines → spaces, whitespace collapsed, trimmed, truncated at 200 chars with `...` if truncated |
| `{{filePath}}` | Absolute path to the feature file |

**`{{labels}}` note:** the leading space is baked in so templates can write `({{priority}} priority){{labels}}.` and get `(high priority) [bug].` or `(high priority).` without extra spacing.

**`{{status}}` / column ID note:** `buildPrompt` must handle any runtime `column.id` value — including the five built-in `FeatureStatus` values, custom column IDs from `kanban-markdown.columns`, and arbitrary status strings preserved in existing feature files. For column IDs with no matching `.kanban/instructions/` file, no settings `prompt`, and no bundled `prompts/{id}.md`, the generic fallback applies. Tests must include at least one case with a non-default column ID to verify the fallback path.

**`{{description}}` note:** computed inside `buildPrompt` from raw `content` via `content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()`, truncated at 200 chars with ASCII `...`. Callers pass raw content — description normalization belongs exclusively in `buildPrompt`.

---

## Bundled defaults (`prompts/`)

Five files ship with the extension. These are editable markdown files in source — no code change needed to adjust wording.

**`prompts/backlog.md`**
```
Research and plan an approach for: "{{title}}" ({{priority}} priority){{labels}}. {{description}}
```

**`prompts/todo.md`**
```
Implement this feature: "{{title}}" ({{priority}} priority){{labels}}. {{description}}
```

**`prompts/in-progress.md`**
```
Continue implementing: "{{title}}" ({{priority}} priority){{labels}}. Pick up where work left off. {{description}}
```

**`prompts/review.md`**
```
Review this implementation for correctness, edge cases, and code quality: "{{title}}"{{labels}}. {{description}}
```

**`prompts/done.md`**
```
Write tests and documentation for: "{{title}}"{{labels}}. {{description}}
```

---

## Architecture

### New type: `PromptContext` and module `src/extension/ai/promptBuilder.ts`

`buildPrompt` accepts a dedicated `PromptContext` type. Callers construct it directly — no `Feature` object required, no unsafe casting.

```ts
import type { Priority, FeatureStatus } from '../../shared/types'

export interface PromptContext {
  title: string
  status: FeatureStatus   // 'backlog' | 'todo' | 'in-progress' | 'review' | 'done'
  priority: Priority      // 'critical' | 'high' | 'medium' | 'low'
  labels: string[]
  content: string         // raw feature content — buildPrompt normalizes description from this
  filePath: string
}

export function buildPrompt(
  ctx: PromptContext,
  column: KanbanColumn,
  extensionRoot: string,         // extensionUri.fsPath
  workspaceRoot: string | null,  // null when no workspace folder contains this file
  settingsTemplate?: string
): string
```

**Template emptiness rule:** a template is treated as absent (falls through to the next level) if it is `undefined`, an empty string, or a string whose `.trim()` is empty. Whitespace-only templates cannot shadow bundled defaults.

**Resolution order inside `buildPrompt`:**
1. If `workspaceRoot` is non-null: try safe-resolved `.kanban/instructions/{column.id}.md` — read synchronously, skip if absent, unsafe, or blank after trim
2. Use `settingsTemplate` if non-blank after trim
3. Try `{extensionRoot}/prompts/{column.id}.md` — read synchronously, skip if absent or blank after trim
4. Return generic fallback: `Implement this feature: "{{title}}" ({{priority}} priority){{labels}}. {{description}}`

After resolving the template, substitute all `{{variable}}` placeholders. Then apply the `{{filePath}}` rule.

### Safe local-file resolution

The local override lookup is skipped entirely when `workspaceRoot` is `null`.

When `workspaceRoot` is present, the candidate path is validated in two stages — both wrapped in a single try/catch so any error (directory absent, file absent, permission denied) falls through silently:

**Stage 0 — column ID character validation** (rejects IDs that cannot be safe filenames on any platform):
```ts
const SAFE_ID = /^[a-zA-Z0-9_\-.]+$/
if (!SAFE_ID.test(column.id)) {
  // ID contains spaces, path separators, colons, or other platform-unsafe chars — skip lookup
  return null
}
```
This accepts the five built-in IDs (`backlog`, `todo`, `in-progress`, `review`, `done`) and typical user-defined IDs. IDs containing `/`, `\`, `:`, `<`, `>`, `|`, `?`, `*`, or whitespace are skipped silently and fall through to the settings/default chain. Tests must cover: a valid ID (`in-progress`), a traversal attempt (`../secret`), a Windows path separator (`foo\bar`), and a colon (`my:column`).

**Stage 1 — path traversal check** (belt-and-suspenders after Stage 0):
```ts
const instructionsDir = path.resolve(workspaceRoot, '.kanban', 'instructions')
const candidate = path.resolve(instructionsDir, column.id + '.md')
const rel = path.relative(instructionsDir, candidate)
const isSafe = rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
```

Both `instructionsDir` and `candidate` are produced by `path.resolve` from the same root. On case-insensitive filesystems (macOS, Windows), `path.resolve` returns OS-native casing for both — so `path.relative` compares byte-for-byte consistent strings and the traversal check is correct.

**Stage 2 — symlink resolution** (rejects symlinks pointing outside the directory):
```ts
try {
  const realInstructionsDir = fs.realpathSync(instructionsDir)
  const realCandidate = fs.realpathSync(candidate)
  const realRel = path.relative(realInstructionsDir, realCandidate)
  if (!realRel.startsWith('..') && !path.isAbsolute(realRel)) {
    template = fs.readFileSync(realCandidate, 'utf8')
  }
  // else: symlink escapes the directory — skip silently
} catch {
  // Directory or file absent, unreadable, or broken symlink — skip silently
}
```

### Changes to `KanbanPanel._startWithAI`

`KanbanPanel._startWithAI` is the only currently-registered `startWithAI` entry point. `FeatureHeaderProvider` contains a duplicate handler that is not yet registered, but it is updated in this same change to prevent prompt divergence if it is activated later — it shares the same `buildPrompt` call.

Reads `kanban-markdown.columns` fresh from VS Code config on each call — no cache. Workspace root is derived from the feature file's containing workspace folder, not `workspaceFolders[0]`:

```ts
const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))
const workspaceRoot = workspaceFolder?.uri.fsPath ?? null  // null → skip .kanban/ lookup

const config = vscode.workspace.getConfiguration('kanban-markdown')
const columns = config.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
const column = columns.find(c => c.id === feature.status)
  ?? { id: feature.status, name: feature.status, color: '' }

const titleMatch = feature.content.match(/^#\s+(.+)$/m)
const ctx: PromptContext = {
  title: titleMatch ? titleMatch[1].trim() : getTitleFromContent(feature.content),
  status: feature.status,
  priority: feature.priority,
  labels: feature.labels,
  content: feature.content,  // raw — buildPrompt normalizes description
  filePath: feature.filePath
}
const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)

// Terminal cwd: use derived workspace root; fall back to workspaceFolders[0] when null
// cwd: workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
```

`getTitleFromContent` is imported from `src/shared/types` (existing helper, already used in `KanbanPanel`).

### Changes to `FeatureHeaderProvider.ts`

`FeatureHeaderProvider` already holds `this._extensionUri`. Its `startWithAI` case receives `fm` (parsed frontmatter) and `docContent` (raw text). Updated to call `buildPrompt` identically to `_startWithAI`:

```ts
const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._currentDocument.uri)
const workspaceRoot = workspaceFolder?.uri.fsPath ?? null

const config = vscode.workspace.getConfiguration('kanban-markdown')
const columns = config.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
const column = columns.find(c => c.id === fm.status)
  ?? { id: fm.status, name: fm.status, color: '' }

const titleMatch = docContent.match(/^#\s+(.+)$/m)
const ctx: PromptContext = {
  title: titleMatch ? titleMatch[1].trim() : getTitleFromContent(docContent),
  status: fm.status,
  priority: fm.priority,
  labels: fm.labels,
  content: docContent,
  filePath: this._currentDocument.uri.fsPath
}
const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)
```

`getTitleFromContent` imported from `src/shared/types`.

### `KanbanColumn` interface (`src/shared/types.ts`)

Add optional field:

```ts
export interface KanbanColumn {
  id: string
  name: string
  color: string
  prompt?: string  // optional Build with AI template override
}
```

### `package.json` — column schema

Add `prompt` to the `kanban-markdown.columns` items schema with a localization key:

```json
"prompt": {
  "type": "string",
  "description": "%config.columns.prompt.description%"
}
```

Add the entry to **`package.nls.json`**, **`package.nls.es.json`**, and **`package.nls.pt.json`** (these are the settings-UI localization files, distinct from the runtime `l10n/bundle.l10n.*.json` files):

```json
"config.columns.prompt.description": "Optional Build with AI prompt template for this column. Supports {{title}}, {{priority}}, {{status}}, {{columnName}}, {{labels}}, {{description}}, {{filePath}}."
```

No changes to `l10n/bundle.l10n.*.json` — those are for runtime UI strings, not settings descriptions.

### `.vscodeignore`

No change needed — `prompts/` is not currently excluded and will ship with the extension.

---

## Rollback

**This feature changes default behavior for most columns.** The new bundled `prompts/*.md` defaults replace the current single hardcoded prompt for `backlog`, `in-progress`, `review`, and `done`. Only `todo.md` matches the existing behavior. Removing user overrides (`.kanban/instructions/` files or `prompt` settings) does NOT restore current behavior — the bundled defaults still apply.

**User-level rollback** (removes customizations, keeps new defaults):
- Delete `.kanban/instructions/` files → local overrides removed
- Remove `prompt` fields from `kanban-markdown.columns` → settings cleared
- The new bundled defaults remain in effect

**Code-level rollback** (restores current behavior fully):
- Revert to a previous extension release via VS Code Extensions panel
- Or: delete `src/extension/ai/promptBuilder.ts`, restore the original inline prompt in `_startWithAI`, revert `KanbanColumn.prompt?` from `src/shared/types.ts` and `package.json` schema, delete `prompts/`
- No data migration needed — feature files are unchanged

---

## Implementation order

Changes land in this sequence to avoid partial broken states:

1. **Add `KanbanColumn.prompt?` to `src/shared/types.ts`** — type change first so all subsequent code compiles cleanly
2. **Add `PromptContext` type and `promptBuilder.ts`** with unit tests — no callers yet
3. **Wire `KanbanPanel._startWithAI`** to call `buildPrompt` and update terminal `cwd`
4. **Add `KanbanPanel` wiring test**
5. **Update `package.json` schema** and all localization files
6. **Add `prompts/` directory** with the five bundled default files
7. **Wire `FeatureHeaderProvider`'s `startWithAI` case** to call `buildPrompt` (same logic, preventative maintenance)
8. **Add `FeatureHeaderProvider` wiring test**
9. **Verify packaging** — run `pnpm run package` (uses `vsce package --no-dependencies -o releases/`) and confirm `prompts/*.md` appears in the VSIX manifest

---

## File layout

```
prompts/
  backlog.md
  todo.md
  in-progress.md
  review.md
  done.md
src/extension/ai/
  promptBuilder.ts                              ← new
tests/extension/ai/
  promptBuilder.test.ts                         ← new
tests/extension/
  KanbanPanel.startWithAI.test.ts               ← new (wiring test)
  FeatureHeaderProvider.startWithAI.test.ts     ← new (wiring test, preventative)
```

---

## Testing strategy

**Unit tests in `tests/extension/ai/promptBuilder.test.ts`:**

- Variable substitution covers all seven variables
- `{{filePath}}` present in raw template → substituted in place, not auto-appended
- `{{filePath}}` absent → auto-appended after substitution
- Priority chain: local file wins over settings wins over bundled default
- Missing local file and no settings → bundled default used
- Unknown column ID with no files → generic fallback
- `undefined`, empty string, and whitespace-only `settingsTemplate` all fall through to bundled default
- Column ID character validation: `in-progress` passes; `../secret`, `foo\bar`, `my:column`, `foo bar` all fail Stage 0 and fall through silently
- Path traversal in column ID that passes Stage 0 but fails Stage 1 → still rejected silently
- Symlink pointing outside `.kanban/instructions/` is rejected — verified with a **real temp-dir integration test on Linux** (the only CI platform). On macOS the same code path runs and the logic is identical (POSIX symlinks), so macOS users benefit from the Linux CI coverage. On Windows, symlink creation requires elevated privileges and is uncommon; the `realpathSync`-based guard runs on Windows but is explicitly documented as having no CI coverage. Windows symlink-based prompt overrides are a supported code path but an unsupported attack surface.
- Unreadable file / missing directory falls through silently
- `{{labels}}` with labels → ` [a, b]`; with no labels → empty string
- `{{description}}` normalization: newlines → spaces, whitespace collapsed, trimmed, truncated at 200 with `...`
- `{{priority}}` renders `critical` unchanged
- `workspaceRoot: null` → local file step skipped entirely, settings/default chain still runs

**Wiring test (`tests/extension/KanbanPanel.startWithAI.test.ts`):**

Stub `buildPrompt`. Trigger `_startWithAI` with `status: 'review'`. Assert `buildPrompt` was called with: the column from `kanban-markdown.columns` config matching `review`, `extensionUri.fsPath`, workspace-derived root, and `column.prompt` as `settingsTemplate`. Also assert `workspaceRoot: null` path reaches `buildPrompt` without error.

---

## Acceptance criteria

- Cards in different columns launch the AI with contextually appropriate prompts.
- A `.kanban/instructions/review.md` file in the project root overrides both the VS Code setting and the bundled default for the `review` column.
- `prompt` field in `kanban-markdown.columns` setting overrides the bundled default but is overridden by the local file.
- A whitespace-only `prompt` value in settings is treated as absent.
- A template containing `{{filePath}}` places the path exactly where written; one without it gets the path auto-appended.
- All seven template variables are substituted correctly.
- Unknown/custom column IDs with no matching file or setting use the generic fallback.
- A column ID containing path traversal sequences does not cause unintended file reads.
- When the feature file belongs to no workspace folder, `startWithAI` still works — local file lookup is skipped, settings/default chain is used.
- `prompts/*.md` files appear in the packaged VSIX (`vsce package --dry-run` confirms inclusion).
- The `prompt` field description in VS Code settings UI is localized via `package.nls.json` and all locale files.
- Default behavior changes for `backlog`, `in-progress`, `review`, and `done`; only `todo` is unchanged. Full behavior restore requires a code revert (see Rollback section).
- `FeatureHeaderProvider`'s `startWithAI` case uses `buildPrompt` (preventative — not currently user-visible since the provider is unregistered).
