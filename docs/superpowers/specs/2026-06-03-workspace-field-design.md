# Workspace field — track branch/worktree context per story

## Problem

When "Build with AI" is clicked, the AI agent always launches in the main workspace root. Stories in progress often have an isolated git worktree (stored in `.kanban/features/*.md` under the `worktree` frontmatter key), but the extension never reads that field — so the agent starts in the wrong directory. Additionally, there is no in-extension record of which branch a story was started on, making the kanban board blind to where the code actually lives.

## Goal

One frontmatter field — `workspace` — that always tells you where the code for a story is:

| Value | Meaning | Build with AI launches in |
|---|---|---|
| `"main"` (branch name) | Work is on this branch, main workspace | workspace root |
| `"/path/to/worktrees/story+foo"` (absolute path) | Isolated git worktree | worktree path |

## Section 1 — Data model

### `Feature` and `FeatureFrontmatter`

Add `workspace: string | null` to both the `Feature` interface and the `FeatureFrontmatter` interface in `src/shared/types.ts`.

`FeatureFrontmatter` is the type used in the editor save roundtrip (`saveFeatureContent` → `serializeFeature`). Including `workspace` there ensures the field is preserved across editor saves.

### Parsing (`src/shared/featureFrontmatter.ts` — `parseFeatureFile`)

- Read the `workspace` key from YAML frontmatter.
- **Migration**: if `workspace` is absent but the legacy `worktree` key is present, use its value as `workspace`. Existing active feature files work without a bulk rename.
- Falls back to `null` if neither key is present.

### Serialization (`serializeFeature`)

- Write `workspace` to frontmatter when non-null.
- Omit the field when null (keeps frontmatter clean for stories that haven't been branched yet).

## Section 2 — Population and helper

### `FeatureRepository.createFeature`

When a new story is created, read the current git branch and store it as `workspace`. Use the VS Code Git extension API (no subprocess), finding the repo that contains the features directory:

```ts
const featuresDir = this.getFeaturesDir()
const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports
const repo = gitExt?.getAPI(1).repositories.find(r =>
  featuresDir?.startsWith(r.rootUri.fsPath)
)
const branch = repo?.state.HEAD?.name ?? null
// feature.workspace = branch ?? null
```

Falls back to `null` if the Git API is unavailable or no matching repo is found.

### `parseWorkspaceValue` (new file `src/shared/workspaceContext.ts`)

```ts
type WorkspaceContext =
  | { type: 'none' }
  | { type: 'branch'; label: string }
  | { type: 'worktree'; path: string; label: string }

function parseWorkspaceValue(workspace: string | null): WorkspaceContext
```

- `null` → `{ type: 'none' }`
- `path.isAbsolute(workspace)` → `{ type: 'worktree', path: workspace, label: path.basename(workspace) }`
- otherwise → `{ type: 'branch', label: workspace }`

This is the single decision point for what a `workspace` value means. Both the UI and `AgentLauncher` import from here. Using `path.isAbsolute()` handles both Unix and Windows paths correctly.

## Section 3 — UI indicator

Both surfaces gate on `feature.workspace !== null`.

**`FeatureCard.tsx`**: add a `⎇ <label>` badge in the existing badge row (alongside priority/epic badges). Label comes from `parseWorkspaceValue(feature.workspace).label`. Styled subtly — muted color, same size as the epic badge.

**`FeatureEditor.tsx`**: show `⎇ <label>` near the "Build with AI" dropdown so the user knows which directory the agent will open in. Same label via `parseWorkspaceValue`.

Both badges are read-only display — `workspace` is not editable in the UI. The webview receives `workspace` via the `featureContent` message, holds it in local state, and echoes it back unchanged in `saveFeatureContent` so the extension's save handler can pass it through to `serializeFeature`.

## Section 4 — AgentLauncher

In `AgentLauncher.launch()` (`src/extension/AgentLauncher.ts`), replace the flat `workspaceRoot` CWD selection with:

```
ctx = parseWorkspaceValue(feature.workspace)

if ctx.type === 'worktree':
  if fs.existsSync(ctx.path):
    cwd = ctx.path                    ← launch in isolated worktree
  else:
    show warning: "Worktree path not found — launching in workspace root"
    cwd = effectiveRoot               ← fallback
else:
  cwd = effectiveRoot                 ← branch or none: existing behavior
```

The `fs.existsSync` check confirms the directory exists on disk before using it, even if `Feature.workspace` has a path in memory.

## Section 5 — Migration

The `worktree` → `workspace` rename is handled entirely by the parser. Files with `worktree` in frontmatter work immediately. The next time `serializeFeature` runs on a story (status change, editor save), the output uses `workspace` and drops `worktree`. No bulk rename needed.

`.kanban/instructions.md` lists `worktree` in `frontmatter_fields` — update that reference to `workspace` so AI-driven workflows stay in sync.

## Error handling

| Situation | Behavior |
|---|---|
| Worktree path set but directory missing | Warning notification + fall back to workspace root |
| Git API unavailable at feature creation | `workspace: null`; no indicator shown; agent launches in workspace root |
| Frontmatter has neither `workspace` nor `worktree` | `workspace: null`; same as above |

## Testing

- **`featureFrontmatter.test.ts`**: parse `workspace` key; legacy `worktree` key maps to `workspace`; serialize writes `workspace` when non-null, omits when null; `null` when both absent.
- **`workspaceContext.test.ts`** (new): `parseWorkspaceValue` covers `null`, branch string, absolute Unix path, absolute Windows path.
- **`AgentLauncher.test.ts`**: worktree path exists → CWD is the path; worktree path missing → warning shown + CWD is workspace root; branch string → CWD is workspace root; `null` → CWD is workspace root.
- **`FeatureRepository.test.ts`**: `createFeature` finds matching repo by features-dir prefix and sets `workspace`; falls back to `null` when no match or Git API unavailable.
- **`FeatureCard.test.tsx`** / **`FeatureEditor.test.tsx`**: badge visible when `workspace` non-null; hidden when `null`.

## Files changed

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `workspace: string \| null` to `Feature` and `FeatureFrontmatter` |
| `src/shared/workspaceContext.ts` | New file: `WorkspaceContext` type + `parseWorkspaceValue` helper |
| `src/shared/featureFrontmatter.ts` | Parse `workspace` + legacy `worktree`; serialize `workspace` |
| `src/extension/FeatureRepository.ts` | Populate `workspace` from Git API (features-dir repo match) in `createFeature` |
| `src/extension/AgentLauncher.ts` | Use `parseWorkspaceValue` to select CWD; `fs.existsSync` guard |
| `src/webview/components/FeatureCard.tsx` | Add `⎇ <label>` badge |
| `src/webview/components/FeatureEditor.tsx` | Add `⎇ <label>` indicator near Build with AI |
| `.kanban/instructions.md` | Update `worktree` → `workspace` in `frontmatter_fields` |
| `tests/…` | New and updated tests per the testing section |
