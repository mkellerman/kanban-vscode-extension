# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm install          # install dependencies
pnpm dev              # watch mode — extension (esbuild) + webview (Vite) in parallel
pnpm build            # production build
pnpm lint             # ESLint
pnpm typecheck        # TypeScript type checking (no emit)
pnpm test             # Vitest unit tests (run once)
pnpm test:watch       # Vitest in watch mode
pnpm test:coverage    # Vitest with v8 coverage report
pnpm test:integration # build + run VS Code integration tests (requires display)
pnpm package          # produce .vsix in releases/
```

Run a single test file:
```sh
pnpm vitest run tests/extension/FeatureRepository.test.ts
```

## Architecture

The extension is split into three source trees that are bundled separately:

```
src/
├── extension/   Node.js — bundled by esbuild → dist/extension.js
├── shared/      Imported by both extension and webview; not bundled standalone
└── webview/     React (Vite) — bundled → dist/webview/
tests/
├── extension/   Vitest, node environment
├── shared/      Vitest, node environment
├── webview/     Vitest, jsdom environment
└── integration/ @vscode/test-electron + mocha — runs inside a real VS Code instance
```

### Data layer — `src/extension/`

**`FeatureRepository`** is the core: it reads `.md` files from a configured directory, parses YAML frontmatter via `parseFeatureFile` (in `src/shared/featureFrontmatter.ts`), and emits an `onDidChange` event whenever files change. A `FileSystemWatcher` tracks the directory. All file I/O goes through an injectable `FsAdapter` interface (`featureFileUtils.ts`) so unit tests can stub the filesystem.

**`FeatureRepositoryManager`** wraps multiple `FeatureRepository` instances — one for the primary features directory and one per entry in `groomedDirectories` config — and implements the same `IFeatureRepository` interface. The primary repo (`schema: 'feature'`) is the one used for creating new features.

**`KanbanPanel`** is the main webview panel. It owns the bidirectional message bridge between the extension and the React webview. All user actions (create, update, move, delete, drag) arrive as webview→extension messages and are dispatched to the repository.

**`SidebarViewProvider`** renders the board as a sidebar `WebviewView` (activity bar icon), reusing the same webview HTML as `KanbanPanel`.

**`FeatureHeaderProvider`** shows a small "frontmatter header" webview above VS Code's native markdown editor, letting users edit status/priority/assignee without opening the full board.

**`AgentLauncher`** opens a VS Code terminal running the selected AI agent (`claude`, `codex`, `copilot`, or `opencode`) with a built prompt. It tracks active terminals to drive the "agent active" badge on cards.

### AI prompts — `src/extension/ai/`

`promptBuilder.ts` resolves the prompt for a given column using a three-priority chain:
1. `.kanban/instructions/{column-id}.md` in the workspace (committed, team-wide)
2. `prompt` field on the column in `kanban-extension.columns` settings (per-user)
3. Bundled default in `prompts/{column-id}.md` (extension-provided)

Template variables `{{title}}`, `{{priority}}`, `{{status}}`, `{{columnName}}`, `{{labels}}`, `{{description}}`, `{{filePath}}` are substituted before the prompt is passed to the agent CLI.

### Webview — `src/webview/`

State is managed by a single **Zustand store** (`src/webview/store/index.ts`). The store holds features, columns, filters, layout, and display settings. Components call store actions; the store never calls VS Code APIs directly.

The webview communicates with the extension by calling `vscode.postMessage` (extension → webview) and listening for `window.addEventListener('message', ...)` (webview → extension), mediated by `src/webview/vscodeApi.ts`.

### Feature file format

Each feature is a `.md` file with YAML frontmatter:

```md
---
id: "my-feature-2026-06-04"
status: "in-progress"
priority: "high"
assignee: null
epic: null
dueDate: null
created: "2026-06-04T..."
modified: "2026-06-04T..."
completedAt: null
labels: []
order: "a0"
---
# Feature title

Body content here.
```

`done` features are moved to a `done/` subfolder. `order` uses fractional indexing (`fractional-indexing` package) for drag-and-drop ordering without renumbering.

Unknown frontmatter fields are round-tripped as `_extraFrontmatter` so custom schemas (e.g. `superpowers`) don't lose data.

### Localization

Strings are externalized in `package.nls.json` (English) and `package.nls.{locale}.json` (ES, PT). `src/extension/l10n.ts` wraps `@vscode/l10n`. The webview receives its locale bundle from the extension via an initialization message.

## Verification policy

Every manual/smoke test verification step in a plan requires `/visual-walkthrough` evidence attached to the plan before the step is marked done.

## Key constraints

- **`FsAdapter`** — never call `vscode.workspace.fs` directly inside `FeatureRepository` or `featureFileUtils`; always use the injected adapter so unit tests can stub I/O without a VS Code host.
- **Prompt injection guard** — `promptBuilder.ts` validates column IDs against `SAFE_ID = /^[a-zA-Z0-9_\-.]+$/` and verifies symlink-resolved paths stay within the workspace before reading local template files.
- **`done` subfolder** — features with `status: 'done'` are stored in `{featuresDir}/done/`. `getStatusFromPath` and `moveFeatureFile` in `featureFileUtils.ts` own this mapping.
- **No `vscode` imports in `shared/`** — the shared tree is loaded in both Node.js (extension) and browser (webview) contexts.
