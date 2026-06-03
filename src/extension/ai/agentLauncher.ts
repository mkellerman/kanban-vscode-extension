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
  // agent may be a config-sourced string; allow-list handles unknown values
  agent: string,
  permissionMode: string,
  prompt: string,
  cwd: string | undefined
): void {
  const safeAgent = VALID_AGENTS.has(agent) ? agent : 'claude'

  // safeAgent is always one of the four VALID_AGENTS strings (or the 'claude' fallback)
  let args: string[] = [prompt]
  switch (safeAgent) {
    case 'claude': {
      args = []
      // claude --permission-mode accepts: plan, acceptEdits, bypassPermissions
      // (omit flag entirely for 'default' to use the CLI's default behavior)
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
      args = [prompt]
      break
  }

  const terminal = vscode.window.createTerminal({
    name: AGENT_NAMES[safeAgent] || 'AI Agent',
    shellPath: safeAgent,
    shellArgs: args,
    cwd
  })
  terminal.show()
}
