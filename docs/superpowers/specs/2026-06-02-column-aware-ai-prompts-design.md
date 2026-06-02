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
| 1 (highest) | `.devtool/instructions/{columnId}.md` | Project team (committed to repo) |
| 2 | `prompt` field on column in `kanban-markdown.columns` VS Code setting | Individual user |
| 3 (lowest) | `prompts/{columnId}.md` bundled with extension | Extension defaults (editable in source) |

If a column ID matches none of the three, a generic inline fallback is used.

`{{filePath}}` behaviour: if the resolved template contains `{{filePath}}`, it is substituted in place. If absent, `\nSee full details in: {{filePath}}` is auto-appended (the literal file path, not the placeholder).

---

## Template variables

Available in any template at any level:

| Variable | Value |
|---|---|
| `{{title}}` | Feature title (from first `# heading`, or derived from content) |
| `{{priority}}` | `high`, `medium`, or `low` |
| `{{status}}` | Column ID, e.g. `in-progress` |
| `{{columnName}}` | Column display name, e.g. `In Progress` |
| `{{labels}}` | Formatted label list, e.g. `[bug, frontend]`, or empty string |
| `{{description}}` | First 200 chars of feature content |
| `{{filePath}}` | Absolute path to the feature file |

---

## Bundled defaults (`prompts/`)

Five files ship with the extension:

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

These are editable markdown files in source — no code change needed to adjust wording.

---

## Architecture

### New module: `src/extension/ai/promptBuilder.ts`

```ts
export function buildPrompt(
  feature: Feature,
  column: KanbanColumn,
  extensionRoot: string,  // extensionUri.fsPath
  workspaceRoot: string,
  settingsTemplate?: string
): string
```

Resolution order inside `buildPrompt`:
1. Try `{workspaceRoot}/.devtool/instructions/{column.id}.md` — read synchronously, skip if absent
2. Use `settingsTemplate` if non-empty
3. Try `{extensionRoot}/prompts/{column.id}.md` — read synchronously, skip if absent
4. Return generic fallback: `Implement this feature: "{{title}}" ({{priority}} priority){{labels}}. {{description}}`

After resolving the template, substitute all `{{variable}}` placeholders. Then apply the `{{filePath}}` rule.

### Changes to `KanbanPanel._startWithAI`

Replace the current inline prompt construction with:

```ts
const column = this._columns.find(c => c.id === feature.status)
  ?? { id: feature.status, name: feature.status, color: '' }
const settingsTemplate = column.prompt  // new optional field on KanbanColumn
const prompt = buildPrompt(
  feature,
  column,
  this._extensionUri.fsPath,
  workspaceRoot,
  settingsTemplate
)
```

### `FeatureHeaderProvider.ts`

Also handles `startWithAI` — same change applies there.

### `KanbanColumn` interface (`src/shared/types.ts`)

Add optional field:

```ts
export interface KanbanColumn {
  id: string
  name: string
  color: string
  prompt?: string  // optional template override
}
```

### `package.json` — column schema

Add `prompt` to the `kanban-markdown.columns` items schema:

```json
"prompt": {
  "type": "string",
  "description": "Optional prompt template for Build with AI. Supports {{title}}, {{priority}}, {{status}}, {{columnName}}, {{labels}}, {{description}}, {{filePath}}."
}
```

### `.vscodeignore`

No change needed — `prompts/` is not currently excluded and will ship with the extension.

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
  promptBuilder.ts       ← new
  promptBuilder.test.ts  ← new
```

---

## Testing strategy

Unit tests in `tests/extension/ai/promptBuilder.test.ts`:

- Variable substitution covers all seven variables
- `{{filePath}}` present in template → substituted, not appended
- `{{filePath}}` absent → auto-appended
- Priority chain: local file wins over settings wins over bundled default
- Missing local file and no settings → bundled default used
- Unknown column ID with no files → generic fallback
- Empty `settingsTemplate` string treated as absent (falls through to bundled default)

---

## Acceptance criteria

- Cards in different columns launch the AI with contextually appropriate prompts.
- A `.devtool/instructions/review.md` file in the project root overrides both the VS Code setting and the bundled default for the `review` column.
- `prompt` field in `kanban-markdown.columns` setting overrides the bundled default but is overridden by the local file.
- A template containing `{{filePath}}` places the path exactly where written; one without it gets the path auto-appended.
- All seven template variables are substituted correctly.
- Unknown/custom column IDs with no matching file or setting use the generic fallback.
