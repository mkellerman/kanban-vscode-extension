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
  const visible = features.filter(f => visibleStatuses.has(f.status))

  // Sort visible features as roots (no deps handled yet in this task)
  const sortedRoots = [...visible].sort(compareFeatures)

  const groups: SequenceGroup[] = sortedRoots.map(feature => ({
    root: { feature, children: [] },
  }))

  return {
    groups,
    blocksCount: new Map(),
    warnings: [],
  }
}
