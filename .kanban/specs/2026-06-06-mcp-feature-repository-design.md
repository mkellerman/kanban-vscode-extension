# McpFeatureRepository — full read+write integration for `dataSource=backlog-mcp`

**Date:** 2026-06-06
**Status:** Design approved
**Bug context:** Native (`.kanban/features/*/story.md`) cards on the board do not open the detail view when clicked.

## Problem

`KanbanPanel` and `SidebarViewProvider` look up features in `this._repo.features`
(the file-based `FeatureRepositoryManager`). When `kanban-extension.dataSource` is
set to `backlog-mcp`, the cards displayed on the board are sourced from
`_mcpFeatures` (via `loadBoardFeatures` → `nativeAdapter.listItems`) instead.

Result: every read-side handler that searches `this._repo.features` by id misses
the MCP-sourced cards. The most visible symptom is the click handler
(`_sendFeatureContent`, `KanbanPanel.ts:438`) silently returning without posting
`featureContent`, so the detail panel never opens. The same lookup pattern is
broken in `_openFeatureInNativeEditor`, `openFile`, `_saveFeatureContent`,
`startWithAI`, `laneAction`, and `_archiveAllCards`.

Beyond the lookup mismatch, every **write** path also routes through
`this._repo` and therefore writes through the file-based repo, never the MCP.
For an MCP-backed board, drag-and-drop status changes, edits, creates, deletes,
and archives are all no-ops against the real source.

## Approach

Introduce `McpFeatureRepository implements IFeatureRepository` and pick the
concrete repository at extension activation based on the `dataSource` setting.
The webview-facing classes (`KanbanPanel`, `SidebarViewProvider`) become
data-source-agnostic.

This keeps the existing `IFeatureRepository` boundary intact, removes every
`if (dataSource === 'backlog-mcp')` branch from the panel layer, and gives the
MCP backend a single place to evolve.

## Architecture

### New class: `McpFeatureRepository`

Location: `src/extension/McpFeatureRepository.ts`.

Owns:

- `_features: Feature[]` — cached snapshot from the last `listWorkItems()` call.
- `_emitter: vscode.EventEmitter<readonly Feature[]>` — fires after every
  successful write and after watcher-driven reloads.
- `_watcher: vscode.FileSystemWatcher` on `<root>/.kanban/features/**/story.md`
  (plus `done/**/story.md`). On any create/change/delete:
  1. call `setBoardRoot(root)` to invalidate the MCP library's cached Registry,
  2. re-run `listWorkItems()`,
  3. rebuild `_features` and emit `onDidChange`.
  Debounce identical to `FeatureRepository`'s existing watcher.
- `_root: string | null` — current workspace root.

`setRoot(newRoot)` / `setRootSync(newRoot)`:
update `_root`, invalidate the registry, recreate the watcher, reload.

### Pick-the-repo seam (`extension.ts`)

At activation and whenever `kanban-extension.dataSource` changes:

```ts
const dataSource = vscode.workspace.getConfiguration('kanban-extension')
  .get<string>('dataSource', 'files')
const repo: IFeatureRepository = dataSource === 'backlog-mcp'
  ? new McpFeatureRepository(root)
  : new FeatureRepositoryManager(context, fsAdapter, root)
```

`McpFeatureRepository`'s constructor takes only the workspace root — no
`FsAdapter` (the native adapter owns its own `node:fs/promises` calls) and no
extension context. `FeatureRepositoryManager`'s existing constructor signature
is unchanged.

Existing wiring (`KanbanPanel`, `SidebarViewProvider`, `FeatureHeaderProvider`,
`AgentLauncher`) accepts whichever repo without code changes.

### Method mapping

