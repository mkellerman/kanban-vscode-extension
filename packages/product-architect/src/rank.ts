/**
 * The PA's *opinionated* ordering of the ready set (decision: the MCP gives the
 * objective graph; the PA ranks). Pure + testable.
 *
 * Note: `age` and `order` tie-breakers from the spec aren't applied yet — the
 * WorkItem contract doesn't expose `created`/`order` (the native adapter drops
 * them). Add them to the contract/overlay to enable; for now: priority → unblock-impact.
 */
import type { WorkItem } from '@kanban/backlog-mcp'

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/** How many items list `id` in their dependsOn (direct unblock-impact). */
export function unblockImpact(all: WorkItem[]): (id: string) => number {
  return (id) => all.filter((w) => w.dependsOn.includes(id)).length
}

/** Rank ready items: priority → unblock-impact (desc) → id (stable tie-break). */
export function rankReady(ready: WorkItem[], all: WorkItem[]): WorkItem[] {
  const impact = unblockImpact(all)
  return [...ready].sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority ?? 'medium'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'medium'] ?? 2) ||
      impact(b.id) - impact(a.id) ||
      a.id.localeCompare(b.id)
  )
}
