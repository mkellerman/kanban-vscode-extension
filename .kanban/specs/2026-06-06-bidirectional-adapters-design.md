# Design: Bidirectional Adapters — Full CRUD on the Native Adapter

**Date:** 2026-06-06
**Status:** spec v1 — pending user review
**Relationship:** Extends `packages/backlog-mcp`. See `.kanban/specs/2026-06-06-backlog-mcp-design.md`.

---

## 1. Problem & goal

The Backlog MCP's `FrameworkAdapter` currently has one write operation: `setStatus?` (native only,
not yet exposed as an MCP tool). Agents and the Kanban Board need to create, update, and delete
work items through the same normalized interface — not by reaching into raw files themselves.

**Goal:** add a full CRUD write surface to the native adapter, expose it via new MCP tools, and
extend the library API accordingly. Foreign adapters remain read-only; they can opt in per-method
later.

**Development discipline:** all implementation done test-first (TDD).

---

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Write pattern | Optional methods on `FrameworkAdapter` — consistent with the existing `setStatus?` pattern; partial write support is natural; each capability is individually introspectable |
| 2 | File organization | MCP adapter writes frontmatter in place, wherever the file is. Physical folder moves (e.g. to `done/`) are the Kanban Board extension's concern, not the MCP's |
| 3 | Item types on disk | All types (`epic`, `feature`, `story`, `task`, `spec`, `plan`) are a `story.md` in a per-id folder; `type` lives in frontmatter. No separate file layout per type |
| 4 | createItem target | Always routes to the native adapter (no `id` yet to dispatch on); other adapters are not create targets |
| 5 | Write scope | Native implements all four new methods; foreign adapters: read-only, throw `"read-only or unknown adapter"` |

---

## 3. Adapter contract changes (`types.ts`)

Two new input types, four new optional methods on `FrameworkAdapter`:

```ts
export interface CreateItemInput {
  type: WorkItemType
  title: string
  status?: NormStatus           // defaults to 'backlog'
  priority?: Priority | null
  parent?: string | null        // normalized id
  dependsOn?: string[]
  labels?: string[]
  estimate?: string | null
  acceptanceCriteria?: string[]
  body?: string                 // initial markdown body
}

export interface ItemPatch {
  title?: string
  status?: NormStatus
  priority?: Priority | null
  parent?: string | null
  dependsOn?: string[]
  labels?: string[]
  estimate?: string | null
  acceptanceCriteria?: string[]
}

// Additions to FrameworkAdapter (all optional — foreign adapters omit them):
createItem?(ctx: AdapterContext, input: CreateItemInput): Promise<WorkItem>
updateItem?(ctx: AdapterContext, id: string, patch: ItemPatch): Promise<WorkItem>
setBody?(ctx: AdapterContext, id: string, body: string): Promise<void>
deleteItem?(ctx: AdapterContext, id: string): Promise<void>
```

`setStatus?` is unchanged.

---

## 4. Native adapter implementation (`adapters/native.ts`)

### 4.1 `resolveStoryPath`

The current `storyPath()` always returns `features/<id>/story.md`, which breaks writes against
items already in `done/`. Replace it with:

```ts
async function resolveStoryPath(root: string, folderId: string)
  : Promise<{ path: string; folderPath: string; inDone: boolean }>
```

Tries `features/<id>/story.md` first, then `features/done/<id>/story.md`, throws if neither exists.
Used by all read and write operations that target a specific item.

### 4.2 ID generation

`createItem` derives a stable id:
1. Slugify title: lowercase, spaces → hyphens, strip non-alphanumeric/hyphen chars
2. Append `-YYYY-MM-DD` from current date
3. If `features/<slug-date>/` already exists, append `-2`, `-3`, etc.
4. Final normalized id: `native:<slug-date>`

### 4.3 Operations

**`createItem(ctx, input)`**
- Generate id (§4.2)
- Create `features/<id>/` directory
- Serialize frontmatter from input + generated fields (`id`, `created`, `modified`)
- Write `features/<id>/story.md`
- Return `toWorkItem(...)` of the new file

**`updateItem(ctx, itemId, patch)`**
- Resolve path via `resolveStoryPath`
- Read current file, split frontmatter
- Merge patch fields into frontmatter; set `modified` to now
- Write back in place (no folder move — Board handles that)
- Return `toWorkItem(...)` of the updated file

**`setBody(ctx, itemId, body)`**
- Resolve path via `resolveStoryPath`
- Read current file, split frontmatter
- Write back with original frontmatter + new body
- No `modified` bump — `modified` tracks frontmatter changes; body edits are intentionally not recorded there

**`deleteItem(ctx, itemId)`**
- Resolve path via `resolveStoryPath` (to locate correct folder)
- Remove entire `<id>/` folder with `fs.rm({ recursive: true })`

