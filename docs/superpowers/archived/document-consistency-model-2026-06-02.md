---
id: "document-consistency-model-2026-06-02"
status: "done"
priority: "medium"
created: "2026-06-03T18:00:00.000Z"
modified: "2026-06-04T08:36:00.000Z"
completedAt: "2026-06-04T08:36:00.000Z"
labels: ["documentation", "architecture"]
worktree: ".claude/worktrees/story+document-consistency-model-2026-06-02"
---

# Implementation Plan: Define and document the board's consistency model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create `docs/architecture/consistency-model.md` describing the kanban board's in-memory/on-disk consistency architecture as implemented.

**Architecture:** Pure documentation story — no source changes. All content is derived from `src/extension/FeatureRepository.ts` and the approved spec at `docs/superpowers/specs/2026-06-03-consistency-model-design.md`.

**Tech Stack:** Markdown. Key source file: `src/extension/FeatureRepository.ts`.

---

## File Structure

| Action | Path |
|--------|------|
| Create directory | `docs/architecture/` |
| Create | `docs/architecture/consistency-model.md` |

---

### Task 1: Create docs/architecture/ and write consistency-model.md

**Files:**
- Create: `docs/architecture/consistency-model.md`

This task writes the complete document in one pass. All content is specified below — do not use placeholders or defer any section.

- [x] **Step 1: Create the docs/architecture directory**

```bash
mkdir -p docs/architecture
```

Expected: directory exists, no error.

- [x] **Step 2: Write docs/architecture/consistency-model.md with all five sections**

Create the file at `docs/architecture/consistency-model.md` with exactly this content:

```markdown
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
```

- [x] **Step 3: Verify the file was written**

```bash
wc -l docs/architecture/consistency-model.md
grep -c "^##" docs/architecture/consistency-model.md
```

Expected: file exists with 5 `##`-level headings (Source of Truth, Write Path, Reconcile / Reload Path, Echo Suppression Invariants, Known Race Conditions).

- [x] **Step 4: Commit**

```bash
git add docs/architecture/consistency-model.md
git commit -m "docs: add consistency model architecture document"
```

---

### Task 2: Verify all acceptance criteria

**Files:**
- Read: `docs/architecture/consistency-model.md`

- [x] **Step 1: AC-1 — doc exists with all five sections**

```bash
grep "^## " docs/architecture/consistency-model.md
```

Expected output (order matters for readability but not for AC):
```
## Source of Truth
## Write Path
## Reconcile / Reload Path
## Echo Suppression Invariants
## Known Race Conditions
```

- [x] **Step 2: AC-2 — Echo Suppression Invariants covers all three mechanisms with preconditions, postconditions, and failure modes**

```bash
grep -E "_migrating|_lastWrittenContents|100 ms debounce|Precondition|Postcondition|Failure mode" docs/architecture/consistency-model.md | wc -l
```

Expected: at least 12 lines (4 rows × 3 mechanisms).

- [x] **Step 3: AC-3 — Source of Truth names FeatureRepository and explains centralisation**

```bash
grep -c "FeatureRepository" docs/architecture/consistency-model.md
grep -c "per-provider" docs/architecture/consistency-model.md
```

Expected: both counts ≥ 1.

- [x] **Step 4: AC-4 — Known Race Conditions covers RC-1 and RC-2 each with mitigation, accepted risk, and recommended mitigation**

```bash
grep -E "RC-1|RC-2|Accepted risk|Recommended mitigation|Current mitigation" docs/architecture/consistency-model.md
```

Expected: RC-1, RC-2, and all three subsections present for each.

- [x] **Step 5: AC debounce value — confirm 100 ms, not 300 ms**

```bash
grep -i "100 ms\|100ms" docs/architecture/consistency-model.md
grep -i "300" docs/architecture/consistency-model.md
```

Expected: at least one `100 ms` match; zero `300` matches.

---

## Test Plan

| Acceptance Criterion | Verified by |
|---|---|
| Doc at `docs/architecture/consistency-model.md` with 5 sections | Task 2 Step 1 — grep `^## ` headings |
| Echo Suppression Invariants documents all three mechanisms with preconditions/postconditions/failure modes | Task 2 Step 2 — grep for all six marker strings |
| Source of Truth documents FeatureRepository as single owner, explains centralisation eliminated per-provider fragility | Task 2 Step 3 — grep for `FeatureRepository` and `per-provider` |
| Known Race Conditions covers RC-1 and RC-2 each with mitigation, accepted risk, recommended fix | Task 2 Step 4 — grep for section markers |
| Debounce value is 100 ms, not 300 ms | Task 2 Step 5 — grep confirms |

## Out of Scope

- No source code changes.
- No changes to `KanbanPanel.ts` or `SidebarViewProvider.ts` beyond using them as reference.
- No proposed future mitigations are implemented — RC-1 and RC-2 are documented with current state and recommendations only.

## Dependencies

- `extract-feature-repository-service-2026-06-02` — completed 2026-06-03; established `FeatureRepository` as the single state owner. This story documents the resulting architecture.
