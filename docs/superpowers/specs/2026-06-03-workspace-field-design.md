---
title: Workspace field — track branch/worktree context per story
date: 2026-06-03
status: draft
---

# Workspace field: track branch/worktree context per story

## Problem

When "Build with AI" is clicked, the AI agent always launches in the main workspace root. Stories in progress often have an isolated git worktree (stored in `.kanban/features/*.md` under the `worktree` frontmatter key), but the extension never reads that field — so the agent starts in the wrong directory. Additionally, there is no in-extension record of which branch a story was started on, making the kanban board blind to where the code actually lives.

## Goal

One frontmatter field — `workspace` — that always tells you where the code for a story is:

| Value | Meaning | Build with AI launches in |
|---|---|---|
| `"main"` (branch name) | Work is on this branch, main workspace | workspace root |
| `"/path/to/worktrees/story+foo"` (absolute path) | Isolated git worktree | worktree path |

## Design

### 1. Data model — `Feature.workspace`

Add `workspace: string | null` to the `Feature` interface in `src/shared/types.ts`.

**Parsing** (`src/shared/featureFrontmatter.ts` — `parseFeatureFile`):
- Read the `workspace` key from YAML frontmatter.
- **Migration**: if `workspace` is absent but the legacy `worktree` key is present, use its value as `workspace`. This allows existing active feature files to work without a bulk rename.
- Falls back to `null` if neither key is present.

**Serialization** (`serializeFeature`):
- Write `workspace` to frontmatter when non-null.
- Do not write the field when null (keeps the frontmatter clean for new stories that haven't been branched yet — though in practice `createFeature` will always populate it).

### 2. Populate on creation — `FeatureRepository.createFeature`

When a new story is created, read the current git branch and store it as `workspace`. Use the VS Code Git extension API (no subprocess):

```ts
const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports
const repo = gitExt?.getAPI(1).repositories[0]
const branch = repo?.state.HEAD?.name ?? null
```

The resulting feature gets `workspace: branch ?? null`. If the Git API is unavailable (e.g., no repo open), `workspace` is `null`.

### 3. Worktree detection helper

Add a pure helper `parseWorkspaceValue(workspace: string | null)` in `src/shared/workspaceContext.ts` (new file, keeps `types.ts` as pure type declarations):

```ts
type WorkspaceContext =
  | { type: 'none' }
  | { type: 'branch'; label: string }
  | { type: 'worktree'; path: string; label: string }

function parseWorkspaceValue(workspace: string | null): WorkspaceContext
```

- `null` → `{ type: 'none' }`
- starts with `/` → `{ type: 'worktree', path: workspace, label: path.basename(workspace) }`
- otherwise → `{ type: 'branch', label: workspace }`

This is the single place that decides what a `workspace` value means; both the UI and `AgentLauncher` use it.

### 4. UI indicator

Both surfaces gate on `feature.workspace !== null`.

**Feature card** (`src/webview/components/FeatureCard.tsx`):
- Add a small `⎇ <label>` badge in the existing badge row (alongside priority/epic badges).
- Uses `parseWorkspaceValue` to get the label.
- Styled subtly (muted color, same size as the epic badge).

**Feature editor** (`src/webview/components/FeatureEditor.tsx`):
- Show `⎇ <label>` near the Build with AI dropdown so the user knows which directory the agent will open in.
- Same label derivation via `parseWorkspaceValue`.

### 5. AgentLauncher — worktree-aware CWD

In `AgentLauncher.launch()` (`src/extension/AgentLauncher.ts`):

```
ctx = parseWorkspaceValue(feature.workspace)

if ctx.type === 'worktree':
  if fs.existsSync(ctx.path):
    cwd = ctx.path          ← launch in isolated worktree
  else:
    show warning notification: "Worktree path not found — launching in workspace root"
    cwd = effectiveRoot     ← fall back
else:
  cwd = effectiveRoot       ← branch or none: use workspace root as before
```

The `fs.existsSync` call is the on-demand reverification: even if the in-memory `Feature.workspace` has a path, the launcher confirms it still exists on disk before using it.

### 6. Migration of existing feature files

The legacy `worktree` key is accepted by the parser (Option A above) — no bulk rename required. Files are migrated lazily: the next time `serializeFeature` runs on a story (e.g., on status change or save), it writes `workspace` and omits `worktree`. Active stories with a worktree path continue to work immediately without manual intervention.

## Error handling

| Situation | Behavior |
|---|---|
| Worktree path set but directory missing | Warning notification + fall back to workspace root |
| Git API unavailable at feature creation | `workspace: null`; no indicator shown; launches in workspace root |
| Frontmatter has neither `workspace` nor `worktree` | `workspace: null`; same as above |

## Testing

- **`featureFrontmatter.test.ts`**: parse `workspace` key; legacy `worktree` key maps to `workspace`; serialize writes `workspace` only when non-null; `null` when both absent.
- **`workspaceContext.test.ts`** (new): `parseWorkspaceValue` covers `null`, branch string, absolute path.
- **`AgentLauncher.test.ts`**: worktree path exists → CWD is the path; worktree path missing → warning shown + CWD is workspace root; branch string → CWD is workspace root; `null` → CWD is workspace root.
- **`FeatureRepository.test.ts`**: `createFeature` reads Git API branch and sets `workspace`; falls back to `null` when Git API unavailable.
- **`FeatureCard.test.tsx`** / **`FeatureEditor.test.tsx`**: badge visible when `workspace` set; hidden when `null`.

## Files changed

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `workspace: string \| null` to `Feature` |
| `src/shared/workspaceContext.ts` | New file: `WorkspaceContext` type + `parseWorkspaceValue` helper |
| `src/shared/featureFrontmatter.ts` | Parse `workspace` + legacy `worktree`; serialize `workspace` |
| `src/extension/FeatureRepository.ts` | Populate `workspace` from Git API in `createFeature` |
| `src/extension/AgentLauncher.ts` | Use `parseWorkspaceValue` to select CWD; `fs.existsSync` guard |
| `src/webview/components/FeatureCard.tsx` | Add `⎇ <label>` badge |
| `src/webview/components/FeatureEditor.tsx` | Add `⎇ <label>` indicator near Build with AI |
| `tests/…` | New and updated tests per the testing section |
