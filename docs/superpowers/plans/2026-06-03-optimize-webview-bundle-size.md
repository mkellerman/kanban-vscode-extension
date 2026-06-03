---
id: "optimize-webview-bundle-size"
status: "done"
completed: "2026-06-03T07:41:00.000Z"
priority: "medium"
created: "2026-06-03T08:00:00.000Z"
modified: "2026-06-03T08:00:00.000Z"
labels: ["performance", "bundle-size", "build"]
worktree: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktrees/story+optimize-webview-bundle-size-2026-06-03"
---

# Optimize Webview Bundle Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the main webview entry chunk from ~582 KB to ≤200 KB by lazy-loading FeatureEditor, and add a CI-enforced bundle budget to catch future regressions.

**Architecture:** The Tiptap editor stack (imported via `FeatureEditor`) is the dominant cost in the main chunk. Converting its static import to `React.lazy` tells Vite to emit it as a separate on-demand chunk that loads only when a card is first opened. A small Node.js script checks the entry chunk size and is wired into the CI `build` job. No changes to `FeatureEditor.tsx` or the `vite.config.ts` manual chunk configuration.

**Tech Stack:** TypeScript, React 18, Vite, Vitest + @testing-library/react, tsx (script runner), GitHub Actions

---

### Task 1: Add regression test for App editor panel behavior

Write the test that will catch any regression from the lazy-loading change before making the change itself.

**Files:**
- Create: `tests/webview/App.test.tsx`

- [x] **Step 1: Create `tests/webview/App.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import App from '../../../src/webview/App'
import { useStore } from '../../../src/webview/store'
import type { FeatureFrontmatter } from '../../../src/shared/types'

const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))

vi.mock('../../../src/webview/vscodeApi', () => ({
  vscode: { postMessage: mockPostMessage },
}))

vi.mock('../../../src/webview/components/FeatureEditor', () => ({
  FeatureEditor: ({ featureId }: { featureId: string }) => (
    <div data-testid="feature-editor" data-feature-id={featureId} />
  ),
}))

vi.mock('../../../src/webview/components/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board" />,
}))

vi.mock('../../../src/webview/components/KanbanEpicBoard', () => ({
  KanbanEpicBoard: () => <div data-testid="kanban-epic-board" />,
}))

vi.mock('../../../src/webview/components/CreateFeatureDialog', () => ({
  CreateFeatureDialog: () => null,
}))

vi.mock('../../../src/webview/components/Toolbar', () => ({
  Toolbar: () => <div data-testid="toolbar" />,
}))

vi.mock('../../../src/webview/components/UndoToast', () => ({
  UndoToast: () => null,
}))

const initialState = useStore.getState()

beforeEach(() => {
  useStore.setState(initialState, true)
  mockPostMessage.mockClear()
})

const FRONTMATTER: FeatureFrontmatter = {
  id: 'feat-1',
  status: 'backlog',
  priority: 'medium',
  assignee: null,
  epic: null,
  dueDate: null,
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  labels: [],
  order: 'a0',
}

describe('App', () => {
  it('shows FeatureEditor when featureContent message is received', async () => {
    render(<App />)

    expect(screen.queryByTestId('feature-editor')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'featureContent',
            featureId: 'feat-1',
            content: '# Feature 1',
            frontmatter: FRONTMATTER,
          },
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('feature-editor')).toBeInTheDocument()
    })
    expect(screen.getByTestId('feature-editor')).toHaveAttribute('data-feature-id', 'feat-1')
  })

  it('hides FeatureEditor after a second featureContent message is not received', async () => {
    render(<App />)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'featureContent',
            featureId: 'feat-1',
            content: '# Feature 1',
            frontmatter: FRONTMATTER,
          },
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('feature-editor')).toBeInTheDocument()
    })
  })
})
```

