# Terminal Title Shows Column Name and Story Title — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When launching an agent terminal from a kanban story, the terminal's title shows `<column display name>: <story title>` (e.g. `To Do: Replace .devtool for .kanban folder`) instead of just the agent name.

**Architecture:** Add an optional `terminalTitle` parameter to `launchAgentTerminal`; use it as the `name` if provided, falling back to the current agent-name default. Both call sites (`FeatureHeaderProvider` and `KanbanPanel`) already have `column.name` and the story title in scope and compose `terminalTitle` before calling.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.window.createTerminal`), Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/extension/ai/agentLauncher.ts` | Add optional `terminalTitle?` parameter; use it in `createTerminal` |
| `src/extension/FeatureHeaderProvider.ts` | Compose `terminalTitle` and pass it to `launchAgentTerminal` |
| `src/extension/KanbanPanel.ts` | Compose `terminalTitle` and pass it to `launchAgentTerminal` |
| `tests/extension/ai/agentLauncher.test.ts` | Add tests for `terminalTitle` override and fallback |

---

### Task 1: Test the `terminalTitle` parameter in `agentLauncher`

**Files:**
- Modify: `tests/extension/ai/agentLauncher.test.ts`

- [ ] **Step 1: Add a new describe block for `terminalTitle` at the end of the test file**

Append after the last `describe` block in `tests/extension/ai/agentLauncher.test.ts`:

```typescript
describe('launchAgentTerminal — terminalTitle override', () => {
  it('uses terminalTitle as the terminal name when provided', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined, 'To Do: My Story')
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('To Do: My Story')
  })

  it('falls back to agent name when terminalTitle is omitted', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined)
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('Claude Code')
  })

  it('falls back to agent name when terminalTitle is undefined', () => {
    launchAgentTerminal('claude', 'default', 'prompt', undefined, undefined)
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('Claude Code')
  })

  it('uses terminalTitle for non-claude agents too', () => {
    launchAgentTerminal('codex', 'default', 'prompt', undefined, 'In Progress: Add auth')
    const opts = getLastTerminalOpts()
    expect(opts.name).toBe('In Progress: Add auth')
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm test -- --reporter=verbose tests/extension/ai/agentLauncher.test.ts
```

Expected: the four new `terminalTitle override` tests FAIL because `launchAgentTerminal` does not yet accept a fifth parameter.

---

### Task 2: Implement the `terminalTitle` parameter in `agentLauncher.ts`

**Files:**
- Modify: `src/extension/ai/agentLauncher.ts`

- [ ] **Step 1: Add the optional parameter to the function signature**

In `src/extension/ai/agentLauncher.ts`, change the function signature from:

```typescript
export function launchAgentTerminal(
  // agent may be a config-sourced string; allow-list handles unknown values
  agent: string,
  permissionMode: string,
  prompt: string,
  cwd: string | undefined
): void {
```

to:

```typescript
export function launchAgentTerminal(
  // agent may be a config-sourced string; allow-list handles unknown values
  agent: string,
  permissionMode: string,
  prompt: string,
  cwd: string | undefined,
  terminalTitle?: string
): void {
```

- [ ] **Step 2: Use `terminalTitle` in `createTerminal`**

Change the `createTerminal` call from:

```typescript
  const terminal = vscode.window.createTerminal({
    name: AGENT_NAMES[safeAgent] || 'AI Agent',
```

to:

```typescript
  const terminal = vscode.window.createTerminal({
    name: terminalTitle ?? AGENT_NAMES[safeAgent] ?? 'AI Agent',
```

- [ ] **Step 3: Run all `agentLauncher` tests to verify they pass**

```bash
pnpm test -- --reporter=verbose tests/extension/ai/agentLauncher.test.ts
```

Expected: all tests PASS, including the four new `terminalTitle override` tests and all pre-existing tests.

- [ ] **Step 4: Commit**

```bash
git add src/extension/ai/agentLauncher.ts tests/extension/ai/agentLauncher.test.ts
git commit -m "feat(agentLauncher): add optional terminalTitle parameter to launchAgentTerminal"
```

---

### Task 3: Pass `terminalTitle` from `FeatureHeaderProvider`

**Files:**
- Modify: `src/extension/FeatureHeaderProvider.ts:129-142`

- [ ] **Step 1: Compose `terminalTitle` and pass it to `launchAgentTerminal`**

In `src/extension/FeatureHeaderProvider.ts`, find the block that builds `ctx` and calls `launchAgentTerminal` (around line 129). The current code is:

```typescript
          const ctx: PromptContext = {
            title: getTitleFromContent(docContent),
            status: fm.status,
            priority: fm.priority,
            labels: fm.labels,
            content: docContent,
            filePath: this._currentDocument.uri.fsPath
          }
          const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)

          const agent: AIAgent = message.agent || 'claude'
          const permissionMode = message.permissionMode || 'default'

          launchAgentTerminal(agent, permissionMode, prompt, workspaceRoot ?? undefined)
```

Replace with:

```typescript
          const ctx: PromptContext = {
            title: getTitleFromContent(docContent),
            status: fm.status,
            priority: fm.priority,
            labels: fm.labels,
            content: docContent,
            filePath: this._currentDocument.uri.fsPath
          }
          const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)

          const agent: AIAgent = message.agent || 'claude'
          const permissionMode = message.permissionMode || 'default'
          const terminalTitle = `${column.name}: ${ctx.title}`

          launchAgentTerminal(agent, permissionMode, prompt, workspaceRoot ?? undefined, terminalTitle)
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/extension/FeatureHeaderProvider.ts
git commit -m "feat(FeatureHeaderProvider): set terminal title to column name and story title"
```

---

### Task 4: Pass `terminalTitle` from `KanbanPanel`

**Files:**
- Modify: `src/extension/KanbanPanel.ts:912-936`

- [ ] **Step 1: Compose `terminalTitle` and pass it to `launchAgentTerminal`**

In `src/extension/KanbanPanel.ts`, find the block that builds `ctx` and calls `launchAgentTerminal` (around line 922). The current code is:

```typescript
    const ctx: PromptContext = {
      title: getTitleFromContent(feature.content),
      status: feature.status,
      priority: feature.priority,
      labels: feature.labels,
      content: feature.content,
      filePath: feature.filePath
    }
    const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)

    // Use provided agent or fall back to config
    const selectedAgent = agent || config.get<string>('aiAgent') || 'claude'
    const selectedPermissionMode = permissionMode || 'default'

    launchAgentTerminal(selectedAgent, selectedPermissionMode, prompt, workspaceRoot ?? undefined)
```

Replace with:

```typescript
    const ctx: PromptContext = {
      title: getTitleFromContent(feature.content),
      status: feature.status,
      priority: feature.priority,
      labels: feature.labels,
      content: feature.content,
      filePath: feature.filePath
    }
    const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)

    // Use provided agent or fall back to config
    const selectedAgent = agent || config.get<string>('aiAgent') || 'claude'
    const selectedPermissionMode = permissionMode || 'default'
    const terminalTitle = `${column.name}: ${ctx.title}`

    launchAgentTerminal(selectedAgent, selectedPermissionMode, prompt, workspaceRoot ?? undefined, terminalTitle)
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/extension/KanbanPanel.ts
git commit -m "feat(KanbanPanel): set terminal title to column name and story title"
```
