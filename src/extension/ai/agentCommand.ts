import type { AIAgent, AIPermissionMode } from '../../shared/types'

export interface AgentInvocation {
  command: string
  args: string[]
  terminalName: string
}

const TERMINAL_NAMES: Record<AIAgent | string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  opencode: 'OpenCode'
}

const CODEX_APPROVAL_MODES: Record<string, string> = {
  default: 'ask',
  plan: 'ask',
  acceptEdits: 'auto',
  bypassPermissions: 'full-auto'
}

export function buildAgentInvocation(
  agent: AIAgent,
  permissionMode: AIPermissionMode,
  prompt: string
): AgentInvocation {
  switch (agent) {
    case 'claude': {
      const args = permissionMode === 'default'
        ? [prompt]
        : ['--permission-mode', permissionMode, prompt]

      return {
        command: agent,
        args,
        terminalName: TERMINAL_NAMES[agent]
      }
    }
    case 'codex': {
      const approvalMode = CODEX_APPROVAL_MODES[permissionMode] || 'suggest'

      return {
        command: agent,
        args: ['--ask-for-approval', approvalMode, prompt],
        terminalName: TERMINAL_NAMES[agent]
      }
    }
    case 'copilot':
    case 'opencode':
      return {
        command: agent,
        args: [prompt],
        terminalName: TERMINAL_NAMES[agent]
      }
    default:
      return {
        command: agent,
        args: [prompt],
        terminalName: 'AI Agent'
      }
  }
}