- [x] **Step 2: Run test to establish baseline**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm test -- --reporter=verbose tests/webview/App.test.tsx
```

Expected: both tests PASS. If either fails, fix before proceeding — the lazy change must not break existing behavior.

---

### Task 2: Lazy-load FeatureEditor in App.tsx

**Files:**
- Modify: `src/webview/App.tsx:1` (add `lazy`, `Suspense` to react import)
- Modify: `src/webview/App.tsx:7` (remove static FeatureEditor import)
- Modify: `src/webview/App.tsx` after line 13 (add lazy declaration)
- Modify: `src/webview/App.tsx:382-396` (wrap FeatureEditor in `<Suspense>`)

- [x] **Step 1: Update the `react` import in `App.tsx`**

In `src/webview/App.tsx` line 1, change:
```tsx
import { useEffect, useState, useRef, useCallback } from 'react'
```
to:
```tsx
import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react'
```

- [x] **Step 2: Remove the static FeatureEditor import**

In `src/webview/App.tsx` line 7, remove:
```tsx
import { FeatureEditor } from './components/FeatureEditor'
```

- [x] **Step 3: Add the lazy declaration after the remaining imports**

After line 13 (`import { initLocale, t } from './lib/i18n'`), add a blank line then:
```tsx
const FeatureEditor = lazy(() =>
  import('./components/FeatureEditor').then(m => ({ default: m.FeatureEditor }))
)
```

- [x] **Step 4: Wrap the FeatureEditor usage in `<Suspense>`**

In `src/webview/App.tsx` around lines 382–396, change:
```tsx
        {editingFeature && (
          <div className="w-1/2">
            <FeatureEditor
              featureId={editingFeature.id}
              content={editingFeature.content}
              frontmatter={editingFeature.frontmatter}
              contentVersion={editingFeature.contentVersion}
              onSave={handleSaveFeature}
              onClose={handleCloseEditor}
              onDelete={handleDeleteFeature}
              onOpenFile={handleOpenFile}
              onStartWithAI={handleStartWithAI}
            />
          </div>
        )}
```
to:
```tsx
        {editingFeature && (
          <div className="w-1/2">
            <Suspense fallback={null}>
              <FeatureEditor
                featureId={editingFeature.id}
                content={editingFeature.content}
                frontmatter={editingFeature.frontmatter}
                contentVersion={editingFeature.contentVersion}
                onSave={handleSaveFeature}
                onClose={handleCloseEditor}
                onDelete={handleDeleteFeature}
                onOpenFile={handleOpenFile}
                onStartWithAI={handleStartWithAI}
              />
            </Suspense>
          </div>
        )}
```

- [x] **Step 4b: Also lazy-load CreateFeatureDialog (discovered: it also imports full Tiptap stack)**

`CreateFeatureDialog.tsx` imports `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`, and `tiptap-markdown` — the same heavy stack as FeatureEditor. Since it's statically imported in App.tsx, Tiptap remains in the main chunk despite FeatureEditor being lazy. Also convert to lazy import and wrap in Suspense.

Remove the static import and add a lazy declaration alongside FeatureEditor's. Wrap its usage in `<Suspense fallback={null}>`.

- [x] **Step 5: Run type-check and unit tests**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm run typecheck && pnpm test
```

Expected: type-check passes, all tests pass (including the new App.test.tsx). If App.test.tsx fails here, the `vi.mock` for FeatureEditor needs to provide a `default` export as well — add `default` to the mock factory:
```tsx
vi.mock('../../../src/webview/components/FeatureEditor', () => ({
  default: ({ featureId }: { featureId: string }) => (
    <div data-testid="feature-editor" data-feature-id={featureId} />
  ),
  FeatureEditor: ({ featureId }: { featureId: string }) => (
    <div data-testid="feature-editor" data-feature-id={featureId} />
  ),
}))
```

- [x] **Step 6: Build the webview and verify bundle size**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm run build:webview
```

Then check the output:
```bash
ls -lh dist/webview/index.js
```

Expected: `index.js` is ≤200 KB (≈150–180 KB). If it is still >200 KB, run:
```bash
pnpm exec vite-bundle-visualizer
```
to identify remaining large imports and revisit the approach.

- [x] **Step 7: Commit**

---

### Task 3: Bundle budget enforcement script

**Files:**
- Create: `tests/scripts/check-bundle-size.test.ts`
- Create: `scripts/check-bundle-size.ts`
- Modify: `package.json` (add `check-bundle-size` script)

- [x] **Step 1: Write failing tests for the budget check function**

Create `tests/scripts/check-bundle-size.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { statSync } from 'fs'

vi.mock('fs', () => ({
  statSync: vi.fn(),
}))

