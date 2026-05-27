import { describe, expect, it } from 'vitest'
import { buildAgentInvocation } from '../../../src/extension/ai/agentCommand'

describe('buildAgentInvocation', () => {
  it('builds the claude invocation without duplicating prompt text', () => {
    const invocation = buildAgentInvocation('claude', 'default', 'Break down this story')

    expect(invocation).toEqual({
      command: 'claude',
      args: ['Break down this story'],
      terminalName: 'Claude Code'
    })
  })

  it('adds the claude permission flag when the mode is not default', () => {
    const invocation = buildAgentInvocation('claude', 'acceptEdits', 'Break down this story')

    expect(invocation.args).toEqual(['--permission-mode', 'acceptEdits', 'Break down this story'])
  })

  it('maps codex permission modes to approval flags', () => {
    const invocation = buildAgentInvocation('codex', 'bypassPermissions', 'Break down this story')

    expect(invocation).toEqual({
      command: 'codex',
      args: ['--ask-for-approval', 'full-auto', 'Break down this story'],
      terminalName: 'Codex'
    })
  })
})
