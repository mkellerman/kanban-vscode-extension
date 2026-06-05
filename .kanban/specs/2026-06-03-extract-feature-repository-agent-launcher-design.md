# Design: Extract FeatureRepository and AgentLauncher

**Date:** 2026-06-03
**Feature file:** `.devtool/features/extract-feature-repository-service-2026-06-02.md`
**Epic:** Architecture remediation

---

## Problem

`KanbanPanel`, `SidebarViewProvider`, and `FeatureHeaderProvider` each independently own file-loading, directory resolution, file watching, and AI-launch logic. The duplications are:

| Concern | KanbanPanel | SidebarViewProvider | FeatureHeaderProvider |
|---|---|---|---|
| Features directory resolution | `_getWorkspaceFeaturesDir()` | `_getFeaturesDir()` | inline in `_onActiveEditorChanged` |
| Load features from disk | `_loadFeatures()` (3-phase, with migration) | `_loadFeatures()` (simple, with stale regex parser) | — |
| File system watcher | `_setupFileWatcher()` | `_setupFileWatcher()` | — |
| AI launch | `_startWithAI()` (~40 lines) | — | inline `startWithAI` handler (~40 lines) |

`SidebarViewProvider._parseFrontmatter()` is a private hand-rolled regex parser — it predates the YAML-parser story and is now two versions behind the canonical `parseFeatureFile`.

The absence of a domain layer is the structural root cause. Every new provider or feature has to re-implement these concerns or copy them.

---

## Chosen approach

**Full repository (Approach B):** `FeatureRepository` owns all filesystem I/O — reads, writes, the in-memory feature list, and the watcher. `AgentLauncher` owns prompt construction and terminal launch. Providers become thin view-controllers.

Rationale: Approach A (read-only repository) would leave write-path duplication and the echo-suppression logic scattered — the `document-consistency-model` story would still find three places to document. Approach B gives both downstream stories (`document-consistency-model`, `incremental-webview-updates`) a single owner to build on.

---

## FeatureRepository

### Responsibilities

- Features directory resolution (reads `kanban-extension.featuresDirectory` config + workspace root, per call — not cached)
- `load()`: phases 1–3 of the current `KanbanPanel._loadFeatures()` (old-subfolder migration, root + done/ reading, done ↔ non-done reconciliation, legacy order migration)
- In-memory `Feature[]` as the single source of truth
- Single `vscode.FileSystemWatcher` for `**/*.md` in the features directory
- Echo suppression: the `_migrating` flag and per-file last-written-content sentinel both live here; when the watcher fires for a file the repository just wrote within the debounce window, the reload is suppressed
- `onDidChange: vscode.Event<readonly Feature[]>` — fires after any mutation or external-edit-triggered reload
- Full write API (see below)
- Delegates parse/serialize to `parseFeatureFile` / `serializeFeature` from `shared/featureFrontmatter`
- Delegates fractional ordering to `generateKeyBetween` / `generateNKeysBetween`
- Delegates file moves to `moveFeatureFile` from `featureFileUtils`

### API

```ts
class FeatureRepository {
  constructor(context: vscode.ExtensionContext, fs?: FsAdapter)

  // Observable
  readonly onDidChange: vscode.Event<readonly Feature[]>
  get features(): readonly Feature[]

  // Bootstrap
  async load(): Promise<void>
  getFeaturesDir(): string | null

  // Writes
  async createFeature(data: CreateFeatureData): Promise<Feature>
  async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void>
  async moveFeature(featureId: string, newStatus: FeatureStatus, newOrder: number): Promise<void>
  async moveAllFeatures(sourceColumnId: string, targetColumnId: string, epicLane?: string | null): Promise<void>
  async deleteFeature(featureId: string): Promise<void>
  async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }>
  async renameLabel(oldName: string, newName: string): Promise<number>
  async deleteLabel(labelName: string): Promise<void>
  async migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }>

  dispose(): void
}
```

