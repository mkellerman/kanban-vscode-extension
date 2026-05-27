export type FrameworkId = 'native' | 'superpowers' | 'spec-kit' | 'bmad'

const VALID_FRAMEWORK_IDS: readonly FrameworkId[] = ['native', 'superpowers', 'spec-kit', 'bmad']

export function makeFeatureId(frameworkId: FrameworkId, localId: string): string {
  return `${frameworkId}:${localId}`
}

export function parseFeatureId(featureId: string): { frameworkId: FrameworkId; localId: string } | null {
  const colonIndex = featureId.indexOf(':')
  if (colonIndex === -1) return null
  const frameworkId = featureId.slice(0, colonIndex)
  if (!(VALID_FRAMEWORK_IDS as readonly string[]).includes(frameworkId)) return null
  const localId = featureId.slice(colonIndex + 1)
  if (!localId) return null
  return { frameworkId: frameworkId as FrameworkId, localId }
}
