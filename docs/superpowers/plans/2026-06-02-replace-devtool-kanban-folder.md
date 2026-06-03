# Replace `.devtool/features` with `.kanban/features` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the extension's default features directory from `.devtool/features` to `.kanban/features`, update all occurrences across source, config, docs, and tests, and rename this repo's own data folder.

**Architecture:** Pure string replacement across 14 locations in 11 files — no new logic, no migration code. All source files use the same `config.get<string>('featuresDirectory') || '<default>'` pattern; only the default value changes. Test files carry hardcoded path strings that are updated for consistency. The repo's own `.devtool/features/` directory is renamed via `git mv` to preserve history.

**Tech Stack:** TypeScript, VS Code extension API, Vitest

---

### Task 1: Update `package.json`, source files, and `README.md`

**Files:**
- Modify: `package.json:99`
- Modify: `src/extension/KanbanPanel.ts:345`
- Modify: `src/extension/FeatureHeaderProvider.ts:169`
- Modify: `src/extension/SidebarViewProvider.ts:147`
- Modify: `src/extension/index.ts:71`
- Modify: `README.md:165,191`

- [x] **Step 1: Update `package.json` default**

In `package.json` line 99, change:
```json
"default": ".devtool/features",
```
to:
```json
"default": ".kanban/features",
```

- [x] **Step 2: Update `KanbanPanel.ts` fallback**

In `src/extension/KanbanPanel.ts` line 345, change:
```typescript
const featuresDirectory = config.get<string>('featuresDirectory') || '.devtool/features'
```
to:
```typescript
const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban/features'
```

- [x] **Step 3: Update `FeatureHeaderProvider.ts` fallback**

In `src/extension/FeatureHeaderProvider.ts` line 169, change:
```typescript
const featuresDirectory = config.get<string>('featuresDirectory') || '.devtool/features'
```
to:
```typescript
const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban/features'
```

- [x] **Step 4: Update `SidebarViewProvider.ts` fallback**

In `src/extension/SidebarViewProvider.ts` line 147, change:
```typescript
const dir = config.get<string>('featuresDirectory') || '.devtool/features'
```
to:
```typescript
const dir = config.get<string>('featuresDirectory') || '.kanban/features'
```

- [x] **Step 5: Update `index.ts` fallback**

In `src/extension/index.ts` line 71, change:
```typescript
const featuresDirectory = config.get<string>('featuresDirectory') || '.devtool/features'
```
to:
```typescript
const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban/features'
```

- [x] **Step 6: Update `README.md`**

In `README.md` line 165, change:
```markdown
Features live in `.devtool/features/` by default, organized into subfolders by status.
```
to:
```markdown
Features live in `.kanban/features/` by default, organized into subfolders by status.
```

In `README.md` line 191, change:
```markdown
| `featuresDirectory` | `.devtool/features` | Directory for feature files (relative to workspace root) |
```
to:
```markdown
| `featuresDirectory` | `.kanban/features` | Directory for feature files (relative to workspace root) |
```

- [x] **Step 7: Commit source changes**

```bash
git add package.json src/extension/KanbanPanel.ts src/extension/FeatureHeaderProvider.ts src/extension/SidebarViewProvider.ts src/extension/index.ts README.md
git commit -m "feat: change default featuresDirectory from .devtool/features to .kanban/features"
```

---

### Task 2: Update test files

**Files:**
- Modify: `tests/extension/featureFileUtils.test.ts:27`
- Modify: `tests/extension/FeatureHeaderProvider.startWithAI.test.ts:106,174,220,312`
- Modify: `tests/extension/KanbanPanel.startWithAI.test.ts:165,187,222,264,306`
- Modify: `tests/extension/ai/promptBuilder.test.ts:30,115,122`
- Modify: `tests/shared/featureFrontmatter.test.ts:9`
- Modify: `tests/integration/suite/extension.test.ts:139`

- [x] **Step 1: Update `featureFileUtils.test.ts` constant**

In `tests/extension/featureFileUtils.test.ts` line 27, change:
```typescript
const FEATURES_DIR = '/workspace/.devtool/features'
```
to:
```typescript
const FEATURES_DIR = '/workspace/.kanban/features'
```

- [x] **Step 2: Update `FeatureHeaderProvider.startWithAI.test.ts` mock returns**

In `tests/extension/FeatureHeaderProvider.startWithAI.test.ts` line 106, change:
```typescript
const FEATURE_PATH = '/workspace/.devtool/features/my-feat.md'
```
to:
```typescript
const FEATURE_PATH = '/workspace/.kanban/features/my-feat.md'
```

In the same file, change all three occurrences at lines 174, 220, and 312:
```typescript
if (key === 'featuresDirectory') return '.devtool/features'
```
to:
```typescript
if (key === 'featuresDirectory') return '.kanban/features'
```

- [ ] **Step 3: Update `KanbanPanel.startWithAI.test.ts`**

In `tests/extension/KanbanPanel.startWithAI.test.ts`, change all five occurrences of `.devtool/features` to `.kanban/features`.

- [x] **Step 4: Update `promptBuilder.test.ts`**

In `tests/extension/ai/promptBuilder.test.ts`, change three occurrences of `.devtool/features`.

- [x] **Step 5: Update `featureFrontmatter.test.ts` fixture path**

In `tests/shared/featureFrontmatter.test.ts` line 9, change `.devtool/features` to `.kanban/features`.

- [x] **Step 6: Update `extension.test.ts` constant**

In `tests/integration/suite/extension.test.ts` line 139, change:
```typescript
const featuresDir = '/workspace/.devtool/features'
```
to:
```typescript
const featuresDir = '/workspace/.kanban/features'
```

- [x] **Step 7: Run tests to confirm nothing broke**

```bash
cd /Users/me/Documents/GitHub/kanban-vscode-extension && npm test
```

Expected: all tests pass. These changes are path string updates only — no logic changed.

- [x] **Step 8: Commit test changes**

```bash
git add tests/extension/featureFileUtils.test.ts tests/extension/FeatureHeaderProvider.startWithAI.test.ts tests/extension/KanbanPanel.startWithAI.test.ts tests/extension/ai/promptBuilder.test.ts tests/shared/featureFrontmatter.test.ts tests/integration/suite/extension.test.ts
git commit -m "test: update hardcoded .devtool/features paths to .kanban/features"
```

---

### Task 3: Rename this repo's data folder

**Files:**
- Move: `.devtool/features/` → `.kanban/features/`

- [x] **Step 1: Create `.kanban` parent and rename with git mv**

`git mv` requires the destination parent to exist:
```bash
mkdir -p .kanban
git mv .devtool/features .kanban/features
```

`.devtool/plans/` stays in place — do not move it.

- [x] **Step 2: Verify the board still works**

Open this repo in VS Code. The kanban sidebar should load all stories from `.kanban/features/` with no configuration change needed (the new default matches the new location).

- [x] **Step 3: Commit the rename**

```bash
git add -A
git commit -m "chore: rename .devtool/features to .kanban/features in this repo"
```
