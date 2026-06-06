/**
 * @kanban/backlog-mcp — library surface.
 *
 * Work items come from the adapter Registry (real boards); the Kanban Board imports
 * these functions in-process and the MCP server (server.ts) wraps them as tools.
 * Sessions remain fixture-backed until the sessions-domain slice.
 */
export * from './contract'

import type { WorkItem, Session, DependencyGraph, FrameworkInfo, NormStatus } from './contract'
import { readProjectSessions } from './sessions/reader'
export { setSessionsDir } from './sessions/reader'
import { Registry } from './adapters/registry'
import { nativeAdapter } from './adapters/native'
import { kanbanMarkdownAdapter } from './adapters/kanban-markdown'

const STARTABLE: NormStatus[] = ['backlog', 'todo']

let boardRoot = process.env.PA_BOARD_ROOT ?? process.cwd()
let registry: Registry | null = null

/** Point the library at a project root (default: PA_BOARD_ROOT env or cwd). */
export function setBoardRoot(root: string): void {
  boardRoot = root
  registry = null
}

function getRegistry(): Registry {
  if (!registry) registry = new Registry([nativeAdapter, kanbanMarkdownAdapter], { root: boardRoot })
  return registry
}

export interface WorkItemFilter {
  type?: string
  status?: string
  framework?: string
  parent?: string | null
}

export async function listWorkItems(filter: WorkItemFilter = {}): Promise<WorkItem[]> {
  const items = await getRegistry().listItems()
  return items.filter(
    (i) =>
      (!filter.type || i.type === filter.type) &&
      (!filter.status || i.status === filter.status) &&
      (!filter.framework || i.source.framework === filter.framework) &&
      (filter.parent === undefined || i.parent === filter.parent)
  )
}

export async function getWorkItem(id: string): Promise<WorkItem | undefined> {
  return (await getRegistry().listItems()).find((i) => i.id === id)
}

export async function getItemBody(id: string): Promise<string> {
  const adapter = getRegistry().adapterFor(id)
  if (!adapter) return ''
  try {
    return await adapter.getBody(getRegistry().context(), id)
  } catch {
    return ''
  }
}

export async function detectFrameworks(): Promise<FrameworkInfo[]> {
  return getRegistry().detectFrameworks()
}

/** Native adapter is read+write; foreign ids throw (read-only). */
export async function setStatus(id: string, status: string): Promise<void> {
  const adapter = getRegistry().adapterFor(id)
  if (!adapter?.setStatus) throw new Error(`read-only or unknown adapter for "${id}"`)
  await adapter.setStatus(getRegistry().context(), id, status)
}

// ---- Sessions (real JSONL via the reader; project-scoped to the board root) ----

export async function listSessions(filter: { project?: string; workItemId?: string } = {}): Promise<Session[]> {
  const sessions = await readProjectSessions(boardRoot)
  return sessions.filter(
    (s) =>
      (!filter.project || s.project === filter.project) &&
      (filter.workItemId === undefined || s.workItemId === filter.workItemId)
  )
}

export async function getSession(id: string): Promise<Session | undefined> {
  return (await readProjectSessions(boardRoot)).find((s) => s.id === id)
}

// ---- Dependency graph ----

/** Pure, cycle-safe graph over the given items. */
export function computeDependencyGraph(items: WorkItem[]): DependencyGraph {
  const byId = new Map(items.map((i) => [i.id, i]))
  const isDone = (id: string) => byId.get(id)?.status === 'done'
  const startable = (i: WorkItem) => STARTABLE.includes(i.status)

  const readySet = items
    .filter((i) => startable(i) && i.dependsOn.every(isDone))
    .map((i) => i.id)
  const blocked = items
    .filter((i) => startable(i) && !i.dependsOn.every(isDone))
    .map((i) => ({ id: i.id, waitingOn: i.dependsOn.filter((d) => !isDone(d)) }))

  return { readySet, blocked, cycles: detectCycles(items) }
}

function detectCycles(items: WorkItem[]): string[][] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>(items.map((i) => [i.id, WHITE]))
  const stack: string[] = []
  const cycles: string[][] = []
  const visit = (id: string): void => {
    const node = byId.get(id)
    if (!node) return
    color.set(id, GRAY)
    stack.push(id)
    for (const dep of node.dependsOn) {
      if (color.get(dep) === GRAY) cycles.push([...stack.slice(stack.indexOf(dep)), dep])
      else if (color.get(dep) === WHITE) visit(dep)
    }
    stack.pop()
    color.set(id, BLACK)
  }
  for (const i of items) if (color.get(i.id) === WHITE) visit(i.id)
  return cycles
}

/** Graph over the current board. */
export async function dependencyGraph(): Promise<DependencyGraph> {
  return computeDependencyGraph(await listWorkItems())
}
