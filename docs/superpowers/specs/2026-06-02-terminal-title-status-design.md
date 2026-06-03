# Design: Terminal Title Shows Column Name and Story Title

**Date:** 2026-06-02
**Feature:** When launching an agent terminal from a kanban story, the terminal title is `<column display name>: <story title>` (e.g. `To Do: Replace .devtool for .kanban folder`)

---

## Problem

Terminals launched from kanban stories are currently named after the agent ("Claude Code", "Codex", etc.). When multiple terminals are open, there is no way to tell which story each terminal is working on without switching to it.

## Goal

Terminal titles reflect the kanban story that triggered the launch, giving users an at-a-glance identification of each terminal's context.

## Design

### `launchAgentTerminal` signature

Add an optional `terminalTitle` parameter as the fifth argument:

```typescript
export function launchAgentTerminal(
  agent: string,
  permissionMode: string,
  prompt: string,
  cwd: string | undefined,
  terminalTitle?: string
): void
```

Inside the function, replace the hardcoded terminal name:

```typescript
const terminal = vscode.window.createTerminal({
  name: terminalTitle ?? AGENT_NAMES[safeAgent] ?? 'AI Agent',
  shellPath: safeAgent,
  shellArgs: args,
  cwd
})
```

### Call sites

Both `FeatureHeaderProvider.ts` and `KanbanPanel.ts` already have the column display name (`column.name`) and the story title (`getTitleFromContent(...)`) in scope. Each call site composes the title string and passes it:

```typescript
const terminalTitle = `${column.name}: ${getTitleFromContent(...)}`
launchAgentTerminal(agent, permissionMode, prompt, workspaceRoot ?? undefined, terminalTitle)
```

The title string uses the column's human-readable display name from the kanban config (e.g. `"To Do"`, `"In Progress"`), not the raw status ID.

### Fallback behaviour

`terminalTitle` is optional. Any call site that omits it continues to receive the agent name as the terminal title. No existing callers break.

### Title truncation

VS Code truncates long terminal tab labels in its own UI. No application-level truncation is applied — the full story title is passed to `createTerminal`.

## Scope

- Applies to all agent types (Claude Code, Codex, GitHub Copilot, OpenCode)
- Touches: `src/extension/ai/agentLauncher.ts`, `src/extension/FeatureHeaderProvider.ts`, `src/extension/KanbanPanel.ts`, `tests/extension/ai/agentLauncher.test.ts`

## Testing

Extend `agentLauncher.test.ts`:

1. When `terminalTitle` is provided, `createTerminal` is called with `name: terminalTitle`
2. When `terminalTitle` is omitted, `createTerminal` is called with `name: AGENT_NAMES[agent]` (existing fallback)
