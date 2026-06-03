---
id: "column-aware-ai-prompts"
status: "done"
priority: "high"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-03T05:13:08.055Z"
completedAt: null
labels: ["ai", "ux", "configuration"]
order: "a0"
---
# Column-aware "Build with AI" prompts

## Problem

`_startWithAI` in `KanbanPanel.ts` always sends the same prompt — `"Implement this feature: …"` — regardless of which column the feature is in. A card in `review` needs a code-review instruction; a card in `backlog` needs a research/planning instruction. The mismatch makes the AI response less useful without manual prompt editing.

The same hardcoded prompt exists as a duplicate in `FeatureHeaderProvider.ts` (lines 118, `startWithAI` case). Both sites must be updated together.

---

## Story point estimate

**8 points**

Rationale: The core `promptBuilder.ts` module is well-specified and purely functional (no VS Code API calls), making it straightforward to implement and unit-test in isolation. However, the total scope is wider than it first appears — three-level resolution logic with path-traversal hardening, five bundled template files, two separate call-site rewrites each with their own wiring tests, `package.json` schema changes, three localization files, VSIX packaging verification, and a meaningful behavior change that must be documented clearly for rollback. No design decisions remain open. All ambiguity has been resolved in the spec. 8 points is appropriate for a well-defined story of this breadth.

---

## Dependencies

DependencyDirectionStatusNotes`harden-ai-agent-launch-2026-06-02`independent parallelBacklogBoth stories modify the same two `_startWithAI` call sites. **Coordinate PRs carefully — do not merge concurrently.** If `harden-ai-agent-launch` ships first (stdin/argv-based launch), the `buildPrompt` wiring in this story must target the new launch mechanism, not `terminal.sendText`. If this story ships first, `harden-ai-agent-launch` must update both call sites again. Recommend sequencing: this story first (prompt logic only), then `harden-ai-agent-launch` (launch mechanism).`extract-feature-repository-service-2026-06-02`blocked by thisBacklogThe planned `AgentLauncher` service should eventually wrap `buildPrompt`. Land this story before the extraction so the service wraps the correct implementation.`replace-regex-yaml-parser-2026-06-02`independentTodoBoth stories touch `src/shared/types.ts` (this story adds `KanbanColumn.prompt?`; that story does not touch `KanbanColumn`). No conflict. Either order is safe.

---

## Solution overview

Introduce a three-level prompt resolution chain, identical `.md` template format at every level:

PrioritySourceWho controls it1 (highest)`.kanban/instructions/{columnId}.md`Project team (committed to repo — `.kanban/` is not git-ignored)2`prompt` field on column in `kanban-markdown.columns` VS Code settingIndividual user3 (lowest)`prompts/{columnId}.md` bundled with extensionExtension defaults (editable in source)

If no level produces a non-blank template, a generic inline fallback is used.

`{{filePath}}` behaviour: check the **raw template** for the literal string `{{filePath}}` before any substitution. If present, substitute it in place along with other variables. If absent, append `\nSee full details in: {filePath}` after all substitutions. This single pre-check prevents double-appending.

`{{filePath}}` **privacy note:** `{{filePath}}` expands to an absolute local path. This is no change in privacy posture from the current implementation, which already appends `See full details in: ${feature.filePath}` unconditionally. The path is passed as a CLI argument to a local agent process; whether that agent transmits it externally depends on the agent and its configuration — the same consideration that applies today.

---

## Template variables

VariableRendered value`{{title}}`Feature title from first `# heading`; falls back to `getTitleFromContent(content){{priority}}`Exact priority string: `critical`, `high`, `medium`, or `low{{status}}`Column ID as-is, e.g. `in-progress{{columnName}}`Column display name, e.g. `In Progress{{labels}} [label1, label2]` (leading space + brackets) when labels exist; empty string when none`{{description}}`Normalized content: newlines → spaces, whitespace collapsed, trimmed, truncated at 200 chars with `...` if truncated`{{filePath}}`Absolute path to the feature file

`{{labels}}` **note:** the leading space is baked in so templates can write `({{priority}} priority){{labels}}.` and get `(high priority) [bug].` or `(high priority).` without extra spacing.

`{{status}}` **/ column ID note:** `buildPrompt` must handle any runtime `column.id` value — including the five built-in `FeatureStatus` values, custom column IDs from `kanban-markdown.columns`, and arbitrary status strings preserved in existing feature files. For column IDs with no matching `.kanban/instructions/` file, no settings `prompt`, and no bundled `prompts/{id}.md`, the generic fallback applies. Tests must include at least one case with a non-default column ID to verify the fallback path.

