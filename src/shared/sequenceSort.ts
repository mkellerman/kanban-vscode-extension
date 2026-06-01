import type { Feature, FeatureStatus, Priority } from './types'

export interface SequenceNode {
  feature: Feature
  children: SequenceNode[]
}

export interface SequenceGroup {
  root: SequenceNode
}

export type SequenceWarning =
  | { kind: 'cycle'; edge: { from: string; to: string } }
  | { kind: 'unknown-id'; id: string }

export interface SequenceResult {
  groups: SequenceGroup[]
  blocksCount: Map<string, number>
  warnings: SequenceWarning[]
}

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function compareFeatures(a: Feature, b: Feature): number {
  const pa = PRIORITY_RANK[a.priority]
  const pb = PRIORITY_RANK[b.priority]
  if (pa !== pb) return pa - pb

  // nulls last
  const da = a.dueDate
  const db = b.dueDate
  if (da !== db) {
    if (da === null) return 1
    if (db === null) return -1
    return da < db ? -1 : 1
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Detect cycles in the dependency edges (dependent → blockers) and return a list of
 * edges to drop. The edge dropped per cycle is the one ENTERING the lowest-priority
 * node in the cycle (ties broken by latest due date, then highest id).
 */
function detectCyclesAndPickBreaks(
  effectiveDeps: Map<string, string[]>,
  byId: Map<string, Feature>,
): Array<{ from: string; to: string }> {
  const breaks: Array<{ from: string; to: string }> = []
  const color = new Map<string, 'white' | 'gray' | 'black'>()
  for (const id of effectiveDeps.keys()) color.set(id, 'white')

  function dfs(id: string, stack: string[]): void {
    color.set(id, 'gray')
    stack.push(id)
    for (const next of effectiveDeps.get(id) ?? []) {
      const c = color.get(next)
      if (c === 'gray') {
        // Cycle: next..id..next. Slice the cycle out of the stack.
        const cycleStart = stack.indexOf(next)
        const cycle = stack.slice(cycleStart)
        // Pick the lowest-priority node in the cycle (highest sort key).
        let victim = cycle[0]
        for (const node of cycle) {
          if (compareFeatures(byId.get(victim)!, byId.get(node)!) < 0) {
            victim = node
          }
        }
        const cycleSet = new Set(cycle)
        // Warning `from`: the node that victim depends on within the cycle
        // (victim's blocker in the cycle = effectiveDeps[victim] ∩ cycleSet).
        const victimDeps = effectiveDeps.get(victim) ?? []
        const warningFrom = victimDeps.find(d => cycleSet.has(d)) ?? cycle[(cycle.indexOf(victim) - 1 + cycle.length) % cycle.length]
        breaks.push({ from: warningFrom, to: victim })
        // Don't recurse into 'next' — we'll re-run with the edge dropped.
        continue
      }
      if (c === 'white') dfs(next, stack)
    }
    stack.pop()
    color.set(id, 'black')
  }

  for (const id of effectiveDeps.keys()) {
    if (color.get(id) === 'white') dfs(id, [])
  }

  return breaks
}

export function buildSequence(
  features: Feature[],
  visibleStatuses: Set<FeatureStatus>,
): SequenceResult {
  const byId = new Map(features.map(feat => [feat.id, feat]))
  const visible = features.filter(feat => visibleStatuses.has(feat.status))
  const visibleIds = new Set(visible.map(feat => feat.id))

  const warnings: SequenceWarning[] = []
  const seenUnknown = new Set<string>()

  // Effective edges: dependent → blockers (only blockers that are visible and not done)
  const effectiveDeps = new Map<string, string[]>()
  for (const feat of visible) {
    const kept: string[] = []
    for (const depId of feat.dependsOn) {
      if (depId === feat.id) continue // self-reference dropped silently
      const target = byId.get(depId)
      if (!target) {
        if (!seenUnknown.has(depId)) {
          warnings.push({ kind: 'unknown-id', id: depId })
          seenUnknown.add(depId)
        }
        continue
      }
      if (target.status === 'done') continue // satisfied
      if (!visibleIds.has(depId)) continue   // filtered-out treated as satisfied
      kept.push(depId)
    }
    effectiveDeps.set(feat.id, kept)
  }

  // Detect + break cycles BEFORE building reverse edges
  const breaks = detectCyclesAndPickBreaks(effectiveDeps, byId)
  for (const brk of breaks) {
    // brk.to is the victim (lowest-priority node in cycle).
    // brk.from is victim's blocker within the cycle (what victim depends on).
    // To break the cycle, remove victim (brk.to) from the dep list of whichever
    // node depends on victim — i.e., the node that has brk.to in its effectiveDeps.
    for (const [node, deps] of effectiveDeps) {
      if (deps.includes(brk.to)) {
        effectiveDeps.set(node, deps.filter(id => id !== brk.to))
        break
      }
    }
    warnings.push({ kind: 'cycle', edge: brk })
  }

  // Reverse edges (now acyclic) …
  const reverse = new Map<string, string[]>()
  for (const [dependent, blockers] of effectiveDeps) {
    for (const blocker of blockers) {
      const arr = reverse.get(blocker) ?? []
      arr.push(dependent)
      reverse.set(blocker, arr)
    }
  }

  // Roots = visible features with no kept dep edges
  const roots = visible.filter(feat => (effectiveDeps.get(feat.id) ?? []).length === 0)
  roots.sort(compareFeatures)

  function buildNode(id: string, ancestors: Set<string> = new Set()): SequenceNode {
    const feature = byId.get(id)!
    if (ancestors.has(id)) {
      return { feature, children: [] } // defensive: don't recurse into a loop
    }
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(id)
    const childIds = reverse.get(id) ?? []
    const childFeatures = childIds
      .map(cid => byId.get(cid)!)
      .sort(compareFeatures)
    return {
      feature,
      children: childFeatures.map(child => buildNode(child.id, nextAncestors)),
    }
  }

  const groups: SequenceGroup[] = roots.map(root => ({ root: buildNode(root.id) }))

  return {
    groups,
    blocksCount: new Map(),
    warnings,
  }
}
