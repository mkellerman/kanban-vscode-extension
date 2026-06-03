/**
 * Unit tests for launchAgentTerminal — verifies agent allow-list, args construction,
 * cwd pass-through, and terminal name for every supported agent variant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoist shared mocks so they are available inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockShow, mockCreateTerminal } = vi.hoisted(() => {
  const mockShow = vi.fn()
  const mockCreateTerminal = vi.fn(() => ({ show: mockShow }))
  return { mockShow, mockCreateTerminal }
})

// ---------------------------------------------------------------------------
// Mock vscode before any other imports
// ---------------------------------------------------------------------------
vi.mock('vscode', () => ({
  window: {
    createTerminal: mockCreateTerminal
  }
}))

// ---------------------------------------------------------------------------
// Import subject after mocks
// ---------------------------------------------------------------------------
import { launchAgentTerminal } from '../../../src/extension/ai/agentLauncher'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastTerminalOpts() {
  expect(mockCreateTerminal).toHaveBeenCalledOnce()
  return mockCreateTerminal.mock.calls[0][0] as {
    name: string
    shellPath: string
    shellArgs: string[]
    cwd: string | undefined
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('launchAgentTerminal — claude agent', () => {
  it('with permissionMode "default": args is just [prompt] (no --permission-mode flag)', () => {
    launchAgentTerminal('claude', 'default', 'do the thing', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['do the thing'])
  })

  it('with permissionMode "acceptEdits": args includes --permission-mode flag', () => {
    launchAgentTerminal('claude', 'acceptEdits', 'do the thing', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--permission-mode', 'acceptEdits', 'do the thing'])
  })

  it('with permissionMode "bypassPermissions": args includes --permission-mode flag', () => {
    launchAgentTerminal('claude', 'bypassPermissions', 'do the thing', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--permission-mode', 'bypassPermissions', 'do the thing'])
  })

  it('with permissionMode "plan": args includes --permission-mode plan', () => {
    launchAgentTerminal('claude', 'plan', 'do the thing', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--permission-mode', 'plan', 'do the thing'])
  })

  it('sets shellPath to "claude"', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellPath).toBe('claude')
  })

  it('sets name to "Claude Code"', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('Claude Code')
  })
})

describe('launchAgentTerminal — codex agent', () => {
  it('with permissionMode "default": args is ["--ask-for-approval", "ask", prompt]', () => {
    launchAgentTerminal('codex', 'default', 'my prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--ask-for-approval', 'ask', 'my prompt'])
  })

  it('with permissionMode "bypassPermissions": args uses "full-auto"', () => {
    launchAgentTerminal('codex', 'bypassPermissions', 'my prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--ask-for-approval', 'full-auto', 'my prompt'])
  })

  it('with permissionMode "acceptEdits": args uses "auto"', () => {
    launchAgentTerminal('codex', 'acceptEdits', 'my prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--ask-for-approval', 'auto', 'my prompt'])
  })

  it('with permissionMode "plan": args uses "ask"', () => {
    launchAgentTerminal('codex', 'plan', 'my prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--ask-for-approval', 'ask', 'my prompt'])
  })

  it('sets shellPath to "codex"', () => {
    launchAgentTerminal('codex', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellPath).toBe('codex')
  })

  it('sets name to "Codex"', () => {
    launchAgentTerminal('codex', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('Codex')
  })
})

describe('launchAgentTerminal — copilot agent', () => {
  it('args is just [prompt]', () => {
    launchAgentTerminal('copilot', 'default', 'my prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['my prompt'])
  })

  it('sets shellPath to "copilot"', () => {
    launchAgentTerminal('copilot', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellPath).toBe('copilot')
  })

  it('sets name to "GitHub Copilot"', () => {
    launchAgentTerminal('copilot', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('GitHub Copilot')
  })
})

describe('launchAgentTerminal — opencode agent', () => {
  it('args is just [prompt]', () => {
    launchAgentTerminal('opencode', 'default', 'my prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['my prompt'])
  })

  it('sets shellPath to "opencode"', () => {
    launchAgentTerminal('opencode', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellPath).toBe('opencode')
  })

  it('sets name to "OpenCode"', () => {
    launchAgentTerminal('opencode', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('OpenCode')
  })
})

describe('launchAgentTerminal — unknown agent falls back to claude', () => {
  it('shellPath is "claude" for unknown agent', () => {
    launchAgentTerminal('gpt4o', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellPath).toBe('claude')
  })

  it('follows claude args logic: permissionMode "default" → args is just [prompt]', () => {
    launchAgentTerminal('gpt4o', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['prompt'])
  })

  it('follows claude args logic: permissionMode "acceptEdits" → args includes --permission-mode', () => {
    launchAgentTerminal('gpt4o', 'acceptEdits', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.shellArgs).toEqual(['--permission-mode', 'acceptEdits', 'prompt'])
  })
})

describe('launchAgentTerminal — cwd and terminal behavior', () => {
  it('passes cwd through to createTerminal', () => {
    launchAgentTerminal('claude', 'default', 'prompt', '/my/workspace')
    const opts = getLastTerminalOpts()
    expect(opts.cwd).toBe('/my/workspace')
  })

  it('passes undefined cwd through to createTerminal', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.cwd).toBeUndefined()
  })

  it('calls terminal.show() after creating the terminal', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined)
    expect(mockShow).toHaveBeenCalledOnce()
  })
})