`archiveFeatures` moves files to `archived/`; confirmation dialogs stay in KanbanPanel (the provider asks, then calls this method if confirmed). Same for `deleteLabel` and `renameLabel`. For `deleteLabel`, KanbanPanel reads `repo.features` to find affected features and build the confirmation message, then calls `repo.deleteLabel(labelName)` if confirmed — no separate query method needed.

### Watcher and echo suppression

The repository creates the single watcher. When a write method completes it records the written content keyed by file path. When the watcher fires, it checks whether the file was written by the repository within the debounce window; if so, it skips the reload. External edits (files written by the native editor or another tool) always trigger a reload and fire `onDidChange`.

The `_migrating` flag (currently in KanbanPanel to suppress watcher reloads during batch operations) moves into the repository. All batch-write methods set it before their loop and clear it in `finally`.

KanbanPanel retains `_currentEditingFeatureId` — a view concern — and uses the `onDidChange` payload to detect whether the open feature's content has changed externally, then sends a `featureContent` refresh to the editor webview if so.

---

## AgentLauncher

### Responsibilities

Removes the ~40-line block duplicated verbatim in `KanbanPanel._startWithAI()` and `FeatureHeaderProvider`'s `startWithAI` message handler. Both sites: check workspace trust → resolve `workspaceRoot` per-call from `feature.filePath` → look up column from config → build `PromptContext` → call `buildPrompt` → call `launchAgentTerminal`.

`workspaceRoot` is resolved **per call** via `vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))`, falling back to `workspaceFolders[0]`. This is correct for multi-root workspaces and does not block the future workspace-picker story.

The existing `ai/promptBuilder.ts` and `ai/agentLauncher.ts` are unchanged; `AgentLauncher` is a thin coordinator above them.

### API

```ts
class AgentLauncher {
  constructor(extensionUri: vscode.Uri)

  launch(feature: Feature, agent: string, permissionMode: string): void
}
```

---

## Data flow

### Provider-triggered mutation (e.g. drag-and-drop move)

```
KanbanPanel receives 'moveFeature' webview message
  → await repo.moveFeature(id, newStatus, newOrder)
      ├─ updates in-memory Feature[]
      ├─ writes file to disk
      ├─ records written content for echo suppression
      ├─ moves file across done/ boundary if needed
      └─ fires onDidChange(features)
  ← KanbanPanel.onDidChange → _sendFeaturesToWebview()
  ← SidebarViewProvider.onDidChange → posts 'update' to sidebar webview
  (watcher fires ~100ms later — suppressed because content matches last write)
```

### External edit (user edits .md in native text editor)

```
File watcher fires (debounced 100ms)
  → content differs from last write → repo reloads from disk
  → fires onDidChange(features)
  ← KanbanPanel.onDidChange:
      if changed file === _currentEditingFeatureId → sends featureContent refresh
      always calls _sendFeaturesToWebview()
  ← SidebarViewProvider.onDidChange → refreshes stat counts
```

### AI launch

```
KanbanPanel receives 'startWithAI' message  (or FeatureHeaderProvider receives same)
  → check vscode.workspace.isTrusted
  → launcher.launch(feature, agent, permissionMode)
      ├─ resolves workspaceRoot from feature.filePath
      ├─ reads columns from config, finds matching column
      ├─ builds PromptContext → calls buildPrompt()
      └─ calls launchAgentTerminal()
```

---

## Wiring in `activate()`

```ts
export function activate(context: vscode.ExtensionContext) {
  loadBundle(context.extensionPath)

  const repo = new FeatureRepository(context)
  const launcher = new AgentLauncher(context.extensionUri)

  const sidebarProvider = new SidebarViewProvider(context.extensionUri, context, repo)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-extension.open', () => {
      KanbanPanel.createOrShow(context.extensionUri, context, repo, launcher)
      // ... setBoardOpen wiring unchanged
    })
  )

  context.subscriptions.push(
    FeatureHeaderProvider.register(context, repo, launcher)
  )

  context.subscriptions.push(repo)  // repo.dispose() cleans up watcher
  // ... rest unchanged
}
```

