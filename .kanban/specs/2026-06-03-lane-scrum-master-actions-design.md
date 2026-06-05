# Design: Lane-Level Scrum Master Actions

**Date:** 2026-06-03
**Feature file:** `.kanban/features/2026-06-03-lane-scrum-master-actions.md`

## Summary

Add a "Scrum Master" menu item to each Kanban column's three-dots header menu. Clicking it launches an agent terminal (same mechanism as the per-card "Build with AI" button) with a lane-level prompt that reviews all *currently visible* stories in that lane and provides scrum-master guidance appropriate to the lane's lifecycle stage.

## Architecture

### Message flow

```
KanbanColumn (UI)
  onLaneAction(featureIds[])          ← IDs from filteredByColumn (respects active filters)
KanbanBoard
  postMessage({ type: 'laneAction', columnId, featureIds })
KanbanPanel.ts
  resolves featureIds → Feature[] via repo
  this._launcher.launchLane(features, column, permissionMode)
AgentLauncher
  buildLanePrompt(features, column, extensionRoot, workspaceRoot)
  launchAgentTerminal(agent, permissionMode, prompt, cwd, terminalTitle)
```

- No new extension→webview messages
- No new UI panels or report views
- Output appears in the agent terminal, same as per-card AI actions
- `permissionMode` defaults to `'default'` (inherits from VS Code settings, same as `startWithAI`)

### Feature scope

The action operates on the **currently visible (filtered) features** in the lane — the same set shown to the user via active search, priority, assignee, label, and epic filters. The webview sends the filtered feature IDs; the extension host resolves them to file paths. This allows focused lane reviews (e.g., "scrum master review of high-priority in-progress stories").

## Components

### 1. `KanbanColumn.tsx`

New optional prop: `onLaneAction?: () => void`

- When provided, a "Scrum Master" menu item appears in the three-dots menu after "Move All Cards" and before "Archive All Cards", separated by a `<hr>` divider
- i18n key: `column.scrumMaster`
- Disabled (opacity-40, pointer-events-none) when `features.length === 0`
- Hidden entirely when `onLaneAction` is not provided

### 2. `KanbanBoard.tsx`

New handler:
```ts
const handleLaneAction = useCallback((columnId: string) => {
  const featureIds = filteredByColumn.get(columnId)?.map(f => f.id) ?? []
  vscode.postMessage({ type: 'laneAction', columnId, featureIds })
}, [filteredByColumn])
```

- Passes `onLaneAction={() => handleLaneAction(column.id)}` to `KanbanColumn` only when `settings.showBuildWithAI` is true (same gate as the per-card AI button)
- Not passed to `CollapsedColumn` (collapsed columns have no visible stories to review)

### 3. `src/shared/types.ts`

New variant appended to `WebviewMessage`:
```ts
| { type: 'laneAction'; columnId: string; featureIds: string[] }
```

### 4. `KanbanPanel.ts`

New case in the webview message handler:
```ts
case 'laneAction': {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
    return
  }
  const features = message.featureIds
    .map((id: string) => this._repo.features.find(f => f.id === id))
    .filter((f): f is Feature => f !== undefined)
  if (features.length === 0) return
  const config = vscode.workspace.getConfiguration('kanban-extension')
  const columns = config.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
  const column = columns.find(c => c.id === message.columnId)
    ?? { id: message.columnId, name: message.columnId, color: '' }
  const agent = config.get<string>('aiAgent') || 'claude'
  this._launcher.launchLane(features, column, agent, 'default')
  break
}
```

### 5. `AgentLauncher.ts`

New method:
```ts
launchLane(features: Feature[], column: KanbanColumn, agent: string, permissionMode: string): void
```

- Derives `workspaceRoot` from the first feature's `filePath` (same logic as `launch()`)
- Calls `buildLanePrompt(features, column, this._extensionUri.fsPath, workspaceRoot)`
- Terminal title: `"Scrum Master: {column.name}"`
- Calls `launchAgentTerminal(agent, permissionMode, prompt, workspaceRoot, title)`

