---
id: "when-user-clicks-build-with-ai-the-side-panel-shou-2026-06-04"
status: "review"
priority: "medium"
created: "2026-06-04T23:50:00.000Z"
modified: "2026-06-04T23:50:00.000Z"
labels: []
---

# Implementation Plan: When User Clicks Build with AI, the Side Panel Should Close

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the FeatureEditor panel immediately after the user launches an AI agent, mirroring the existing Escape-key pattern of flushing pending debounced saves before closing.

**Architecture:** Two touch points in `FeatureEditor.tsx` only — the Ctrl+B keyboard shortcut handler and the `AIDropdown.onSelect` inline handler. No extension-side changes needed; the existing message ordering (`updateFeature` before `closeFeature`) ensures the file is saved before the agent reads it.

**Tech Stack:** React, Vitest, @testing-library/react

---

## Files

| Action | Path | What changes |
|--------|------|--------------|
| Modify | `src/webview/components/FeatureEditor.tsx:628-631` | Ctrl+B handler: add debounce flush, save, and onClose after onStartWithAI |
| Modify | `src/webview/components/FeatureEditor.tsx:716` | AIDropdown onSelect: wrap direct pass-through with inline handler that flushes, saves, launches, closes |
| Modify | `tests/webview/components/FeatureEditor.test.tsx` | New describe block with two new tests |

---

### Task 1: Write failing tests

**Files:**
- Modify: `tests/webview/components/FeatureEditor.test.tsx`

- [x] **Step 1: Add `fireEvent` to the testing-library import**

In `tests/webview/components/FeatureEditor.test.tsx`, change line 3:
```ts
import { render, screen } from '@testing-library/react'
```
to:
```ts
import { render, screen, fireEvent } from '@testing-library/react'
```

- [x] **Step 2: Add `AIAgent` and `AIPermissionMode` to the types import**

Change the existing types import (line 6):
```ts
import type { CardDisplaySettings, FeatureFrontmatter } from '../../../src/shared/types'
```
to:
```ts
import type { CardDisplaySettings, FeatureFrontmatter, AIAgent, AIPermissionMode } from '../../../src/shared/types'
```

- [x] **Step 3: Append the new describe block at the bottom of the file**

```tsx
describe('FeatureEditor — Build with AI closes editor', () => {
  function renderEditor(
    onClose: () => void,
    onStartWithAI: (agent: AIAgent, permissionMode: AIPermissionMode) => void
  ) {
    setSettings({ showBuildWithAI: true })
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter()}
        onSave={noOp}
        onClose={onClose}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={onStartWithAI}
      />
    )
  }

  it('Ctrl+B calls onStartWithAI then onClose', () => {
    const onStartWithAI = vi.fn()
    const onClose = vi.fn()
    renderEditor(onClose, onStartWithAI)
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(onStartWithAI).toHaveBeenCalledWith('claude', 'default')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onStartWithAI.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0])
  })

  it('AIDropdown selection calls onStartWithAI then onClose', () => {
    const onStartWithAI = vi.fn()
    const onClose = vi.fn()
    renderEditor(onClose, onStartWithAI)
    // Open the dropdown — t() returns the key string when no bundle is loaded
    fireEvent.click(screen.getByText('editor.buildWithAI'))
    // Click the claude/default mode option
    fireEvent.click(screen.getByText('ai.mode.default'))
    expect(onStartWithAI).toHaveBeenCalledWith('claude', 'default')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onStartWithAI.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0])
  })
})
```

- [x] **Step 4: Run tests to confirm they fail**

```bash
pnpm vitest run tests/webview/components/FeatureEditor.test.tsx
```

Expected: the two new tests fail — `onClose` is not called after either interaction.

---

### Task 2: Fix the Ctrl+B keyboard handler

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx` around line 628

- [x] **Step 1: Update the Ctrl+B branch**

Find this block (lines 628–631):
```ts
      if ((e.metaKey || e.ctrlKey) && e.key === 'b' && cardSettings.showBuildWithAI) {
        e.preventDefault()
        onStartWithAI('claude', 'default')
      }
```

Replace with:
```ts
      if ((e.metaKey || e.ctrlKey) && e.key === 'b' && cardSettings.showBuildWithAI) {
        e.preventDefault()
        if (debounceRef.current) clearTimeout(debounceRef.current)
        save()
        onStartWithAI('claude', 'default')
        onClose()
      }
```

- [x] **Step 2: Run the tests — Ctrl+B test should now pass**

```bash
pnpm vitest run tests/webview/components/FeatureEditor.test.tsx
```

Expected: "Ctrl+B calls onStartWithAI then onClose" passes; "AIDropdown selection" still fails.

---

### Task 3: Fix the AIDropdown onSelect handler

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx` around line 716

- [x] **Step 1: Wrap the pass-through onSelect with a flush-save-launch-close handler**

Find this line (around line 716):
```tsx
          {cardSettings.showBuildWithAI && <AIDropdown onSelect={onStartWithAI} />}
```

Replace with:
```tsx
          {cardSettings.showBuildWithAI && (
            <AIDropdown
              onSelect={(agent, mode) => {
                if (debounceRef.current) clearTimeout(debounceRef.current)
                save()
                onStartWithAI(agent, mode)
                onClose()
              }}
            />
          )}
```

- [x] **Step 2: Run all FeatureEditor tests**

```bash
pnpm vitest run tests/webview/components/FeatureEditor.test.tsx
```

Expected: all tests pass, including both new "Build with AI closes editor" tests.

---

### Task 4: Full verification and commit

- [x] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass with no regressions.

- [x] **Step 2: Run type check**

```bash
pnpm typecheck
```

Expected: no type errors.

- [x] **Step 3: Commit**

```bash
git add src/webview/components/FeatureEditor.tsx tests/webview/components/FeatureEditor.test.tsx
git commit -m "feat: close FeatureEditor after Build with AI is triggered"
```

---

## Test Plan

| Acceptance criterion | Task | Test |
|---|---|---|
| Ctrl+B closes editor after launching AI | Task 2 | "Ctrl+B calls onStartWithAI then onClose" |
| AIDropdown selection closes editor after launching AI | Task 3 | "AIDropdown selection calls onStartWithAI then onClose" |
| Pending edits are flushed to disk before close | Both handlers | `save()` is called before `onStartWithAI`/`onClose`; call order enforced by code structure |
| No double-write from pending debounce | Both handlers | `clearTimeout(debounceRef.current)` before `save()` cancels any pending delayed write |

## Out of Scope

- No changes to `KanbanPanel.ts`, `AgentLauncher.ts`, `SidebarViewProvider.ts`, or `App.tsx`
- No changes to the extension-side message protocol
- The Escape-key close path is unchanged
- No manual smoke test required beyond the unit tests (behavior is deterministic and fully covered)

## Dependencies

None — self-contained webview change with no cross-file protocol changes.
