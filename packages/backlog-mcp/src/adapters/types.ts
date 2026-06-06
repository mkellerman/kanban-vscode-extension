import type { WorkItem, WorkItemType, NormStatus, Priority } from '../contract'

/** The project root (and, later, scope) an adapter reads. */
export interface AdapterContext {
  /** absolute path of the project root to read */
  root: string
}

export interface CreateItemInput {
  type: WorkItemType
  title: string
  status?: NormStatus
  priority?: Priority | null
  parent?: string | null       // normalized id e.g. "native:my-epic"
  dependsOn?: string[]         // normalized ids
  labels?: string[]
  estimate?: string | null
  acceptanceCriteria?: string[]
  body?: string                // full markdown body; defaults to "# {title}\n"
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

/**
 * A framework adapter normalizes one source (native/superpowers/bmad/github/…)
 * into WorkItems. Foreign adapters are read-only; `native` implements setStatus.
 */
export interface FrameworkAdapter {
  name: string
  /** is this framework present under ctx.root? */
  detect(ctx: AdapterContext): Promise<boolean>
  /** read + normalize all work items under ctx.root */
  listItems(ctx: AdapterContext): Promise<WorkItem[]>
  /** full body text for an id this adapter owns */
  getBody(ctx: AdapterContext, id: string): Promise<string>
  /** set status (native is read+write; foreign adapters omit this) */
  setStatus?(ctx: AdapterContext, id: string, status: string): Promise<void>
  /** create a new item (native only); returns the created WorkItem */
  createItem?(ctx: AdapterContext, input: CreateItemInput): Promise<WorkItem>
  /** patch frontmatter (and title/AC in body); returns the updated WorkItem */
  updateItem?(ctx: AdapterContext, id: string, patch: ItemPatch): Promise<WorkItem>
  /** replace the markdown body; frontmatter unchanged */
  setBody?(ctx: AdapterContext, id: string, body: string): Promise<void>
  /** remove the item's entire folder */
  deleteItem?(ctx: AdapterContext, id: string): Promise<void>
}
