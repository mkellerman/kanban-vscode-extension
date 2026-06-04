# Consistency Model

This document describes how the kanban board keeps its in-memory state and on-disk feature files consistent. It describes the architecture **as implemented**, not a proposed future state. The primary source is `src/extension/FeatureRepository.ts`.

---

## Source of Truth

`FeatureRepository._features: Feature[]` is the single authoritative in-memory state for the board. All consumers — `KanbanPanel` and `SidebarViewProvider` — receive feature-list updates exclusively through `onDidChange`, a `vscode.Event<readonly Feature[]>` fired after every mutation. Neither consumer holds its own copy of the feature list; both re-render from the event payload.

Disk files (`.kanban/features/**/*.md`) are the **persistent projection** of this in-memory state, not a co-equal source. A disk file is always written *after* the in-memory mutation completes; during the window between the two, the in-memory state is authoritative.

`FeatureRepository` is also the sole owner of the file-system watcher, the echo-suppression sentinels, and every write API. This centralised ownership was established by the `extract-feature-repository-service` refactor. Before that refactor, `KanbanPanel` and `SidebarViewProvider` each maintained their own file watchers and echo-suppression state independently, making them susceptible to out-of-order updates when both received the same filesystem event at different times.

---

## Write Path

Every board mutation — create, update, move, delete, archive, label rename/delete, filename migration — follows this sequence:

1. **Mutate `_features` in place.** The in-memory state is updated first. There is no optimistic-then-rollback pattern; the write is assumed to succeed.
2. **Serialize.** The affected feature(s) are serialized to YAML-frontmatter Markdown with `serializeFeature()`.
3. **Register the echo sentinel.** The serialized content string is stored in `_lastWrittenContents` keyed by file path, before the write is issued. This sentinel allows the watcher to recognise the subsequent filesystem event as an echo of this write.
4. **Write to disk.** `_fs.writeFile()` is called. If it throws, a toast error is shown and `load()` is called to re-sync from disk; the mutation is not rolled back from memory in this path.
5. **Done-boundary moves (conditional).** When `status` crosses the `done` boundary (going to or from `'done'`), `_migrating` is set to `true`, `moveFeatureFile()` renames the file into `done/` or back to the root, and `_migrating` is cleared in a `finally` block.
6. **Notify subscribers.** `_emitter.fire(this._features)` pushes the updated list to all `onDidChange` listeners.

`deleteFeature` removes the sentinel entry (step 3) rather than writing one, so a subsequent watcher event for the deleted path falls through to a full reload.

---

## Reconcile / Reload Path

`load()` is the only mechanism by which disk state is read back into memory. It is called:

- On extension activation and on the panel `ready` message.
- When `featuresDir` changes (user config change or a `setRoot()` call).
- By the debounced file-watcher callback after an external edit is detected.
- As an error-recovery fallback when any write call fails.

### Version guard

`load()` increments `_loadVersion` and captures its own version number at the start of the call (`myVersion`). Only the call whose version still equals `_loadVersion` at completion commits its result — all earlier in-flight loads silently discard their output. This ensures that rapid back-to-back `load()` invocations (e.g., a burst of watcher events) converge on the last call's result.

### Migration phases

`load()` runs three migration phases before reading final state. All three set `_migrating = true` to suppress watcher re-entry during the file moves and writes they perform.

**Phase 1 — Old-subfolder migration:** Moves files from legacy `backlog/`, `todo/`, `in-progress/`, and `review/` subfolders to the flat root, then removes the now-empty subfolders.

**Phase 2 — Done-folder read:** Reads feature files from the flat root and the `done/` subdirectory into the candidate list.

**Phase 3 — Done ↔ non-done reconciliation:** For each loaded feature, compares the file's location against its `status` frontmatter field. Files with `status: done` at the root are moved into `done/`; files in `done/` whose frontmatter `status` is not `done` are moved back to the root.

**Phase 4 — Integer-order migration (conditional):** If any feature still carries a legacy integer `order` value, all features are re-keyed with fractional-indexing keys using `generateNKeysBetween`, and the updated files are written to disk.

---

## Echo Suppression Invariants

Three mechanisms cooperate to prevent the board's own writes from triggering a spurious reload.

