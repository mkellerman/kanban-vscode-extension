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

  // Reverse edges: blocker → dependents
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

  function buildNode(id: string): SequenceNode {
    const feature = byId.get(id)!
    const childIds = reverse.get(id) ?? []
    const childFeatures = childIds
      .map(cid => byId.get(cid)!)
      .sort(compareFeatures)
    return {
      feature,
      children: childFeatures.map(child => buildNode(child.id)),
    }
  }

  const groups: SequenceGroup[] = roots.map(root => ({ root: buildNode(root.id) }))

  return {
    groups,
    blocksCount: new Map(),
    warnings,
  }
}
