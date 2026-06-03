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

const VALID_PERMISSION_MODES = new Set(['default', 'plan', 'acceptEdits', 'bypassPermissions'])

export function launchAgentTerminal(
  // agent may be a config-sourced string; allow-list handles unknown values
  agent: string,
  permissionMode: string,
  prompt: string,
  cwd: string | undefined,
  terminalTitle?: string
): void {
  const safeAgent = VALID_AGENTS.has(agent) ? agent : 'claude'
  const safeMode = VALID_PERMISSION_MODES.has(permissionMode) ? permissionMode : 'default'

  // safeAgent is always one of the four VALID_AGENTS strings (or the 'claude' fallback)
  let args: string[] = [prompt]
  switch (safeAgent) {
    case 'claude': {
      args = []
      // claude --permission-mode accepts: plan, acceptEdits, bypassPermissions
      // (omit flag entirely for 'default' to use the CLI's default behavior)
      if (safeMode !== 'default') {
        args.push('--permission-mode', safeMode)
      }
      args.push(prompt)
      break
    }
    case 'codex': {
      // APPROVAL_MODE covers all four VALID_PERMISSION_MODES; ?? 'ask' is unreachable
      // under the current allow-list — kept as defense-in-depth.
      const approvalMode = APPROVAL_MODE[safeMode] ?? 'ask'
      args = ['--ask-for-approval', approvalMode, prompt]
      break
    }
    case 'copilot':
    case 'opencode':
      args = [prompt]
      break
  }

  const terminal = vscode.window.createTerminal({
    name: terminalTitle ?? AGENT_NAMES[safeAgent] ?? 'AI Agent',
    // TODO: on Windows, PATH resolution for agent binaries installed via nvm or
    // package managers may fail when VS Code is launched from the Dock rather
    // than a shell. Resolving the full path via `which`/`where` is deferred to
    // the extract-feature-repository-service-2026-06-02 story.
    shellPath: safeAgent,
    shellArgs: args,
    cwd
  })
  terminal.show()
}
