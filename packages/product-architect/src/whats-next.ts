/** Compose the Backlog MCP's objective graph with the PA's opinionated ranking. */
import { listWorkItems, dependencyGraph, type WorkItem } from '@kanban/backlog-mcp'
import { rankReady } from './rank'

export interface WhatsNext {
  ready: WorkItem[] // ranked
  blocked: { id: string; waitingOn: string[] }[]
}

/** "What's next" — the ranked ready set + the blocked list, sourced from the MCP. */
export async function whatsNext(): Promise<WhatsNext> {
  const all = await listWorkItems()
  const graph = await dependencyGraph()
  const readyItems = all.filter((w) => graph.readySet.includes(w.id))
  return { ready: rankReady(readyItems, all), blocked: graph.blocked }
}
