# Design: Replace `.devtool/features` with `.kanban/features`

**Date:** 2026-06-02
**Feature:** Change the extension's default features directory from `.devtool/features` to `.kanban/features`, and rename this repo's own data folder to match.

---

## Problem

The extension defaults to storing kanban feature files in `.devtool/features`. The name `.devtool` is generic and gives no hint that it belongs to the kanban extension. `.kanban` is self-describing and consistent with the extension's identity.

---

## Approach

Simple default swap (Approach A). Replace every `.devtool/features` string with `.kanban/features` across the codebase. No migration logic, no fallback, no config key rename.

---

## Changes

### `package.json`
- Line 99: `"default": ".devtool/features"` → `"default": ".kanban/features"`

### Source files (4) — fallback string only
- `src/extension/KanbanPanel.ts:345`
- `src/extension/FeatureHeaderProvider.ts:169`
- `src/extension/SidebarViewProvider.ts:147`
- `src/extension/index.ts:71`

Pattern in all four: `config.get<string>('featuresDirectory') || '.devtool/features'` → `|| '.kanban/features'`

### `README.md`
- Line 191: update `featuresDirectory` default value in the configuration table

### Test files — hardcoded path strings only, no logic changes
- `tests/extension/featureFileUtils.test.ts:27`
- `tests/extension/FeatureHeaderProvider.startWithAI.test.ts:174,220,309`
- `tests/integration/suite/extension.test.ts:139`

### This repo's own data folder
```
git mv .devtool/features .kanban/features
```
Preserves git history. `.devtool/plans/` stays in place (separate concern).

---

## Out of Scope

- **Config key name** — `kanban-markdown.featuresDirectory` stays; it remains accurate
- **`.devtool/plans/`** — not moved; used by the AI dev workflow, not the extension
- **Migration logic** — no auto-migration; users with existing `.devtool/features` data update `featuresDirectory` in settings or move the folder manually
- **`done/` subfolder** — works identically under `.kanban/features/done/`

---

## Testing

- All existing tests pass after the path string updates (no behavioral change)
- Manual smoke test: open this repo in VS Code, verify the board loads from `.kanban/features/`