### 4.4 `setStatus` fix

Existing `setStatus` is updated to use `resolveStoryPath` instead of the broken `storyPath()`.

---

## 5. Library API additions (`index.ts`)

```ts
export async function createItem(input: CreateItemInput): Promise<WorkItem>
export async function updateItem(id: string, patch: ItemPatch): Promise<WorkItem>
export async function setBody(id: string, body: string): Promise<void>
export async function deleteItem(id: string): Promise<void>
```

- `createItem` routes directly to `nativeAdapter` (no id to dispatch on yet)
- `updateItem`, `setBody`, `deleteItem` dispatch via `registry.adapterFor(id)`, throw
  `"read-only or unknown adapter for \"{id}\""` if the method is absent
- All four follow the same pattern as the existing `setStatus` export

---

## 6. MCP surface

### 6.1 New input schemas (`contract.ts`)

These are Zod raw shapes for the MCP SDK — distinct from the TypeScript `CreateItemInput` /
`ItemPatch` interfaces in `types.ts` which the adapter contract uses directly.

```ts
export const SetStatusInput       = { id: z.string(), status: z.enum(NORM_STATUS) }
export const CreateItemInputShape = {
  type:               z.enum(WORK_ITEM_TYPE),
  title:              z.string(),
  status:             z.enum(NORM_STATUS).optional(),
  priority:           z.enum(PRIORITY).nullish(),
  parent:             z.string().nullish(),
  dependsOn:          z.array(z.string()).optional(),
  labels:             z.array(z.string()).optional(),
  estimate:           z.string().nullish(),
  acceptanceCriteria: z.array(z.string()).optional(),
  body:               z.string().optional(),
}
export const UpdateItemInputShape = {
  id:    z.string(),
  patch: z.object({
    title:              z.string().optional(),
    status:             z.enum(NORM_STATUS).optional(),
    priority:           z.enum(PRIORITY).nullish(),
    parent:             z.string().nullish(),
    dependsOn:          z.array(z.string()).optional(),
    labels:             z.array(z.string()).optional(),
    estimate:           z.string().nullish(),
    acceptanceCriteria: z.array(z.string()).optional(),
  }),
}
export const SetBodyInput = { id: z.string(), body: z.string() }
// deleteItem reuses IdInput
```

### 6.2 New tool descriptions (`contract.ts`)

```ts
set_status:  'Set the status of a work item by id (native adapter only).',
create_item: 'Create a new work item in the native adapter. Returns the created WorkItem.',
update_item: 'Patch frontmatter fields of an existing work item. Returns the updated WorkItem.',
set_body:    'Replace the markdown body of a work item (frontmatter unchanged).',
delete_item: 'Delete a work item and its entire folder (native adapter only).',
```

### 6.3 New tools in `server.ts`

Five `server.registerTool(...)` calls following the existing pattern, delegating to `lib.setStatus`,
`lib.createItem`, `lib.updateItem`, `lib.setBody`, `lib.deleteItem`.

---

## 7. Testing (TDD)

All implementation is test-first. Write the failing test, implement the minimum to pass, refactor.

### 7.1 Native adapter unit tests (`adapters/native.test.ts`)

- **`resolveStoryPath`**: finds in `features/`, finds in `done/`, throws on missing
- **`createItem`**: creates folder + `story.md`; returned `WorkItem` has correct id/type/title;
  conflict-suffix when slug collides; `listItems` finds it
- **`updateItem`**: patches fields; untouched fields unchanged; `modified` bumped;
  resolves correctly when item is in `done/`
- **`setBody`**: body replaced; frontmatter unchanged; resolves correctly from `done/`
- **`deleteItem`**: folder gone after call; works from both `features/` and `done/`
- **`setStatus` fix**: correctly writes item that lives in `done/`

### 7.2 Adapter conformance suite

Extend the shared conformance test all write-capable adapters must pass:
> `createItem` → `listItems` finds it → `updateItem` patches it → `getBody` reflects `setBody`
> → `deleteItem` removes it → `listItems` no longer finds it

### 7.3 Library-level tests (`index.test.ts`)

- `createItem` routes to native adapter
- `updateItem` / `setBody` / `deleteItem` on a foreign id throw `"read-only"`

### 7.4 MCP smoke test

Over a temp workspace: `create_item` tool call returns a valid `WorkItem` → `get_work_item` finds
it → `update_item` patches it → `delete_item` removes it → `get_work_item` returns null.

---

## 8. Non-goals

- Folder moves on status change — the Kanban Board extension owns physical file organization
- Write support for foreign adapters (kanban-markdown, bmad, github) — deferred, opt-in later
- Atomic multi-item transactions
- Conflict detection / optimistic locking