### 6. `src/extension/ai/promptBuilder.ts`

New function:
```ts
export function buildLanePrompt(
  features: Feature[],
  column: KanbanColumn,
  extensionRoot: string,
  workspaceRoot: string | null
): string
```

Template variable substitution:
- `{{columnName}}` — column display name
- `{{count}}` — number of features
- `{{featurePaths}}` — newline-separated relative paths (or absolute if no workspaceRoot)

Resolution priority (same 3-level pattern as `buildPrompt`):
1. `.kanban/instructions/{columnId}-lane.md` (local workspace override, same path-traversal guard)
2. Bundled `prompts/{columnId}-lane.md`
3. Generic fallback:
   ```
   You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).
   Stories to review:
   {{featurePaths}}
   Assess each story's health for this stage and identify issues that need resolution.
   ```

### 7. Bundled lane prompt files

Five new files in `prompts/`:

**`prompts/backlog-lane.md`**
```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and surface:
- Vague or untestable acceptance criteria
- Missing `blockedBy` entries for known dependencies
- Duplicate stories covering the same scope
- Stories lacking enough context to plan

Reference `.kanban/instructions.md` for board conventions.
```

**`prompts/todo-lane.md`**
```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and check readiness for planning:
- Unresolved blockers in `blockedBy`
- Ambiguous scope or missing decisions
- No implementation plan yet attempted
- Dependencies on stories still in backlog

Reference `.kanban/instructions.md` for board conventions.
```

**`prompts/in-progress-lane.md`**
```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and surface:
- Scope drift from original acceptance criteria
- Missing or stale `worktree` context
- Newly introduced blockers not yet captured in `blockedBy`
- Stories that appear stalled or at risk

Reference `.kanban/instructions.md` for board conventions.
```

**`prompts/review-lane.md`**
```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and surface:
- Missing evidence that acceptance criteria were met
- Unresolved code review comments
- Failing checks or missing test coverage notes
- Go/no-go decisions that need to be made before merging

Reference `.kanban/instructions.md` for board conventions.
```

**`prompts/done-lane.md`**
```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and confirm:
- `completedAt` is set
- The story is in `.kanban/features/done/` (or confirm it was archived)
- Any follow-up stories or retrospective notes have been captured
- No loose ends remain in `blockedBy` that dependent stories are waiting on

Reference `.kanban/instructions.md` for board conventions.
```

## Error Handling

| Scenario | Behaviour |
|---|---|
| Workspace not trusted | Warning notification, no launch |
| Lane is empty | Menu item disabled — `launchLane` is never called |
| `featureIds` all resolve to missing features (deleted between render and click) | Early return, no launch |
| Column not found in config | Falls back to `{ id, name: id, color: '' }` (same as `startWithAI`) |
| Local override file missing | Silently falls through to bundled prompt |
| Bundled prompt missing (custom column) | Falls through to generic fallback string |

## Testing

- **Unit — `buildLanePrompt`**: verify `{{columnName}}`, `{{count}}`, `{{featurePaths}}` substitution; verify 3-level fallback chain; verify path-traversal guard on local override (same test structure as `buildPrompt` tests)
- **Unit — `KanbanPanel` message handler**: verify trust guard; verify `launchLane` receives only the features matching `featureIds` (not all repo features)
- **Unit — `AgentLauncher.launchLane`**: verify correct terminal title format and correct delegation to `launchAgentTerminal`
- **Integration — `KanbanBoard`**: verify `onLaneAction` is not passed when `showBuildWithAI` is false

## What Does Not Change

- Existing `launch()` on `AgentLauncher` — unchanged
- Existing `buildPrompt()` — unchanged
- Existing per-card "Build with AI" button — unchanged
- Existing column menu items (Move All Cards, Archive All Cards) — unchanged
- The five existing `prompts/{columnId}.md` per-card prompt files — unchanged
