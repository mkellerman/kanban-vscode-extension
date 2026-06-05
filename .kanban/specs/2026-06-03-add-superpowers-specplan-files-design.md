# Frontmatter Grooming + Multi-Repository — Design Spec

**Date:** 2026-06-03
**Feature:** Add Superpowers spec/plan files — groom frontmatter and load from multiple directories

---

## Summary

Two complementary changes ship together:

1. **`FeatureRepositoryManager`** — generalizes the single `FeatureRepository` into a manager that owns one repository per configured directory. Each repository handles its own dir and schema. The manager presents a unified API (same shape as `FeatureRepository`) so all consumers (`KanbanPanel`, `SidebarViewProvider`, `FeatureHeaderProvider`) require no interface changes — they simply receive the manager instead of a bare repo.

2. **Grooming hook** — a PostToolUse Claude Code hook (`groom_frontmatter.py`) that fires after every Write/Edit/MultiEdit. When the written file is a `.md` file inside a groomed directory, the hook reads the file, adds any missing frontmatter fields using schema-specific inference rules, and writes the file back only if something changed. This ensures that `docs/superpowers/` files (which have no frontmatter today) become parseable by the board immediately after they are written.

The combination means: write a spec or plan file, the hook adds valid frontmatter, the board loads it as a card.

---

## Architecture

### New: `FeatureRepositoryManager`

A coordinator class in `src/extension/FeatureRepositoryManager.ts` that:

- Holds a `FeatureRepository[]` — one instance per `groomedDirectory` entry
- Presents the same external API as `FeatureRepository` (features list, create, update, move, delete, label ops, etc.)
- **Aggregates reads:** `features` getter returns the union of all repos' features
- **Routes writes** by file-path prefix: when a write arrives (update, move, delete), the manager finds which repo owns the feature (by `feature.filePath`) and delegates to that repo
- **Broadcasts** label-wide ops (`renameLabel`, `deleteLabel`, `migrateFilenames`) to all repos
- Handles `setRoot` / `load` / `dispose` across all repos

`FeatureRepository` itself is **generalized** to accept a `{ dir: string, schema: 'feature' | 'superpowers' }` config instead of reading `featuresDirectory` from VS Code settings directly. The manager passes the right config to each instance.

### Wiring (`index.ts`)

```
groomedDirectories = vscode config("kanban-extension.groomedDirectories")
  // defaults: [{ path: ".kanban/features", schema: "feature" },
  //            { path: "docs/superpowers", schema: "superpowers" }]

manager = new FeatureRepositoryManager(context, groomedDirectories)
// replaces: const repo = new FeatureRepository(context)

// All downstream consumers receive manager instead of repo — type unchanged
// at call sites because manager implements the same surface
```

### New VS Code setting (`package.json`)

```json
"kanban-extension.groomedDirectories": {
  "type": "array",
  "default": [
    { "path": ".kanban/features", "schema": "feature" },
    { "path": "docs/superpowers", "schema": "superpowers" }
  ],
  "items": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "schema": { "type": "string", "enum": ["feature", "superpowers"] }
    },
    "required": ["path", "schema"]
  },
  "description": "%config.groomedDirectories.description%"
}
```

### Grooming hook (`.claude/hooks/groom_frontmatter.py`)

PostToolUse hook (registered in `.claude/settings.json`). Fires on Write|Edit|MultiEdit. Reads `groomedDirectories` from `.vscode/settings.json` (falls back to hardcoded defaults). If the written file is a `.md` in a groomed dir, adds missing frontmatter fields and writes back. Idempotent — no-op if frontmatter is already complete.

---

## Schema Generalization in `FeatureRepository`

`FeatureRepository` currently hard-codes the feature schema (loads `id`, `status`, `priority`, `assignee`, `epic`, etc.) and hard-codes the directory from `kanban-extension.featuresDirectory`.

After the change:
- The constructor accepts `{ dir: string, schema: 'feature' | 'superpowers' }` — no longer reads the dir from VS Code config itself
- `parseFeatureFile` / `createFeature` / serialization paths branch on `schema`:
  - `'feature'` schema: existing behavior unchanged
  - `'superpowers'` schema: maps `id`, `status`, `priority`, `title`, `type`, `slug`, `parent`, `blockedBy`, `relatedTo`, `labels`, `created`, `modified` — unmapped fields (`assignee`, `epic`, `dueDate`, `order`) surface as `null`

The `Feature` TypeScript type is extended with optional superpowers-only fields so the board can render them without type errors. Missing fields are `null` — card UI already handles nulls gracefully.

---