describe('checkBundleSize', () => {
  let checkBundleSize: (entryChunkPath: string, budgetKb: number) => void
  let mockExit: ReturnType<typeof vi.spyOn>
  let mockLog: ReturnType<typeof vi.spyOn>
  let mockError: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.mocked(statSync).mockReturnValue({ size: 100 * 1024 } as ReturnType<typeof statSync>)
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.resetModules()
    ;({ checkBundleSize } = await import('../../scripts/check-bundle-size'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs success and does not exit when bundle is under budget', () => {
    vi.mocked(statSync).mockReturnValue({ size: 150 * 1024 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith('Bundle size OK: index.js is 150.0 KB (budget: 200 KB)')
  })

  it('logs error and exits 1 when bundle exceeds budget', () => {
    vi.mocked(statSync).mockReturnValue({ size: 250 * 1024 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockError).toHaveBeenCalledWith(
      'Bundle budget exceeded: index.js is 250.0 KB (budget: 200 KB)'
    )
  })

  it('exits 1 exactly at the budget boundary (200 KB is still over)', () => {
    vi.mocked(statSync).mockReturnValue({ size: 200 * 1024 + 1 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('succeeds exactly at 200.0 KB', () => {
    vi.mocked(statSync).mockReturnValue({ size: 200 * 1024 } as ReturnType<typeof statSync>)
    checkBundleSize('/fake/dist/webview/index.js', 200)
    expect(mockExit).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm test -- tests/scripts/check-bundle-size.test.ts
```

Expected: FAIL — `Cannot find module '../../scripts/check-bundle-size'`

- [x] **Step 3: Create `scripts/check-bundle-size.ts`**

```ts
import { statSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const ENTRY_CHUNK = resolve('dist/webview/index.js')
const BUDGET_KB = 200

export function checkBundleSize(
  entryChunkPath: string = ENTRY_CHUNK,
  budgetKb: number = BUDGET_KB
): void {
  const sizeKb = statSync(entryChunkPath).size / 1024
  if (sizeKb > budgetKb) {
    console.error(`Bundle budget exceeded: index.js is ${sizeKb.toFixed(1)} KB (budget: ${budgetKb} KB)`)
    process.exit(1)
  }
  console.log(`Bundle size OK: index.js is ${sizeKb.toFixed(1)} KB (budget: ${budgetKb} KB)`)
}

// Only executes when run directly via `tsx scripts/check-bundle-size.ts`
const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
  checkBundleSize()
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm test -- tests/scripts/check-bundle-size.test.ts
```

Expected: all 4 tests PASS.

- [x] **Step 5: Add the `check-bundle-size` script to `package.json`**

In `package.json`, find the `"scripts"` block. After `"build:webview": "vite build"`, add:
```json
"check-bundle-size": "pnpm run build:webview && tsx scripts/check-bundle-size.ts",
```

- [x] **Step 6: Run the full check end-to-end**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm run check-bundle-size
```

Expected output (last line):
```
Bundle size OK: index.js is <N> KB (budget: 200 KB)
```
where `<N>` is ≤200. Exit code must be 0.

If it exits 1 (budget exceeded), Task 2 did not reduce the bundle enough — revisit the lazy-load change.

- [x] **Step 7: Run full test suite**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && pnpm test
```

Expected: all tests pass.

- [x] **Step 8: Commit**

---

### Task 4: Wire bundle check into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Add the bundle size check step to the `build` job**

In `.github/workflows/ci.yml`, find the `build` job's steps. After the `- name: Build` step (which runs `pnpm run build`), insert the following step. The `build` step already built the webview, so run the check script directly to avoid rebuilding:

```yaml
      - name: Check bundle size
        run: pnpm exec tsx scripts/check-bundle-size.ts
```

The full `build` job steps section should look like:

```yaml
      - name: Build
        run: pnpm run build

      - name: Check bundle size
        run: pnpm exec tsx scripts/check-bundle-size.ts

      - name: Package extension
        run: pnpm run package
```

- [x] **Step 2: Commit**

---

## Test Plan

| Acceptance criterion | Verified by |
|---|---|
| `dist/webview/index.js` ≤200 KB after `pnpm run build:webview` | Task 2 Step 6 (`ls -lh`) |
| FeatureEditor opens and functions identically (no regression) | Task 2 Step 5 (App.test.tsx + full test suite) |
| `pnpm run check-bundle-size` exits 0 under budget, exits 1 over budget | Task 3 Step 4 (unit tests) + Task 3 Step 6 (e2e) |
| CI `build` job fails when budget exceeded | Task 4 Step 1 (CI config change) |
| No unit or integration test regressions | Task 2 Step 5 + Task 3 Step 7 |

## Out of Scope

- CSS size reduction (47 KB Tailwind output is acceptable)
- Replacing Tiptap with a lighter editor
- Optimizing the `react-vendor` or `icons` manual chunks
- Adding bundle size tracking over time (trending / history)

## Dependencies

None — all required code is already present in `main`.
