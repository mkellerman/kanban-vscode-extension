# Terminal + Inline Webview Output — Design Spec

**Date:** 2026-06-03
**Status:** approved

## Summary

When an agent terminal is launched for a kanban card, that card displays a live visual indicator in the webview showing that an agent is actively running. The indicator disappears immediately when the terminal closes. Multiple cards can have active agent terminals simultaneously. No output is captured or persisted — this is a pure live-status feature.

## Visual Design

The active card uses Option C:
- Left-side green accent bar (3px solid, using `--vscode-charts-green` or `--vscode-testing-iconPassed` for theme compatibility)
- Subtle green background tint (same color at ~8% opacity)
- Small pulsing "Agent running" label with an animated dot

When the terminal closes, the card reverts to its normal appearance with no trace.

## Architecture

### Data Flow

```
AgentLauncher.launch(feature)
  → launchAgentTerminal() → vscode.Terminal
  → AgentLauncher registers terminal in Map<Terminal, string[]>
  → fires onAgentStatusChanged({ featureIds, active: true })

KanbanPanel (subscribed to onAgentStatusChanged)
  → postMessage({ type: 'agentStatus', featureIds, active })

Webview
  → maintains Set<string> of activeAgentFeatureIds
  → renders indicator on matching cards

vscode.window.onDidCloseTerminal
  → AgentLauncher looks up terminal in Map, gets featureIds
  → fires onAgentStatusChanged({ featureIds, active: false })
  → removes entry from Map
```

### Webview Ready Replay

When the webview panel opens or refreshes while terminals are already running, `KanbanPanel` sends an `agentStatus` message immediately after the webview `ready` event using `AgentLauncher.activeFeatureIds`. This ensures the indicator is shown even if the panel was closed and reopened mid-run.

### Lane Actions

`launchLane()` launches a single terminal for multiple features. The terminal is registered with all feature IDs in the lane: `Map<Terminal, featureId[]>`. All mapped cards show the indicator simultaneously and all clear simultaneously when that terminal closes.

## Component Changes

### `src/extension/ai/agentLauncher.ts`

- Change `launchAgentTerminal` return type from `void` to `vscode.Terminal`

### `src/extension/AgentLauncher.ts`

- Add `private _activeTerminals = new Map<vscode.Terminal, string[]>()`
- Add `private _onAgentStatusChanged = new vscode.EventEmitter<{ featureIds: string[]; active: boolean }>()`
- Expose `readonly onAgentStatusChanged = this._onAgentStatusChanged.event`
- Expose getter `activeFeatureIds(): string[]` — returns a flat, deduplicated array of all featureIds across active terminals
- `launch()`: after calling `launchAgentTerminal`, register `terminal → [feature.id]` and fire `onAgentStatusChanged({ featureIds: [feature.id], active: true })`
- `launchLane()`: register `terminal → features.map(f => f.id)` and fire the event
- Subscribe to `vscode.window.onDidCloseTerminal` in constructor — look up the closing terminal, fire `onAgentStatusChanged({ featureIds, active: false })`, delete the map entry
- Add `dispose()` to clean up the event emitter and the `onDidCloseTerminal` subscription

### `src/shared/types.ts`

Add to `ExtensionMessage`:

```typescript
| { type: 'agentStatus'; featureIds: string[]; active: boolean }
```

### `src/extension/KanbanPanel.ts`

- Subscribe to `launcher.onAgentStatusChanged` in constructor; forward the event via `this._panel.webview.postMessage`
- On webview `ready`: if `launcher.activeFeatureIds.length > 0`, send an `agentStatus` message with `active: true` and the current active set

### Webview (React)

- Add `activeAgentFeatureIds: Set<string>` to board state (initially empty)
- Handle incoming `agentStatus` messages:
  - `active: true` → add all `featureIds` to the set
  - `active: false` → remove all `featureIds` from the set
- In the card component: if `activeAgentFeatureIds.has(feature.id)`, apply the Option-C indicator styles

## Testing

### Unit Tests (new file: `tests/extension/AgentLauncher.agentStatus.test.ts`)

- `launch()` registers the terminal and fires `onAgentStatusChanged` with `active: true`
- `launchLane()` registers one terminal mapped to all lane feature IDs
- Closing the terminal fires `onAgentStatusChanged` with `active: false` and removes the entry
- `activeFeatureIds` returns the union of all active terminal maps
- Closing an untracked terminal is a no-op

### Integration Tests (`tests/integration/suite/extension.test.ts`)

- After `startWithAI`, the webview receives `agentStatus { active: true }` for the correct feature ID
- After the terminal closes, the webview receives `agentStatus { active: false }`
- On webview `ready` with an already-running terminal, the webview receives the current active set

## Constraints

- In-memory only — no persistence to disk, no frontmatter changes
- Terminal output is not captured or relayed; the terminal remains the authoritative live view
- The feature relies on `vscode.window.onDidCloseTerminal` — if a terminal is renamed or reused by VS Code internals, the map lookup will return `undefined` (safe no-op)
