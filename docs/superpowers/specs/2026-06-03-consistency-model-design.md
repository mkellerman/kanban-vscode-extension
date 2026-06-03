# Consistency Model Design

**Story:** `document-consistency-model-2026-06-02`
**Date:** 2026-06-03
**Status:** approved

## Overview

This spec defines the content and structure for `docs/architecture/consistency-model.md` — a reference document describing how the kanban board keeps its in-memory state and on-disk files consistent. The document describes the architecture **as implemented**, not a proposed future state.

---

## Output Document

**Path:** `docs/architecture/consistency-model.md`

**Sections:**

1. Source of Truth
2. Write Path
3. Reconcile / Reload Path
4. Echo Suppression Invariants
5. Known Race Conditions

---

## Section 1: Source of Truth

`FeatureRepository._features: Feature[]` is the single authoritative in-memory state. All consumers (`KanbanPanel`, `SidebarViewProvider`) receive updates only through `onDidChange` — an event fired after every mutation. Neither consumer holds its own copy of the feature list; they re-render from the event payload. Disk files are the persistent projection of this in-memory state, not a co-equal source.

Centralising ownership in `FeatureRepository` eliminated the previous per-provider fragility: before the `extract-feature-repository-service` refactor, both `KanbanPanel` and `SidebarViewProvider` maintained their own file watchers and echo-suppression sentinels independently, making them susceptible to out-of-order updates.

---

## Section 2: Write Path

Every board mutation (create, update, move, delete, archive, label rename/delete, filename migration) follows this sequence:

1. Mutate `_features` in place (in-memory state updated first, no optimistic-then-rollback)
2. Serialize the affected feature(s) with `serializeFeature()`
3. Register the serialized content in `_lastWrittenContents` (echo sentinel)
4. Call `_fs.writeFile()` — if this throws, show an error toast and call `load()` to re-sync from disk
5. For done-boundary crossings (status going to or from `'done'`): set `_migrating = true`, call `moveFeatureFile()` to rename the file into/out of `done/`, then clear `_migrating` in a `finally` block
6. Fire `_emitter.fire(this._features)` — pushes the updated list to all subscribers

`deleteFeature` removes the sentinel entry (step 3) rather than writing one, and skips step 5.

---

## Section 3: Reconcile / Reload Path

`load()` is the only way disk state is read back into memory. It is called:

- On extension activation / panel `ready` message
- When `featuresDir` changes (config change or `setRoot`)
- By the file watcher after debounce + echo check
- As an error-recovery fallback when a write fails

`load()` uses a `_loadVersion` monotonic counter: each call captures its own version number at the start. Only the call whose version still equals `_loadVersion` at completion commits its result — earlier in-flight loads silently discard their output.

The load sequence runs three migration phases before reading state:

1. **Old-subfolder migration** — moves files from legacy `backlog/`, `todo/`, `in-progress/`, `review/` subfolders to the flat root
2. **Done-folder reconciliation** — files with `status: done` at the root are moved into `done/`; files in `done/` whose frontmatter status is not `done` are moved back to the root
3. **Integer-order migration** — replaces numeric `order` values with fractional-indexing keys, writing updated files to disk

All three phases set `_migrating = true` to suppress watcher re-entry during the file moves and writes they perform.

---

## Section 4: Echo Suppression Invariants

Three mechanisms cooperate to prevent the board's own writes from triggering a reload.

### `_migrating: boolean`

- **Precondition:** Set to `true` before any load-path file operation (all three migration phases in `load()`, plus done-folder moves in `updateFeature`, `moveFeature`, `moveAllFeatures`, `archiveFeatures`, and `migrateFilenames`)
- **Postcondition:** Cleared in a `finally` block after the file operations complete
- **Effect:** `_handleFileChange` returns immediately without scheduling a reload
- **Failure mode:** The flag is a plain boolean, not a reference-counted lock. Nested or concurrent `_migrating = true` blocks do not stack — the inner `finally` clears the flag while the outer block is still running. In practice this does not occur because async operations are awaited sequentially, but it is a latent hazard if the call graph changes.

### `_lastWrittenContents: Map<string, string>`

- **Precondition:** Populated with the exact serialized content immediately before every `writeFile` call in a mutation
- **Postcondition:** Entry deleted after first comparison (match or mismatch); also deleted by `deleteFeature`
- **Effect:** When the watcher fires for a path in the map, `_handleFileChange` reads the file back and compares. If disk content equals the stored string, the event is an echo and reload is suppressed. If content differs, a concurrent external edit is assumed and `load()` runs.
- **Failure mode:** If two rapid watcher events arrive for a slow write, the first comparison reads pre-write content (mismatch → spurious reload); by the time the second fires, the entry is already deleted (also triggers reload). Both loads contend through `_loadVersion`.

### 100 ms debounce

- **Precondition:** `_handleFileChange` is called by any watcher event (create, change, delete)
- **Postcondition:** The timer is reset on every event; the callback fires 100 ms after the last event in a burst
- **Effect:** Collapses rapid sequences of watcher events (e.g., a save that produces multiple filesystem notifications) into a single reload attempt
- **Failure mode:** A slow disk write landing after the debounce window fires appears as a second external-edit event, causing a second load attempt (resolved by `_loadVersion`).

---

## Section 5: Known Race Conditions

### RC-1: Concurrent native-editor + board edit within the debounce window

**Scenario:** The user saves a feature file in VS Code's native text editor at the same time the board writes the same file (e.g., a drag-and-drop updating `order`).

**Current mitigation:** `_lastWrittenContents` catches the board's own echo. If the native-editor save arrives within 100 ms of the board's write, both events collapse into one debounced callback. The callback reads disk, finds content that differs from `_lastWrittenContents` (the native editor's version), and calls `load()`. The board's in-memory state is replaced by the native editor's version — the board's write is lost.

**Accepted risk:** Yes. Last-write-wins. No user-visible conflict resolution.

**Recommended mitigation:** Before overwriting `_features` in `load()`, diff the incoming list against the current in-memory state. If the only changes are to fields that `load()` itself does not touch (e.g., `order`, `status`), prefer the in-memory values. Alternatively, surface a conflict notification when a reload stomps an in-flight edit.

---

### RC-2: Concurrent agent file write + board edit within the debounce window

**Scenario:** An AI agent writes a feature file (e.g., updating frontmatter) within 100 ms of the board writing the same file.

**Current mitigation:** Same as RC-1. The agent's write will not match `_lastWrittenContents`; the debounce collapses the two events; `load()` reloads from disk. The outcome depends on which write landed last.

**Accepted risk:** Yes. Last-write-wins. Agents that write feature files during an active board session are implicitly racing with the board.

**Recommended mitigation:** Introduce a cooperative lock file (e.g., `.kanban/.lock`) that the board holds while a mutation is in flight, and document the protocol for agents to honour it. As a simpler short-term measure, widen `_lastWrittenContents` to store a timestamp alongside content and skip the reload if the watcher event arrives within a grace window of the write.

---

## Implementation Notes

- The output doc lives at `docs/architecture/consistency-model.md` (create the `docs/architecture/` directory if it does not exist)
- The debounce is **100 ms** — the story's context section mentions 300 ms, which is out of date
- No source code changes are required; this is a pure documentation story