| `IFeatureRepository` method | MCP-backed implementation |
|---|---|
| `features` | `_features` snapshot |
| `schema` | `'feature'` |
| `getEffectiveRoot()` | `_root` |
| `getFeaturesDir()` | `path.join(_root, '.kanban', 'features')` |
| `load()` | `setBoardRoot(_root)` → `listWorkItems()` → rebuild + emit |
| `createFeature(data)` | `createItem({ type: 'story', title: getTitleFromContent(data.content), status: data.status, priority: data.priority, parent: data.epic, labels: data.labels, assignee: data.assignee, dueDate: data.dueDate, body: data.content })` → reload + emit; returns the new `Feature` (`getTitleFromContent` from `src/shared/types.ts`) |
| `updateFeature(id, updates)` | `updateItem(id, mapPatch(updates))`; if `updates.content` is present, also `setBody(id, updates.content)` → reload + emit |
| `moveFeature(id, newStatus, newOrder)` | single `updateItem(id, { status: newStatus, order: String(newOrder) })` → reload + emit |
| `deleteFeature(id)` | `deleteItem(id)` → reload + emit |
| `moveAllFeatures(src, tgt, epicLane)` | for each id with `status === src` (filtered by `epicLane` via `featureMatchesEpicLane`), `updateItem({ status: tgt })` |
| `archiveFeatures(col)` | for each id with `status === col`, `updateItem({ status: 'done' })`; returns `{ failedCount }`. Note: the native adapter does not physically move the folder into `done/` — same in-place behaviour it already has for `setStatus`. |
| `renameLabel(old, new)` | iterate `_features`; for each containing `old`, `updateItem({ labels: replaced })`. Returns count. |
| `deleteLabel(name)` | symmetric: filter the label out and `updateItem({ labels })`. |
| `migrateFilenames(_)` | no-op; returns `{ renamed: 0, skipped: 0 }`. Folder naming is owned by the native adapter. |
| `dispose()` | dispose watcher + emitter |

### Detail-view body fetch

`WorkItem`s carry only a `bodyRef`; the full markdown body is fetched on demand
via `getItemBody(id)`. We add an optional method to the repo interface:

```ts
getBody?(featureId: string): Promise<string>
```

- File-based repo: omit (or return `feature.content`).
- MCP-backed repo: `await getItemBody(featureId)`.

`KanbanPanel._sendFeatureContent` becomes:

```ts
const feature = this._repo.features.find(f => f.id === featureId)
if (!feature) return
const content = this._repo.getBody
  ? await this._repo.getBody(featureId)
  : feature.content
// …post featureContent with `content`
```

This is the **only** data-source-aware seam that remains in `KanbanPanel`.

### Contract extensions in `@kanban/backlog-mcp`

In `packages/backlog-mcp/src/adapters/types.ts`:

```ts
export interface ItemPatch {
  // …existing…
  order?: string | null
  assignee?: string | null
  dueDate?: string | null
}

export interface CreateItemInput {
  // …existing…
  order?: string | null
  assignee?: string | null
  dueDate?: string | null
}
```

In `packages/backlog-mcp/src/contract.ts`, extend `WorkItemSchema` (the source
of truth — `WorkItem` is inferred from it) with optional typed fields so the
round-trip is explicit (no `_extraFrontmatter` lean):

```ts
export const WorkItemSchema = z.object({
  // …existing fields…
  order:       z.string().nullish(),
  assignee:    z.string().nullish(),
  dueDate:     z.string().nullish(),
  created:     z.string().nullish(),
  modified:    z.string().nullish(),
  completedAt: z.string().nullish(),
})
```

Also extend the MCP tool input schemas so writes can carry these fields end-to-end:

- `CreateItemInputShape` gains `order`, `assignee`, `dueDate` (all `nullish`).
- `UpdateItemInputShape.patch` gains `order`, `assignee`, `dueDate` (all `nullish`).

`created`, `modified`, and `completedAt` are read-only on the contract — the
native adapter manages `modified` automatically on every write and writes
`created` once on `createItem`. They're added to the schema so the WorkItem
round-trip preserves them; they are not exposed in `ItemPatch`/`CreateItemInput`.

In `packages/backlog-mcp/src/adapters/native.ts`:

- `toWorkItem` reads `fm.order`, `fm.assignee`, `fm.dueDate`, `fm.created`,
  `fm.modified`, `fm.completedAt` into the WorkItem.
- `nativeAdapter.updateItem` writes `order`/`assignee`/`dueDate` to frontmatter
  when the patch contains them, and writes `fm.completedAt = new Date()`
  whenever a patch transitions `status` to `'done'`.
- `nativeAdapter.createItem` accepts `order`/`assignee`/`dueDate` on
  `CreateItemInput` and persists them in the initial frontmatter.

In `packages/backlog-mcp/src/server.ts`, the registered tool handlers for
`create_item` and `update_item` already accept the input shape via
`CreateItemInputShape` / `UpdateItemInputShape`, so extending the shapes is
sufficient — no per-handler changes.

### `Feature` ↔ `WorkItem` mapping

The existing `toFeature` (currently in `workItemSource.ts`) moves into
`McpFeatureRepository` and is updated to read the new typed fields:

```ts
function toFeature(wi: WorkItem): Feature {
  const now = new Date().toISOString()
  return {
    id: wi.id,
    status: toFeatureStatus(wi.status),
    priority: (wi.priority ?? 'medium') as Priority,
    assignee: wi.assignee ?? null,
    epic: wi.parent,
    dueDate: wi.dueDate ?? null,
    created: wi.created ?? now,
    modified: wi.modified ?? now,
    completedAt: wi.completedAt ?? null,
    labels: wi.labels,
    order: wi.order ?? 'a0',
    workspace: null,
    content: `# ${wi.title}\n`, // placeholder; real body fetched via getBody on demand
    filePath: wi.source.path,
    _extraFrontmatter: {
      source: wi.source.framework,
      dependsOn: wi.dependsOn.join(',')
    }
  }
}
```

The reverse direction lives in `McpFeatureRepository.mapPatch(updates)`.

### Status mapping caveat

`toFeatureStatus` collapses `blocked → todo` and `cancelled → done` for display.
Native stories use only the canonical 5 statuses today, so the write path is a
no-op for those collapses. A future foreign adapter with `blocked`/`cancelled`
items would lose fidelity on writes through the board. This is documented in
the `toFeatureStatus` doc comment but **not addressed in this slice**.

### Files removed / replaced

- `src/extension/workItemSource.ts` — deleted. `toFeature` moves into
  `McpFeatureRepository`. `loadBoardFeatures` is superseded by `load()`.
- `KanbanPanel._mcpFeatures`, `_refreshMcpFeatures`, every
  `this._dataSource() === 'backlog-mcp'` branch — deleted.
- `SidebarViewProvider._mcpFeatures`, `_refreshMcpFeatures`,
  `_effectiveFeatures`, every `this._dataSource() === 'backlog-mcp'`
  branch — deleted.
- The `dataSource` config setting itself is **not** removed — `extension.ts`
  still reads it to choose the repo; `KanbanPanel`/`SidebarViewProvider`
  no longer touch it.

## Tests

### Vitest, node env

- `tests/extension/McpFeatureRepository.test.ts`:
  Build a tmpdir with a sample `.kanban/features/foo/story.md`, instantiate
  `McpFeatureRepository(tmpdir)`, exercise `load`, `createFeature`,
  `updateFeature` (including content body), `moveFeature`, `deleteFeature`,
  `moveAllFeatures`, `archiveFeatures`, `renameLabel`, `deleteLabel`. Each
  write asserts:
  1. `onDidChange` fired with the new snapshot,
  2. the on-disk `story.md` reflects the change,
  3. a follow-up `listWorkItems()` round-trips correctly.

- `tests/backlog-mcp/native.test.ts` (extend existing file):
  - `updateItem({ order, assignee, dueDate })` persists each to frontmatter.
  - `createItem({ order, assignee, dueDate })` writes the initial frontmatter
    with those fields.
  - `listItems()` surfaces them on `WorkItem`.

- `tests/extension/KanbanPanel.test.ts` (if such a fixture exists for the
  file-based path, no MCP plumbing needed). Otherwise rely on the
  `McpFeatureRepository` tests above; the panel becomes source-agnostic.

### Integration / manual

Manual verification step requires `/visual-walkthrough` evidence
(per project policy):

1. Open the board with `dataSource: backlog-mcp` and the existing native
   stories present.
2. Click a card → detail view opens with the story body.
3. Drag a card between columns → on-disk `story.md` `status` updates.
4. Edit body in the detail view → on-disk body updates.
5. Create a new story from the board → new folder + `story.md` appear.
6. Delete a story → folder is removed.
7. External edit to a `story.md` while the board is open → board refreshes
   within ~500ms.

## Non-goals

- Multi-adapter writes (only the `native` adapter supports writes; foreign
  adapter ids will continue to throw on write — matches today's MCP library
  semantics).
- `_extraFrontmatter` write surface beyond the typed fields above.
- Removing the `dataSource` setting or auto-detecting the source.
- Physically moving stories to `.kanban/features/done/` on archive (native
  adapter writes in place; that's a separate slice if we decide we want it).
- Fixing the `blocked`/`cancelled` round-trip collapse (documented; deferred).

## Acceptance criteria

- [ ] With `dataSource: backlog-mcp`, clicking a native story opens the detail
      panel with the real markdown body.
- [ ] Drag-and-drop status change persists to the `story.md` frontmatter.
- [ ] Detail-view edits (body, status, priority, assignee, dueDate, labels,
      epic, order) persist to disk.
- [ ] Creating a new story from the board writes a new
      `.kanban/features/<slug>-<date>/story.md`.
- [ ] Deleting a story removes the folder.
- [ ] External edits to `.kanban/features/**/story.md` refresh the board.
- [ ] `KanbanPanel` and `SidebarViewProvider` contain no
      `kanban-extension.dataSource` references.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
