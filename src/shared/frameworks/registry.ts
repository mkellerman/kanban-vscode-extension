import type { FrameworkId } from './types'

export const FRAMEWORK_INDICATOR_PATHS: Record<FrameworkId, string[]> = {
  native: ['.devtool/features'],
  superpowers: ['.superpowers'],
  'spec-kit': ['.spec-kit'],
  bmad: ['.bmad-core', 'bmad-agent.md'],
}