## Schemas & Frontmatter Inference Rules (for the hook)

### Feature schema — directories with `"schema": "feature"`

| Field | Inference rule |
|-------|---------------|
| `id` | filename without `.md` |
| `status` | `"backlog"` |
| `priority` | `"medium"` |
| `assignee` | `null` |
| `epic` | `null` |
| `dueDate` | `null` |
| `created` | current datetime, ISO 8601 with ms |
| `modified` | current datetime |
| `completedAt` | `null` |
| `labels` | `[]` |
| `order` | `"a0"` |

### Superpowers schema — directories with `"schema": "superpowers"`

Matches the roleplaygames-studio schema from `validate_superpowers_frontmatter.py`.

| Field | Inference rule |
|-------|---------------|
| `id` | filename without `.md` |
| `type` | subfolder: `specs/` → `"spec"`, `plans/` → `"plan"`, `guides/` → `"guide"`, root → `"spec"` |
| `title` | first `# Heading` in document body; else filename slug (dashes→spaces, title-cased) |
| `slug` | filename with leading `YYYY-MM-DD-` date prefix stripped, `.md` removed |
| `status` | `"todo"` |
| `priority` | `"medium"` |
| `parent` | `null` |
| `blockedBy` | `[]` |
| `relatedTo` | `[]` |
| `labels` | `[]` |
| `created` | `YYYY-MM-DD` prefix from filename → `YYYY-MM-DDT00:00:00Z`; else now |
| `modified` | current datetime, ISO 8601 UTC |

Fields already present are **never overwritten** by the hook.

---

## Board Display

Superpowers files appear as standard feature cards. Fields absent from the superpowers schema (`assignee`, `epic`, `dueDate`, `order`) surface as `null` — the card UI already renders these as empty/hidden. No card UI changes required.

The `done/` subdir convention applies only to `'feature'` schema repos. Superpowers repos load all `.md` files in the configured directory tree.

---

## File Map

| File | Change |
|------|--------|
| `src/extension/FeatureRepository.ts` | Accept `{ dir, schema }` config; branch on schema for parse/create/serialize |
| `src/extension/FeatureRepositoryManager.ts` | New — aggregator; owns N repos; same external API |
| `src/extension/index.ts` | Instantiate manager from `groomedDirectories`; pass to consumers |
| `src/shared/workspaceContext.ts` | Update any direct `featuresDirectory` reads to use manager |
| `package.json` | Add `kanban-extension.groomedDirectories` setting; keep `featuresDirectory` for back-compat |
| `package.nls.json` | Add `config.groomedDirectories.description` |
| `.claude/hooks/groom_frontmatter.py` | New — PostToolUse frontmatter groomer |
| `.claude/settings.json` | New — hook registration |

---

## Hook Behavior

```
PostToolUse → read file_path from tool_input
  → skip if not .md
  → read .vscode/settings.json for kanban-extension.groomedDirectories
     (fall back to hardcoded defaults if absent)
  → prefix-match file_path against groomed dirs
  → if no match: exit 0 (silent)
  → read file; parse frontmatter
  → apply schema inference for missing fields only
  → if nothing changed: exit 0 (silent)
  → write file back with updated frontmatter
  → exit 0
```

The hook writes via Python's `open()` — not Claude's Write tool — so PostToolUse does not fire recursively.

---

## Error Handling

- File read/write failure (OSError): warn to stderr, exit 0 — never blocks the tool.
- Invalid `.vscode/settings.json`: fall back to defaults.
- `FeatureRepositoryManager` — if one repo fails to load, the others continue; failed repo contributes zero features and logs a warning.

---

## Open Questions

- **`featuresDirectory` back-compat:** Keep the existing `kanban-extension.featuresDirectory` setting for now, read it as the first entry in `groomedDirectories` if `groomedDirectories` is not explicitly set — ensures zero behavior change for existing users who haven't configured `groomedDirectories`.
- **`done/` subdir for superpowers repos:** Superpowers repos do not apply the `done/` move-on-completion convention — done files stay in place (status field is the source of truth). Confirm before implementation.

---

## Testing

- Unit: `FeatureRepository` with `schema: 'superpowers'` parses a superpowers frontmatter file correctly.
- Unit: `FeatureRepositoryManager` aggregates features from two repos and routes writes to the correct one.
- Unit: Hook inference rules (pure functions).
- Integration: Write a superpowers `.md` with no frontmatter → hook adds complete frontmatter → board loads the card.
- Integration: Existing `featuresDirectory`-only setup behaves identically to before.
- Regression: All existing `FeatureRepository` tests continue to pass.