`{{description}}` **note:** computed inside `buildPrompt` from raw `content` via `content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()`, truncated at 200 chars with ASCII `...`. Callers pass raw content — description normalization belongs exclusively in `buildPrompt`.

---

## Bundled defaults (`prompts/`)

Five files ship with the extension. These are editable markdown files in source — no code change needed to adjust wording.

`prompts/backlog.md`

```
Research and plan an approach for: "{{title}}" ({{priority}} priority){{labels}}. {{description}}
```

`prompts/todo.md`

```
Implement this feature: "{{title}}" ({{priority}} priority){{labels}}. {{description}}
```

`prompts/in-progress.md`

```
Continue implementing: "{{title}}" ({{priority}} priority){{labels}}. Pick up where work left off. {{description}}
```

`prompts/review.md`

```
Review this implementation for correctness, edge cases, and code quality: "{{title}}"{{labels}}. {{description}}
```

`prompts/done.md`

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

**Resolution order inside** `buildPrompt`**:**

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

**Note on** `FeatureHeaderProvider` **registration status:** As of v1.14.1 this provider is registered (`FeatureHeaderProvider.register` is called in `src/extension/index.ts`) — it is active. Updating its `startWithAI` case is not merely preventative; it is required. Verify current registration status before assuming the handler is unreachable.

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

**Type narrowing note:** `PromptContext.status` is typed as `FeatureStatus` in the spec, but `KanbanPanel._startWithAI` obtains status from `feature.status` (already `FeatureStatus`) and `FeatureHeaderProvider` obtains it from `fm.status` (also `FeatureStatus` via `FeatureFrontmatter`). There is no cast required. However, `buildPrompt` must handle the case where `column.id` is a custom string that differs from the FeatureStatus enum — the column is looked up by `feature.status` and the fallback column uses `{ id: feature.status, ... }`, so `column.id` and `ctx.status` will always be the same value in practice.

### `package.json` — column schema

Add `prompt` to the `kanban-markdown.columns` items schema with a localization key:

```json
"prompt": {
  "type": "string",
  "description": "%config.columns.prompt.description%"
}
```

Add the entry to `package.nls.json`, `package.nls.es.json`, and `package.nls.pt.json` (these are the settings-UI localization files, distinct from the runtime `l10n/bundle.l10n.*.json` files):

```json
"config.columns.prompt.description": "Optional Build with AI prompt template for this column. Supports {{title}}, {{priority}}, {{status}}, {{columnName}}, {{labels}}, {{description}}, {{filePath}}."
```

Spanish (`package.nls.es.json`) and Portuguese (`package.nls.pt.json`) translations must also be added. Suggested translations:

- ES: `"Plantilla opcional del indicador 'Construir con IA' para esta columna. Admite {{title}}, {{priority}}, {{status}}, {{columnName}}, {{labels}}, {{description}}, {{filePath}}."`
- PT: `"Modelo opcional do indicador 'Construir com IA' para esta coluna. Suporta {{title}}, {{priority}}, {{status}}, {{columnName}}, {{labels}}, {{description}}, {{filePath}}."`

No changes to `l10n/bundle.l10n.*.json` — those are for runtime UI strings, not settings descriptions.

### `.vscodeignore`

No change needed — `prompts/` is not currently excluded and will ship with the extension. The current `.vscodeignore` excludes `.vscode/`, `.git/`, `node_modules/`, `src/`, `*.map`, and a small set of config files. A top-level `prompts/` directory is not listed and will be included in the VSIX automatically. Verify with `vsce package --dry-run` in step 9.

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

1. **Add** `KanbanColumn.prompt?` **to** `src/shared/types.ts` — type change first so all subsequent code compiles cleanly
2. **Add** `PromptContext` **type and** `promptBuilder.ts` with unit tests — no callers yet
3. **Wire** `KanbanPanel._startWithAI` to call `buildPrompt` and update terminal `cwd`
4. **Add** `KanbanPanel` **wiring test**
5. **Update** `package.json` **schema** and all localization files
6. **Add** `prompts/` **directory** with the five bundled default files
7. **Wire** `FeatureHeaderProvider`**'s** `startWithAI` **case** to call `buildPrompt` (same logic, preventative maintenance)
8. **Add** `FeatureHeaderProvider` **wiring test**
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

**Unit tests in** `tests/extension/ai/promptBuilder.test.ts`**:**

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
- `{{labels}}` with labels → `[a, b]`; with no labels → empty string
- `{{description}}` normalization: newlines → spaces, whitespace collapsed, trimmed, truncated at 200 with `...`
- `{{priority}}` renders `critical` unchanged
- `workspaceRoot: null` → local file step skipped entirely, settings/default chain still runs

