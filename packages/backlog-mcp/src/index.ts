/**
 * @kanban/backlog-mcp — library surface (stub).
 *
 * The Kanban Board imports these functions in-process; the MCP server (server.ts)
 * wraps the same functions as tools. In this stub they read FIXTURES; the MCP track
 * replaces the data source with real framework + session adapters — the signatures
 * (the contract) stay put.
 */
export * from './contract'

import type {
  WorkItem, Session, DependencyGraph, FrameworkInfo, NormStatus
} from './contract'
import { FIXTURE_WORK_ITEMS, FIXTURE_SESSIONS } from './fixtures'

const STARTABLE: NormStatus[] = ['backlog', 'todo']

export interface WorkItemFilter {
  type?: string
  status?: string
  framework?: string
  parent?: string | null
}

export function listWorkItems(filter: WorkItemFilter = {}): WorkItem[] {
  return FIXTURE_WORK_ITEMS.filter(
    (i) =>
      (!filter.type || i.type === filter.type) &&
      (!filter.status || i.status === filter.status) &&
      (!filter.framework || i.source.framework === filter.framework) &&
      (filter.parent === undefined || i.parent === filter.parent)
  )
}

export function getWorkItem(id: string): WorkItem | undefined {
  return FIXTURE_WORK_ITEMS.find((i) => i.id === id)
}

export function getItemBody(id: string): string {
  const item = getWorkItem(id)
  return item ? `# ${item.title}\n\n_(stub body for ${id})_` : ''
}

export function detectFrameworks(): FrameworkInfo[] {
  const counts = new Map<string, number>()
  for (const i of FIXTURE_WORK_ITEMS) {
    counts.set(i.source.framework, (counts.get(i.source.framework) ?? 0) + 1)
  }
  return [...counts].map(([framework, itemCount]) => ({ framework, root: process.cwd(), itemCount }))
}

export function listSessions(filter: { project?: string; workItemId?: string } = {}): Session[] {
  return FIXTURE_SESSIONS.filter(
    (s) =>
      (!filter.project || s.project === filter.project) &&
      (filter.workItemId === undefined || s.workItemId === filter.workItemId)
  )
}

export function getSession(id: string): Session | undefined {
  return FIXTURE_SESSIONS.find((s) => s.id === id)
}

/** Objective dependency graph over the items — cycle-safe (visited-guarded DFS). */
export function dependencyGraph(items: WorkItem[] = FIXTURE_WORK_ITEMS): DependencyGraph {
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
