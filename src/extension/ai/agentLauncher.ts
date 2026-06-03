import * as vscode from 'vscode'

const VALID_AGENTS = new Set(['claude', 'codex', 'copilot', 'opencode'])

const AGENT_NAMES: Record<string, string> = {
  'claude': 'Claude Code',
  'codex': 'Codex',
  'copilot': 'GitHub Copilot',
  'opencode': 'OpenCode'
}

const APPROVAL_MODE: Record<string, string> = {
  'default': 'ask',
  'plan': 'ask',
  'acceptEdits': 'auto',
  'bypassPermissions': 'full-auto'
}

export function launchAgentTerminal(
  agent: string,
  permissionMode: string,
  prompt: string,
  cwd: string | undefined
): void {
  const safeAgent = VALID_AGENTS.has(agent) ? agent : 'claude'

  let args: string[]
  switch (safeAgent) {
    case 'claude': {
      args = []
      if (permissionMode !== 'default') {
        args.push('--permission-mode', permissionMode)
      }
      args.push(prompt)
      break
    }
    case 'codex': {
      const approvalMode = APPROVAL_MODE[permissionMode] || 'suggest'
      args = ['--ask-for-approval', approvalMode, prompt]
      break
    }
    case 'copilot':
    case 'opencode':
    default:
      args = [prompt]
  }

  const terminal = vscode.window.createTerminal({
    name: AGENT_NAMES[safeAgent] || 'AI Agent',
    shellPath: safeAgent,
    shellArgs: args,
    cwd
  })
  terminal.show()
}