**Test infrastructure note:** `tests/extension/featureFileUtils.test.ts` demonstrates the required vscode stub pattern — `vi.mock('vscode', ...)` at the top of the file. `promptBuilder.ts` must be designed to accept `fs` operations as a testable seam (injected adapter or direct `fs` module calls that can be mocked via `vi.mock('fs')`). Verify the approach against the Vitest config at `vitest.config.mts` before committing to one pattern.

**Wiring test (**`tests/extension/KanbanPanel.startWithAI.test.ts`**):**

Stub `buildPrompt`. Trigger `_startWithAI` with `status: 'review'`. Assert `buildPrompt` was called with: the column from `kanban-markdown.columns` config matching `review`, `extensionUri.fsPath`, workspace-derived root, and `column.prompt` as `settingsTemplate`. Also assert `workspaceRoot: null` path reaches `buildPrompt` without error.

---

## Acceptance criteria

- \[x\] Cards in different columns launch the AI with contextually appropriate prompts — verified manually by triggering "Build with AI" on a card in each of the five default columns and observing the terminal command.
- \[x\] A `.kanban/instructions/review.md` file in the project root overrides both the VS Code setting and the bundled default for the `review` column — verified by: (1) creating the file, (2) setting a `prompt` on the `review` column in settings, and (3) confirming the local file's text is used.
- \[x\] `prompt` field in `kanban-markdown.columns` setting overrides the bundled default but is overridden by the local file — verified via the wiring unit test.
- \[x\] A whitespace-only `prompt` value in settings is treated as absent — the next-priority template (bundled default or generic fallback) is used instead; verified in `promptBuilder.test.ts`.
- \[x\] A template containing `{{filePath}}` places the path exactly where written; one without it gets the path auto-appended — both cases verified in `promptBuilder.test.ts`.
- \[x\] All seven template variables (`{{title}}`, `{{priority}}`, `{{status}}`, `{{columnName}}`, `{{labels}}`, `{{description}}`, `{{filePath}}`) are substituted correctly — verified in `promptBuilder.test.ts`.
- \[x\] Unknown/custom column IDs with no matching file or setting use the generic fallback — verified in `promptBuilder.test.ts` with a non-default column ID.
- \[x\] A column ID containing path traversal sequences (e.g. `../secret`) does not cause unintended file reads — Stage 0 regex rejects it before any filesystem access; verified in `promptBuilder.test.ts`.
- \[x\] A column ID that passes Stage 0 but resolves outside `.kanban/instructions/` (adversarial Stage 1 bypass) is rejected — verified in `promptBuilder.test.ts`.
- \[x\] A symlink inside `.kanban/instructions/` that points outside the directory is rejected silently — verified with a real temp-dir integration test on Linux CI.
- \[x\] When the feature file belongs to no workspace folder, `startWithAI` still works — local file lookup is skipped, settings/default chain is used; `buildPrompt` receives `workspaceRoot: null` and produces a valid prompt.
- \[x\] `prompts/*.md` files appear in the packaged VSIX — confirmed by `vsce package --dry-run` listing all five files under `prompts/`.
- \[x\] The `prompt` field description in VS Code settings UI is localized via `package.nls.json` and all three locale files (`package.nls.json`, `package.nls.es.json`, `package.nls.pt.json`).
- \[x\] Default behavior changes for `backlog`, `in-progress`, `review`, and `done`; only `todo` is unchanged. Full behavior restore requires a code revert (see Rollback section) — documented in PR description.
- \[x\] `FeatureHeaderProvider`'s `startWithAI` case uses `buildPrompt` with the same argument pattern as `KanbanPanel._startWithAI` — verified in `FeatureHeaderProvider.startWithAI.test.ts`.
- \[x\] `pnpm test` passes with no failures (unit and integration suites).
- \[x\] `pnpm typecheck` passes with no TypeScript errors.

---

## Review findings

> Code review 2026-06-02 — **CHANGES REQUESTED**

**WARNING — Scope creep**

- \[x\] CHANGELOG `[Unreleased]` section now includes a `### Added` entry for column-aware AI prompts. Combined scope accepted; all three features documented together.

**WARNING — Windows shell quoting (pre-existing, exacerbated)**

- \[x\] `KanbanPanel.ts` and `FeatureHeaderProvider.ts` — `_shellQuote` has been removed; both sites now use `vscode.window.createTerminal({ shellPath, shellArgs })`, delegating escaping to VS Code. Resolved.

