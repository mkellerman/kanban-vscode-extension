import type { FrameworkAdapter } from './frameworks/FrameworkAdapter'
import { NativeAdapter } from './frameworks/NativeAdapter'
import { SuperpowersAdapter } from './frameworks/SuperpowersAdapter'
import { BmadAdapter } from './frameworks/BmadAdapter'
import { SpecKitAdapter } from './frameworks/SpecKitAdapter'
import { parseFeatureId, type FrameworkId } from '../shared/frameworks/types'

export const ALL_ADAPTERS: FrameworkAdapter[] = [
  new NativeAdapter(),
  new SuperpowersAdapter(),
  new BmadAdapter(),
  new SpecKitAdapter(),
]

export async function getActiveAdapters(
  workspaceRoot: string,
  setting: 'auto' | FrameworkId
): Promise<FrameworkAdapter[]> {
  if (setting !== 'auto') {
    const adapter = ALL_ADAPTERS.find(a => a.id === setting)
    return adapter ? [adapter] : []
  }

  const results = await Promise.all(
    ALL_ADAPTERS.map(async adapter => ({ adapter, found: await adapter.detect(workspaceRoot) }))
  )
  const detected = results.filter(r => r.found).map(r => r.adapter)

  if (detected.length === 0) {
    const native = ALL_ADAPTERS.find(a => a.id === 'native')!
    return [native]
  }

  return detected
}

export function adapterForFeature(
  featureId: string,
  adapters: FrameworkAdapter[]
): FrameworkAdapter | null {
  const parsed = parseFeatureId(featureId)
  if (!parsed) return null
  return adapters.find(a => a.id === parsed.frameworkId) ?? null
}
