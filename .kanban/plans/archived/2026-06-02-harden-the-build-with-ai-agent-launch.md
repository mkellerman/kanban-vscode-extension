---
id: "2026-06-02-harden-the-build-with-ai-agent-launch"
status: "done"
priority: "high"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-02T23:05:00.000Z"
completedAt: "2026-06-02T23:05:27.000Z"
labels: ["security", "cross-platform"]
order: "a1"
---
# Harden the Build-with-AI agent launch

The agent launch builds a shell command string with POSIX-only single-quote escaping and embeds the card title and description read from the file. On non-POSIX shells the quoting is wrong, risking broken commands or injection from file content.

## Context

Both `KanbanPanel._startWithAI` (line 898) and `FeatureHeaderProvider`'s `startWithAI` handler (line 101) call `terminal.sendText([_shellQuote(agent), ...args.map(_shellQuote)].join(' '))`. The `_shellQuote` function uses POSIX `'\''` escaping (line 337 in `KanbanPanel.ts`, line 286 in `FeatureHeaderProvider.ts`), which PowerShell and cmd.exe do not interpret the same way. Because feature files are committed to version control and shared across teams, a crafted card title in a pull request is a plausible injection vector on Windows. Card body content must be treated as untrusted input.

The prompt string currently embeds the card's title, labels, a 200-character description snippet, and the absolute file path — all concatenated into a single shell string. The file path is also passed to the agent as a reference ("See full details in: ..."), and the agent will read the full card content from disk. There is no need to embed the raw content in the shell command at all.

### Registration status of FeatureHeaderProvider

`FeatureHeaderProvider.register` is **not called** in `src/extension/index.ts` and the view type `kanban-extension.featureHeader` does not appear in `package.json`. The provider is defined but never registered, so its `startWithAI` handler is currently unreachable. However, it shares the same vulnerable pattern and will be active once registered. Both call sites must be fixed in this story so the provider can be registered safely in a future change without introducing the vulnerability.

### Why `terminal.sendText` is unsafe for untrusted content

`terminal.sendText` sends a string directly to the shell's stdin as keystrokes. The text is interpreted by whichever shell the terminal is running — bash, zsh, PowerShell, cmd.exe, or a user-configured shell. POSIX `'\''` escaping is only meaningful in bash/zsh. On PowerShell a literal `'` starts a here-string; on cmd.exe there is no standard single-quote escape at all. A card title containing `'; rm -rf .` passes through `_shellQuote` as `'''; rm -rf .'` — syntactically broken on POSIX but the semicolon is still present and may execute depending on the shell's error recovery.

### Recommended fix: pass the prompt as a CLI argument without shell interpolation

The VS Code terminal API's `terminal.sendText` is the wrong primitive for this. The correct approach is `vscode.window.createTerminal` followed by a `shellArgs`-based invocation, or a direct `child_process.spawn` / `vscode.window.createTerminal({ shellPath, shellArgs })` call that bypasses shell parsing entirely.

**Approach A —** `createTerminal` **with** `shellPath` **+** `shellArgs` **(preferred):**

```ts
// The terminal spawns the agent binary directly; the OS passes args as an
// argv array, so shell metacharacters in the prompt are never interpreted.
const terminal = vscode.window.createTerminal({
  name: agentNames[selectedAgent] || 'AI Agent',
  shellPath: selectedAgent,          // e.g. 'claude', 'codex'
  shellArgs: args,                   // e.g. ['--permission-mode', 'plan', promptString]
  cwd: workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
})
terminal.show()
// No terminal.sendText call — the process is launched directly.
```

This is the simplest approach and keeps interactive terminal output visible to the user. The terminal's PTY is connected to the agent process, so agent output appears in the terminal as before.

**Approach B — write prompt to a temp file, pass** `--file` **flag**:Some agents support reading the prompt from a file (`claude --file /tmp/prompt.txt`). This eliminates argument-length limits for very large prompts and removes any remaining quoting concern. However, it requires per-agent flag knowledge and temp-file cleanup, and is only preferable if Approach A proves unreliable for a specific agent.

**Approach C — pipe prompt via stdin:**

```ts
// child_process.spawn with stdio: ['pipe', ...], write prompt to proc.stdin
```

This fully avoids shell interpretation but loses the interactive terminal display. Only appropriate if the agent is non-interactive (batch mode).

Approach A is recommended. Verify the agent binary name resolves through `PATH` in the terminal's environment before committing to `shellPath`. If PATH resolution is unreliable (e.g., nvm-managed Node on Windows), fall back to resolving the full path via `which`/`where` before spawning.

### Workspace trust

VS Code exposes `vscode.workspace.isTrusted` (boolean) and `vscode.workspace.onDidGrantWorkspaceTrust` (event). Launching a shell command that reads and executes content from workspace files is a trust-sensitive operation. The launch should be gated behind `vscode.workspace.isTrusted` and must not proceed in restricted mode. There is no existing workspace-trust check anywhere in the codebase — this story introduces the first one.

---

## Story point estimate

**5 points**

Rationale: The core change is surgical — replace `terminal.sendText(shellQuotedString)` with `createTerminal({ shellPath, shellArgs })` at two call sites. The agent-specific argument assembly logic (`args` arrays) is already per-agent and does not need restructuring. However, the scope is wider than a simple find-and-replace: cross-platform verification on three shell environments (bash/zsh, PowerShell, cmd), adding workspace trust gating for the first time in the codebase, writing injection tests using metacharacter-laden titles, and coordinating with `column-aware-ai-prompts-design` (which rewrites the same two call sites) adds meaningful verification and coordination effort. No design decisions are open. 5 points is appropriate.

---

## Dependencies

DependencyDirectionStatusNotes`column-aware-ai-prompts-design`parallel / coordinateIn ProgressBoth stories modify the `_startWithAI` and `startWithAI` call sites in the same two files. **Do not merge concurrently.** Recommended sequence: land `column-aware-ai-prompts-design` first (it restructures prompt assembly); then this story updates the launch mechanism to use `shellPath`/`shellArgs` instead of `terminal.sendText`. If sequenced this way, the wiring tests for `column-aware-ai-prompts-design` must be updated in this story to match the new launch signature.`extract-feature-repository-service-2026-06-02`blocked by thisBacklogThe planned `AgentLauncher` service should wrap the hardened launch mechanism. Land this story first so the service wraps one correct implementation.`replace-regex-yaml-parser-2026-06-02`independentTodoNo shared files. Either order is safe.

---

## Acceptance criteria

- \[ \] The prompt string is passed to the agent binary via `createTerminal({ shellPath, shellArgs })` (or equivalent argv-based spawn). `terminal.sendText` is no longer called with a prompt string at either call site in `KanbanPanel.ts` or `FeatureHeaderProvider.ts`.
- \[ \] A card whose title contains each of the following metacharacters launches the agent with the literal title text and executes nothing extra: `"`, `'`, `` ` ``, `$`, `;`, `&&`, `|`, `\n`. Verified by an automated test that inspects the `shellArgs` value passed to `createTerminal` (not by manually running a shell).
- \[ \] The `_shellQuote` private method is deleted from both `KanbanPanel.ts` and `FeatureHeaderProvider.ts` (it is no longer used once `shellArgs` is adopted).
- \[ \] Launch is blocked when `vscode.workspace.isTrusted` is `false`. In that case, `vscode.window.showWarningMessage` informs the user that "Build with AI" requires a trusted workspace. Verified by a unit test that stubs `isTrusted = false` and asserts no terminal is created.
- \[ \] The terminal `cwd` is derived from the feature file's containing workspace folder (`vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))?.uri.fsPath`), with `workspaceFolders[0]` as fallback when the file is not inside any open folder. This matches the workspace-root derivation already specified in `column-aware-ai-prompts-design`.
- \[ \] Behavior is manually verified on macOS (zsh), Windows (PowerShell 7), and Windows (cmd.exe) with a card whose title contains `"hello 'world'"`.
- \[ \] The fix applies identically to both `KanbanPanel._startWithAI` and `FeatureHeaderProvider`'s `startWithAI` handler, even though `FeatureHeaderProvider` is not currently registered. Both call sites must be updated.
- \[ \] `pnpm test` passes with no failures.
- \[ \] `pnpm typecheck` passes with no TypeScript errors.

---

## Definition of done

- \[ \] All acceptance criteria above are checked.
- \[ \] `terminal.sendText` is not called with any user-derived content in `KanbanPanel.ts` or `FeatureHeaderProvider.ts`.
- \[ \] `_shellQuote` is removed from both files; no equivalent function is introduced.
- \[ \] `vscode.workspace.isTrusted` guard is present before terminal creation at both call sites.
- \[ \] Unit tests exist for: (1) metacharacter injection via title, (2) trust guard blocks launch, (3) trust guard allows launch when `isTrusted = true`.
- \[ \] PR description documents: the vulnerability class (POSIX-only quoting via `terminal.sendText`), the fix (argv-based launch), the platforms tested, and explicitly notes that `FeatureHeaderProvider` is currently unregistered but was updated preventatively.
- \[ \] No open TODOs or FIXMEs remain in touched files.

---

## Affected files

- `src/extension/KanbanPanel.ts` — replace `terminal.sendText(...)` with `createTerminal({ shellPath, shellArgs })`, add trust guard, delete `_shellQuote`
- `src/extension/FeatureHeaderProvider.ts` — same changes as above
- `tests/extension/KanbanPanel.startWithAI.test.ts` — new (or update if created by `column-aware-ai-prompts-design`): injection test, trust guard tests
- `tests/extension/FeatureHeaderProvider.startWithAI.test.ts` — new (or update): same coverage

---

## Implementation notes

### Argument assembly stays per-agent

The existing per-agent `args` array construction (the `switch (selectedAgent)` block) does not need restructuring. The change is only in how the assembled `args` are delivered to the agent — instead of shell-quoting and concatenating into `terminal.sendText`, pass them as `shellArgs`:

```ts
const terminal = vscode.window.createTerminal({
  name: agentNames[selectedAgent] || 'AI Agent',
  shellPath: selectedAgent,   // 'claude', 'codex', 'gh', 'opencode'
  shellArgs: args,            // already-assembled per-agent array, prompt is last element
  cwd: workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
})
terminal.show()
// No sendText call.
```

`shellPath` accepts a command name (resolved via PATH) or an absolute path. If `vscode.env.shell` is needed as a wrapper on Windows (e.g., `cmd /c claude ...`), that complexity should be deferred to a follow-up — do not over-engineer for the first pass.

### Workspace trust guard placement

Insert the trust check at the top of `_startWithAI` and at the top of the `startWithAI` case in `FeatureHeaderProvider`, before any file I/O or terminal creation:

```ts
if (!vscode.workspace.isTrusted) {
  vscode.window.showWarningMessage(
    '"Build with AI" requires a trusted workspace. Open the workspace in trusted mode to use this feature.'
  )
  return
}
```

The warning string should be routed through the `t()` l10n helper with a new key (e.g., `panel.aiRequiresTrust`). Add the key to `package.nls.json`, `package.nls.es.json`, and `package.nls.pt.json`. If the l10n wiring for this feature is deferred, the inline English string is acceptable for the first pass with a TODO comment linking to the i18n backlog.

### Terminal cwd fix (bonus correction)

Both call sites currently hardcode `cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`. This is wrong for multi-root workspaces where the feature file lives in a non-primary folder. Fix this as part of this story — derive `workspaceRoot` from the feature's file path using `vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))?.uri.fsPath`, consistent with the derivation specified in `column-aware-ai-prompts-design`.

### Testing approach

`createTerminal` is a VS Code API call. Stub it with `vi.mock('vscode', ...)` following the pattern in `tests/extension/featureFileUtils.test.ts`. Capture the options object passed to `createTerminal` and assert on `shellPath` and `shellArgs`:

```ts
const createTerminalSpy = vi.fn(() => ({ show: vi.fn(), sendText: vi.fn() }))
vi.mock('vscode', () => ({
  window: { createTerminal: createTerminalSpy, showWarningMessage: vi.fn() },
  workspace: { isTrusted: true, getWorkspaceFolder: vi.fn(() => null), workspaceFolders: [] },
  // ...other stubs
}))

it('passes metacharacter title as literal shellArg', async () => {
  const title = `hello "world" $HOME; rm -rf .`
  // ... set up feature with this title, trigger _startWithAI
  const opts = createTerminalSpy.mock.calls[0][0]
  expect(opts.shellArgs).toContain(expect.stringContaining(title))
  // assert opts.shellArgs does NOT go through shell — no shell quoting present
  expect(opts.shellArgs.join(' ')).not.toContain("'\\''")
})
```

Verify the Vitest config at `vitest.config.mts` — `tests/extension/**` runs in the `node` environment without jsdom, which is correct for this test.

### What this story does NOT do

- It does not extract an `AgentLauncher` service (that is `extract-feature-repository-service-2026-06-02`).
- It does not change the prompt content or introduce column-aware prompts (that is `column-aware-ai-prompts-design`).
- It does not register `FeatureHeaderProvider` — registration is a separate concern tracked elsewhere.
- It does not resolve agent binary PATH on Windows via a discovery mechanism — that is explicitly deferred.