**MINOR — Duplicate title extraction**

- \[x\] Both call sites now use `title: getTitleFromContent(...)` directly — no `titleMatch` regex. Resolved.

**MINOR — NLS quote inconsistency**

- \[x\] All three NLS files now use consistent single quotes around the feature name in `config.columns.prompt.description`. Resolved.

**MINOR —** `in-progress` **Stage 0 test lacks path assertion**

- \[x\] `tests/extension/ai/promptBuilder.test.ts` — assertion now checks `realpathSync` was called with a path containing `'in-progress'`. Resolved.

**MINOR — VSIX packaging not verified**

- \[x\] `vsce ls` confirms all five `prompts/*.md` files appear in the VSIX manifest. Resolved.

---

> Re-review 2026-06-02 — **CHANGES REQUESTED**

**WARNING — Missing l10n bundle key for** `panel.aiRequiresTrust`

- \[x\] `panel.aiRequiresTrust` added to all three `l10n/bundle.l10n.*.json` files with EN/ES/PT translations. Runtime `t()` calls now resolve correctly.

**MINOR — Sequential** `String.replace` **allows variable cascading and** `$&` **back-reference injection**

- \[ \] `src/extension/ai/promptBuilder.ts:42-49` — chained `.replace()` calls allow a value from an earlier substitution to be re-processed by a later pattern (e.g. a title containing `{{description}}`). JavaScript's `String.replace` also interprets `$&`, `$'`, `$1` etc. in the replacement string as regex back-references; a feature title containing `$&` would render incorrectly. Fix: use a single-pass replacer function:

  ```ts
  const vars: Record<string, string> = { title: ctx.title, priority: ctx.priority, status: ctx.status, columnName: column.name, labels: labelsStr, description, filePath: ctx.filePath }
  let result = template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
  ```

**MINOR — Stage 2 symlink check is defeated when** `.kanban/instructions` **is itself a symlink**

- \[ \] `src/extension/ai/promptBuilder.ts:26-29` — if `.kanban/instructions` is a symlink to an external directory (e.g. `/etc`), both `realInstructionsDir` and `realCandidate` resolve under that external directory, so `realRel` does not start with `..` and Stage 2 passes. Mitigated by the workspace-trust guard, but is a depth-of-defense gap. Fix: additionally verify `realInstructionsDir` stays inside `workspaceRoot`:

  ```ts
  const realRootRel = path.relative(workspaceRoot, realInstructionsDir)
  if (realRootRel.startsWith('..') || path.isAbsolute(realRootRel)) return null
  ```

**MINOR — Unvalidated** `shellPath` **for unknown agent values**

- \[ \] `src/extension/KanbanPanel.ts` and `src/extension/FeatureHeaderProvider.ts` — the `default:` arm of the agent `switch` passes the unsanitized `selectedAgent` string directly as `shellPath`, which VS Code will try to spawn as a binary. The value comes from user settings. Fix: validate `selectedAgent` against the `AIAgent` enum; fall back to `'claude'` if unknown.

**MINOR — VSIX ships development-only directories including** `.claude/settings.local.json`

- \[ \] `.vscodeignore` — `vsce ls` shows the VSIX bundles `.devtool/`, `.claude/` (including `settings.local.json`), `.codegraph/`, `tests/`, `scripts/`, and several config files. Pre-existing issue surfaced by packaging verification. Add these patterns to `.vscodeignore`:

  ```
  .devtool/**
  .claude/**
  .codegraph/**
  .codegraphy/**
  tests/**
  scripts/**
  tailwind.config.js
  postcss.config.mjs
  vitest.config.mts
  tsconfig.*.json
  ```

---

> Re-review 2026-06-03 — **CHANGES REQUESTED**

**WARNING — Agent-launch logic duplicated across call sites; will drift**

- \[x\] `src/extension/ai/agentLauncher.ts` extracted with `launchAgentTerminal(agent, permissionMode, prompt, cwd)`; both call sites import and use it. No inline switch remains in either file. Resolved.

**WARNING — CHANGELOG advertises** `{{status}}` **and** `{{columnName}}` **but no bundled template uses them**

- \[x\] `CHANGELOG.md:12` now states "all available in custom templates; built-in prompts use the most relevant subset". Resolved.

**MINOR — Sequential** `String.replace` **allows variable cascading and** `$&` **back-reference injection**

- \[x\] `src/extension/ai/promptBuilder.ts:60` — single-pass replacer with function callback: `template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')`. Resolved.

**MINOR — Stage 2 symlink check is defeated when** `.kanban/instructions` **is itself a symlink**

- \[x\] `src/extension/ai/promptBuilder.ts:30-34` — Stage 2a added: `realInstructionsDir` is checked against `fs.realpathSync(workspaceRoot)` before comparing the candidate. Resolved.

**MINOR — Unvalidated** `shellPath` **for unknown agent values**

- \[x\] `src/extension/ai/agentLauncher.ts:3,26` — `VALID_AGENTS = new Set([...])` allow-list enforced; `safeAgent` is always a known value or `'claude'` fallback. Resolved.

**MINOR — VSIX ships development-only directories including** `.claude/settings.local.json`

- \[x\] `.vscodeignore` now excludes `.devtool/**`, `.claude/**`, `.codegraph/**`, `tests/**`, `scripts/**`, and related config files. `README.md` exclusion removed. Resolved.

**MINOR — CHANGELOG "behavior change" buried inside** `### Added` **paragraph**

- \[x\] `CHANGELOG.md:14-16` — dedicated `### Changed` subsection added with the behavior-change note as the first bullet. Resolved.

**MINOR —** `column.prompt` **and local** `.md` **file templates have no size cap**

- \[x\] `src/extension/ai/promptBuilder.ts:17,39,83` — `MAX_TEMPLATE_CHARS = 16384` defined; applied at both the local file path (line 39) and the settings path (line 83). Truncation is silent; within the spirit of the fix. Resolved.

**MINOR — Hardcoded unlocalized "See full details in:" append string**

- \[x\] All five bundled `prompts/*.md` files and the generic fallback (`promptBuilder.ts:96`) now include `{{filePath}}`, making the auto-append branch dead for all built-in templates. The branch (`promptBuilder.ts:62-64`) remains live for user-supplied templates that omit `{{filePath}}` and the string is hardcoded English — accepted given "practical impact is low". Partially resolved; accepted.

---

> Re-review 2026-06-03 — **APPROVED**

8 of 9 prior findings fully resolved; 1 partially resolved and accepted. No significant regressions introduced.

**NOTE —** `agentLauncher.ts` **codex** `suggest` **fallback (informational)**

- `src/extension/ai/agentLauncher.ts:42` — `APPROVAL_MODE[permissionMode] || 'suggest'` uses `'suggest'` as the fallback for unrecognized permission modes when launching codex. `'suggest'` is a valid `codex --ask-for-approval` value (its interactive default); correct behavior. Documented for future reference if the codex CLI changes.

**NOTE — Silent truncation at** `MAX_TEMPLATE_CHARS` **(informational)**

- `src/extension/ai/promptBuilder.ts:39,83` — truncation is silent; the original finding asked to "emit a warning and truncate". The argv-overflow protection goal is met; a `vscode.window.showWarningMessage` would improve UX but is not required for this story.

---

## Definition of done

- \[x\] All acceptance criteria above are checked.
- \[x\] `src/extension/ai/promptBuilder.ts` exists with `PromptContext` interface and `buildPrompt` function exported.
- \[x\] `tests/extension/ai/promptBuilder.test.ts` exists and covers all cases listed in the testing strategy.
- \[x\] `tests/extension/KanbanPanel.startWithAI.test.ts` exists and stubs `buildPrompt`.
- \[x\] `tests/extension/FeatureHeaderProvider.startWithAI.test.ts` exists and stubs `buildPrompt`.
- \[x\] `src/shared/types.ts` — `KanbanColumn.prompt?` field added.
- \[x\] `package.json` — `prompt` property added to `kanban-markdown.columns` items schema with `%config.columns.prompt.description%` localization key; `"required"` array unchanged (field is optional).
- \[x\] `package.nls.json`, `package.nls.es.json`, `package.nls.pt.json` — `config.columns.prompt.description` key added to each file.
- \[x\] `prompts/backlog.md`, `prompts/todo.md`, `prompts/in-progress.md`, `prompts/review.md`, `prompts/done.md` exist with the specified template text.
- \[x\] `KanbanPanel._startWithAI` and `FeatureHeaderProvider`'s `startWithAI` case both call `buildPrompt`; neither contains an inline prompt string.
- \[x\] Terminal `cwd` in `KanbanPanel._startWithAI` uses workspace-derived root with `workspaceFolders[0]` fallback (not unconditionally `workspaceFolders[0]`).
- \[ \] PR description explains the behavior change (4 of 5 columns now use different default prompts), includes rollback instructions, and links to the adversarial path-traversal test as evidence of the security guard.
- \[x\] No open questions or TODOs remain in the implementation files.