---
id: "document-consistency-model-2026-06-02"
status: "done"
priority: "medium"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-03T23:00:00.000Z"
completedAt: "2026-06-03T23:00:00.000Z"
labels: ["documentation", "architecture"]
order: "a0"
---
# Define and document the board's consistency model

The host keeps features in memory as the source of truth and reconciles external edits through a debounced watcher with several echo-suppression mechanisms. The model works but is undocumented and fragile under concurrent edits.

## Context

`this._features` is authoritative; mutations write single files; a 300ms-debounced watcher plus a `_migrating` flag and `_lastWrittenContent` suppress self-triggered reloads. The load path itself writes files (done ↔ non-done reconciliation, legacy order migration), which can re-trigger the watcher. Concurrent edits — native editor and board, or an agent writing files — inside the debounce window race to last-write-wins. As boards grow this is the most likely source of "card reverted / jumped" reports.

## Acceptance criteria

- [x] A doc exists at `docs/architecture/consistency-model.md` with sections: _Source of Truth_, _Write Path_, _Reconcile / Reload Path_, _Echo Suppression Invariants_, _Known Race Conditions_.
- [x] _Echo Suppression Invariants_ documents `_migrating`, `_lastWrittenContents`, and the **100 ms** debounce with preconditions, postconditions, and failure modes for each.
- [x] _Source of Truth_ documents `FeatureRepository` as the single in-memory owner and explains how centralising the watcher, echo-suppression sentinel, and write API there eliminates the previous per-provider fragility.
- [x] _Known Race Conditions_ covers (a) concurrent native-editor + board edit within the debounce window and (b) concurrent agent file write + board edit within the debounce window — each entry states its current mitigation, accepted-risk note, and recommended fix.

## Context & constraints

- Design spec: `docs/superpowers/specs/2026-06-03-consistency-model-design.md`
- Debounce is **100 ms** (the story's original context section said 300 ms — that is out of date; use the code value)
- No source changes required — pure documentation story
- `extract-feature-repository-service-2026-06-02` is the prerequisite that established `FeatureRepository` as single owner; document the resulting architecture as implemented

## Affected files

- new: `docs/architecture/consistency-model.md` (or an ADR)
- `src/extension/KanbanPanel.ts` (reference)
- `src/extension/SidebarViewProvider.ts` (reference)

## Notes

`extract-feature-repository-service-2026-06-02` completed on 2026-06-03 and established `FeatureRepository` as the single state owner. This story documents the resulting architecture as implemented, not a proposed future state.