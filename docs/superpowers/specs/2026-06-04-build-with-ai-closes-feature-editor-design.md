# Design: Close FeatureEditor When Build with AI Is Clicked

**Date:** 2026-06-04  
**Story:** `when-user-clicks-build-with-ai-the-side-panel-shou-2026-06-04`

## Problem

When the user clicks "Build with AI" (or uses Ctrl+B) in the `FeatureEditor` panel, the editor remains open while the AI terminal launches. This splits the user's attention between the editor and the new terminal window, and leaves unsaved edits at risk if the debounce timer has not yet fired.

## Solution

Mirror the existing Escape-key pattern: flush any pending debounce, save the current editor content, launch the AI agent, then close the FeatureEditor panel.

## Scope

- **In scope:** `FeatureEditor.tsx` — keyboard shortcut handler and `AIDropdown` click handler
- **Out of scope:** `KanbanPanel.ts`, `AgentLauncher.ts`, `SidebarViewProvider.ts`, `App.tsx` (no changes needed)

## Implementation

Two touch points in `FeatureEditor.tsx`:

### 1. Keyboard shortcut (Ctrl+B)

Current:
```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'b' && cardSettings.showBuildWithAI) {
  e.preventDefault()
  onStartWithAI('claude', 'default')
}
```

New:
```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'b' && cardSettings.showBuildWithAI) {
  e.preventDefault()
  if (debounceRef.current) clearTimeout(debounceRef.current)
  save()
  onStartWithAI('claude', 'default')
  onClose()
}
```

### 2. AIDropdown `onSelect` handler (line 716)

Wrap the `onStartWithAI` call passed to `AIDropdown` with a local handler that flushes, saves, launches, and closes:

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

## Data Flow

No change to the extension-side message protocol. `startWithAI` is still posted by `App.tsx`'s `handleStartWithAI` (which is passed as `onStartWithAI`). `closeFeature` is still posted by `App.tsx`'s `handleCloseEditor` (which is passed as `onClose`). The order is: save → agent launch message → close message.

## Save Semantics

`save()` calls `onSave(markdown, currentFrontmatter)`, which posts `updateFeature` to the extension synchronously. No awaiting is required — message ordering in the webview message channel guarantees `updateFeature` arrives before any agent reads the file via the repository watcher.

## Testing

**Unit:**
- Render `FeatureEditor` with mocked `save`, `onStartWithAI`, `onClose` props
- Simulate Ctrl+B: assert `save` called, then `onStartWithAI`, then `onClose`
- Simulate AIDropdown `onSelect`: assert same call order

**Manual (golden path):**
- Open a card, edit the title, click Build with AI via AIDropdown
- Assert: editor closes, terminal opens, file on disk contains the edit

**Edge cases:**
- Editor with no changes: `save()` is a no-op; editor still closes
- Pending debounce present: debounce is cleared before save so no double-write
