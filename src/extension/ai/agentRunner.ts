import { spawn } from 'node:child_process'
import type { AIAgent, AIPermissionMode } from '../../shared/types'
import { buildAgentInvocation } from './agentCommand'

export async function runAgentPrompt(
  agent: AIAgent,
  permissionMode: AIPermissionMode,
  prompt: string,
  cwd: string
): Promise<string> {
  const { command, args } = buildAgentInvocation(agent, permissionMode, prompt)

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
    })

    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })

    child.on('error', error => {
      reject(new Error(`Agent command failed to start: ${error.message}`))
    })

    child.on('close', code => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      const stderrText = stderr.trim() || '(empty)'
      reject(new Error(`Agent command failed with exit code ${code}; stderr: ${stderrText}`))
    })
  })
}