### `_migrating: boolean`

| | |
|---|---|
| **Precondition** | Set to `true` before any file operation performed by the load path: all migration phases in `load()`, plus done-folder moves in `updateFeature`, `moveFeature`, `moveAllFeatures`, `archiveFeatures`, and `migrateFilenames`. |
| **Postcondition** | Cleared in a `finally` block after the file operations complete, regardless of success or failure. |
| **Effect** | `_handleFileChange` returns immediately without scheduling a reload when `_migrating` is `true`. |
| **Failure mode** | The flag is a plain `boolean`, not a reference-counted lock. Nested or concurrent `_migrating = true` blocks do not stack — the inner `finally` clears the flag while the outer block is still running. In practice this does not occur because all async operations are awaited sequentially, but it is a latent hazard if the call graph changes to introduce concurrent awaits. |

### `_lastWrittenContents: Map<string, string>`

| | |
|---|---|
| **Precondition** | Populated with the exact serialized content string immediately before every `writeFile` call in a mutation. |
| **Postcondition** | Entry deleted after the first comparison in the watcher callback (whether the comparison matched or not); also deleted unconditionally by `deleteFeature`. |
| **Effect** | When the watcher fires for a path present in the map, `_handleFileChange` reads the file back and compares disk content against the stored string. If they are equal, the event is an echo and reload is suppressed. If they differ, a concurrent external edit is assumed and `load()` runs. |
| **Failure mode** | If two rapid watcher events arrive for a file whose write is slow (disk not yet flushed), the first comparison reads pre-write content (mismatch → spurious reload); by the time the second event fires, the entry has already been deleted (second reload also triggers). Both loads contend through `_loadVersion`, so only the last one commits. |

### 100 ms debounce

| | |
|---|---|
| **Precondition** | `_handleFileChange` is invoked by any watcher event (create, change, or delete) on a path matching `**/*.md` under `featuresDir`. |
| **Postcondition** | The timer is reset on every event; the callback fires 100 ms after the last event in a burst. |
| **Effect** | Collapses rapid sequences of watcher events — for example, an atomic save that generates multiple filesystem notifications — into a single reload attempt. |
| **Failure mode** | A slow disk write that lands after the debounce window fires appears as a second external-edit event, triggering a second `load()` call. Both calls are resolved by `_loadVersion`; only the second commit sticks. |

---

## Known Race Conditions

### RC-1: Concurrent native-editor + board edit within the debounce window

**Scenario:** The user saves a feature file in VS Code's native text editor at the same time the board writes the same file (e.g., a drag-and-drop updating `order`).

**Current mitigation:** `_lastWrittenContents` catches the board's own echo. If the native-editor save arrives within 100 ms of the board's write, both events collapse into a single debounced callback. The callback reads disk, finds content that differs from `_lastWrittenContents` (the native editor's version now on disk), and calls `load()`. The board's in-memory state is replaced by the native editor's version — the board's write is lost.

**Accepted risk:** Yes. Last-write-wins. No user-visible conflict resolution exists.

**Recommended mitigation:** Before overwriting `_features` in `load()`, diff the incoming list against the current in-memory state. If the only changes are to fields that `load()` itself does not touch (e.g., `order`, `status`), prefer the in-memory values. Alternatively, surface a conflict notification when a reload stomps an in-flight edit.

---

### RC-2: Concurrent agent file write + board edit within the debounce window

**Scenario:** An AI agent writes a feature file (e.g., updating frontmatter fields) within 100 ms of the board writing the same file.

**Current mitigation:** Same as RC-1. The agent's write will not match `_lastWrittenContents`; the debounce collapses the two events; `load()` reloads from disk. The outcome depends on which write landed last on disk.

**Accepted risk:** Yes. Last-write-wins. Agents that write feature files during an active board session are implicitly racing with the board.

**Recommended mitigation:** Introduce a cooperative lock file (e.g., `.kanban/.lock`) that the board holds while a mutation is in flight, and document the protocol for agents to honour it. As a shorter-term measure, widen `_lastWrittenContents` to store a timestamp alongside content and skip the reload if the watcher event arrives within a configurable grace window after the write.