---

## Provider thinning summary

### KanbanPanel — removes

- `_getWorkspaceFeaturesDir()` → `repo.getFeaturesDir()`
- `_ensureFeaturesDir()` → repo handles internally
- `_loadFeatures()` (entire method, ~160 lines) → `repo.load()`
- `_setupFileWatcher()` → repo owns watcher
- `_migrating` flag → repo owns it
- `_lastWrittenContent` sentinel → repo owns it per-file
- `_startWithAI()` → `launcher.launch()`
- All direct `vscode.workspace.fs` calls on feature files → repo write methods

### KanbanPanel — keeps

- Webview panel lifecycle and HTML
- Message routing (switch statement)
- Confirmation dialogs (archive, delete/rename label, filename migration)
- `_currentEditingFeatureId` (view concern)
- Editor-content refresh detection
- `_sendFeaturesToWebview()`
- Column/language migration dialogs

### SidebarViewProvider — removes

- `_getFeaturesDir()`
- `_loadFeatures()`
- `_parseFrontmatter()` (stale regex parser — eliminated entirely)
- `_setupFileWatcher()`
- `_debounceTimer`

### SidebarViewProvider — keeps

- Webview view lifecycle and HTML
- Message routing (open board, new feature, open feature)
- Subscribes to `repo.onDidChange`

### FeatureHeaderProvider — removes

- Inline `startWithAI` handler block (~40 lines) → `launcher.launch()`
- Direct `parseFeatureFile` + `launchAgentTerminal` wiring in the handler

### FeatureHeaderProvider — keeps

- Active editor tracking
- `_updateViewForCurrentEditor`, `_hideView`
- `_updateFrontmatter` (calls `repo.updateFeature`)
- HTML and webview lifecycle

### `index.ts` — gains

- `FeatureRepository` construction and disposal
- `AgentLauncher` construction
- Dependency injection into all three providers

---

## New files

- `src/extension/FeatureRepository.ts`
- `src/extension/AgentLauncher.ts`

## Modified files

- `src/extension/KanbanPanel.ts`
- `src/extension/SidebarViewProvider.ts`
- `src/extension/FeatureHeaderProvider.ts`
- `src/extension/index.ts`

---

## Testing

### New

`tests/extension/FeatureRepository.test.ts` — unit tests using an injected in-memory `FsAdapter` (the interface already exists in `featureFileUtils.ts`). Covers:

- `load()`: root files, done/ subfolder files, legacy order migration
- `createFeature`, `moveFeature` (same-status, cross-done-boundary), `updateFeature`, `deleteFeature`
- Echo suppression: watcher fires after own write → no reload, no duplicate `onDidChange`
- External edit: watcher fires for unrecognised write → reload fires `onDidChange`
- `renameLabel`, `deleteLabel`, `migrateFilenames`

### Updated

- `tests/extension/KanbanPanel.startWithAI.test.ts` — inject `AgentLauncher` mock
- `tests/extension/FeatureHeaderProvider.startWithAI.test.ts` — inject `AgentLauncher` mock
- `tests/extension/ai/agentLauncher.test.ts` — may need `AgentLauncher` class tests added

---

## Constraints and dependencies

- Depends on `consolidate-frontmatter-serialization` (done) and `replace-regex-yaml-parser` (done) — the repository wraps one correct implementation of each concern.
- `2026-06-02-replace-devtool-for-kanban-folder` (in todo) touches the same four files. Land that story first to avoid merge conflicts.
- No behaviour change observable to the user. All existing tests pass; new unit tests cover the repository in isolation.
- The workspace-picker story (`workspace-picker-2026-06-03`) is explicitly deferred and depends on this story.
