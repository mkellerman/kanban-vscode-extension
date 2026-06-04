---
id: "2026-06-03-workspace-field-design"
status: "completed"
priority: "medium"
assignee: null
epic: "Developer experience"
dueDate: null
created: "2026-06-03T00:00:00.000Z"
modified: "2026-06-04T05:32:00.000Z"
completedAt: "2026-06-04T05:32:00.000Z"
labels: ["git", "worktree", "agent-launcher"]
order: "a1"
---
# Workspace field: track branch/worktree context per story

As a developer using the kanban board, I want each story to remember which branch or worktree it lives on, so that "Build with AI" always launches the agent in the right directory and the board shows me where my code is at a glance.

## Context

"Build with AI" currently launches the agent in the workspace root, ignoring any `worktree` frontmatter key. The board is also blind to which branch a story was started on. A single `workspace` frontmatter field — set at story creation from the current branch, updated to an absolute path when a worktree is created — gives both the launcher and the UI the context they need.

## Acceptance criteria

- [x] A new `workspace: string | null` field exists on the `Feature` interface and the `FeatureFrontmatter` interface.
- [x] `parseFeatureFile` reads the `workspace` key; if absent but `worktree` is present, uses `worktree` as `workspace`; falls back to `null` when both are absent.
- [x] `serializeFeature` writes `workspace` when non-null and omits it when null.
- [x] `createFeature` sets `workspace` to the current branch name read from the VS Code Git API (using the repo whose root contains the features directory); falls back to `null` when the Git API is unavailable or no matching repo is found.
- [x] `parseWorkspaceValue(workspace)` returns `{ type: none }` for null, `{ type: branch, label }` for a non-absolute string, and `{ type: worktree, path, label }` for an absolute path (using `path.isAbsolute()`).
- [x] The FeatureCard shows a `⎇ <label>` badge when `workspace !== null`; no badge when `null`.
- [x] The FeatureEditor shows a `⎇ <label>` indicator near the "Build with AI" dropdown when `workspace !== null`; hidden when `null`.
- [x] The editor save roundtrip preserves `workspace`: the webview echoes it back unchanged in `saveFeatureContent`.
- [x] `AgentLauncher.launch()` uses the worktree path as CWD when `workspace` is an absolute path and the directory exists on disk.
- [x] When the worktree path is set but the directory is missing, the launcher shows a warning notification and falls back to the workspace root.
- [x] When `workspace` is a branch name or `null`, the launcher uses the workspace root as CWD (existing behavior).
- [x] `.kanban/instructions.md` references `workspace` (not `worktree`) in `frontmatter_fields`.

## Context & constraints

- Design spec: `docs/superpowers/specs/2026-06-03-workspace-field-design.md`
- `parseWorkspaceValue` lives in new file `src/shared/workspaceContext.ts` — single decision point for both UI and launcher
- `path.isAbsolute()` used to distinguish worktree paths from branch names (handles Unix and Windows)
- Lazy migration: existing files with `worktree` frontmatter work immediately; `workspace` replaces `worktree` on the next `serializeFeature` call
- `workspace` is read-only in the UI — set programmatically at creation and by worktree-creating workflows
- No `showWorkspace` settings toggle — badge appears whenever `workspace !== null`

## Open questions

_(none — design approved)_
