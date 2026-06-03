---
id: "document-consistency-model-2026-06-02"
status: "backlog"
priority: "medium"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-02T18:00:00.000Z"
completedAt: null
labels: ["documentation", "architecture"]
order: "a4"
---

# Define and document the board's consistency model

The host keeps features in memory as the source of truth and reconciles external edits through a debounced watcher with several echo-suppression mechanisms. The model works but is undocumented and fragile under concurrent edits.

## Context

`this._features` is authoritative; mutations write single files; a 300ms-debounced watcher plus a `_migrating` flag and `_lastWrittenContent` suppress self-triggered reloads. The load path itself writes files (done ↔ non-done reconciliation, legacy order migration), which can re-trigger the watcher. Concurrent edits — native editor and board, or an agent writing files — inside the debounce window race to last-write-wins. As boards grow this is the most likely source of "card reverted / jumped" reports.

## Acceptance criteria

- [ ] A short design doc describes the source of truth, the write path, the reconcile path, and the known last-write-wins behaviour.
- [ ] The echo-suppression mechanisms (`_migrating`, `_lastWrittenContent`, debounce) are documented in one place with their invariants.
- [ ] A decision is recorded on whether to move to a single state owner (e.g. the FeatureRepository) shared across providers and windows.
- [ ] Known race conditions are listed with their current mitigation or accepted risk.

## Affected files

- new: `docs/architecture/consistency-model.md` (or an ADR)
- `src/extension/KanbanPanel.ts` (reference)
- `src/extension/SidebarViewProvider.ts` (reference)

## Notes

Pairs naturally with the FeatureRepository card, which would give the model a single owner.
