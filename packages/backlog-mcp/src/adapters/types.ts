import type { WorkItem } from '../contract'

/** The project root (and, later, scope) an adapter reads. */
export interface AdapterContext {
  /** absolute path of the project root to read */
  root: string
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
  /** native is read+write; foreign adapters omit this (read-only) */
  setStatus?(ctx: AdapterContext, id: string, status: string): Promise<void>
}
