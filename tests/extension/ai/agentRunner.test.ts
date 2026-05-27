import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: mockSpawn
}))

import { runAgentPrompt } from '../../../src/extension/ai/agentRunner'

function makeChildProcess(): {
  child: EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }

  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()

  return { child }
}

describe('runAgentPrompt', () => {
  it('returns trimmed stdout from the selected agent command', async () => {
    const { child } = makeChildProcess()
    mockSpawn.mockReturnValueOnce(child)

    const promise = runAgentPrompt('claude', 'default', 'Break down this story', '/workspace')
    child.stdout.emit('data', '  generated plan  \n')
    child.emit('close', 0)

    await expect(promise).resolves.toBe('generated plan')
    expect(mockSpawn).toHaveBeenCalledWith('claude', ['Break down this story'], {
      cwd: '/workspace',
      env: process.env
    })
  })

  it('includes stderr and exit code in failure messages', async () => {
    const { child } = makeChildProcess()
    mockSpawn.mockReturnValueOnce(child)

    const promise = runAgentPrompt('codex', 'plan', 'Break down this story', '/workspace')
    child.stderr.emit('data', 'permission denied\n')
    child.emit('close', 1)

    await expect(promise).rejects.toThrow('Agent command failed with exit code 1; stderr: permission denied')
  })
})
