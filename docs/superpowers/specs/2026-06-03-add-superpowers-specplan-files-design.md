# Frontmatter Grooming Hook — Design Spec

**Date:** 2026-06-03
**Feature:** Add Superpowers spec/plan files — auto-groom frontmatter on write

---

## Summary

A PostToolUse Claude Code hook (`groom_frontmatter.py`) fires after every Write/Edit/MultiEdit operation. When the written file is a `.md` file inside a configured "groomed directory," the hook reads the file, adds any missing frontmatter fields using schema-specific inference rules, and writes the file back only if something changed. If frontmatter is already complete the hook is a no-op (idempotent).

The set of groomed directories is configured via a new VS Code extension setting `kanban-extension.groomedDirectories`, defaulting to both `.kanban/features` (feature schema) and `docs/superpowers` (superpowers schema). When the setting is absent, the hook falls back to those same defaults.

---

## Architecture

Three artifacts ship together:

| Artifact | Purpose |
|----------|---------|
| `.claude/hooks/groom_frontmatter.py` | The hook script |
| `.claude/settings.json` | Registers the hook on `PostToolUse` |
| `package.json` | Declares `kanban-extension.groomedDirectories` setting |

### Hook registration (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/groom_frontmatter.py"
          }
        ]
      }
    ]
  }
}
```

### VS Code setting (`package.json`)

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
      "path": {
        "type": "string",
        "description": "Relative path from workspace root"
      },
      "schema": {
        "type": "string",
        "enum": ["feature", "superpowers"],
        "description": "Frontmatter schema to apply"
      }
    },
    "required": ["path", "schema"]
  },
  "description": "%config.groomedDirectories.description%"
}
```

---

## Hook Behavior

```
PostToolUse → read file_path from tool_input
  → skip if not .md
  → read .vscode/settings.json for kanban-extension.groomedDirectories
     (fall back to hardcoded defaults if setting absent)
  → check if file_path is under any groomed dir (prefix match on normalized path)
  → if no match: exit 0 (silent)
  → read file content
  → parse frontmatter (detect absence or partial presence)
  → apply schema inference rules for missing fields only
  → if nothing changed: exit 0 (silent, idempotent)
  → if fields added: write file back with updated frontmatter
  → exit 0
```

### Loop Safety

When the hook writes back a file, the PostToolUse hook fires again. On the second invocation every field is present, so the hook finds nothing to add and exits 0 silently. No infinite recursion.

---

## Schemas & Inference Rules

### Feature schema — `.kanban/features/` and all subdirs

Applied to any `.md` file under a directory configured with `"schema": "feature"`.

| Field | Inference rule |
|-------|---------------|
| `id` | filename without `.md` extension |
| `status` | `"backlog"` |
| `priority` | `"medium"` |
| `assignee` | `null` |
| `epic` | `null` |
| `dueDate` | `null` |
| `created` | current datetime, ISO 8601 with ms (`YYYY-MM-DDTHH:MM:SS.sssZ`) |
| `modified` | current datetime, same format |
| `completedAt` | `null` |
| `labels` | `[]` |
| `order` | `"a0"` |

Fields already present in the file are **never overwritten**.

### Superpowers schema — `docs/superpowers/` and all subdirs

Applied to any `.md` file under a directory configured with `"schema": "superpowers"`. Matches the roleplaygames-studio schema from `validate_superpowers_frontmatter.py`.

| Field | Inference rule |
|-------|---------------|
| `id` | filename without `.md` extension |
| `type` | subfolder: `specs/` → `"spec"`, `plans/` → `"plan"`, `guides/` → `"guide"`, root → `"spec"` |
| `title` | first `# Heading` in document body; else filename slug (dashes→spaces, title-cased) |
| `slug` | filename slug with leading `YYYY-MM-DD-` date prefix stripped |
| `status` | `"todo"` |
| `priority` | `"medium"` |
| `parent` | `null` |
| `blockedBy` | `[]` |
| `relatedTo` | `[]` |
| `labels` | `[]` |
| `created` | date prefix from filename (`YYYY-MM-DD`) → `YYYY-MM-DDT00:00:00Z`; else current datetime |
| `modified` | current datetime, ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`) |

Fields already present in the file are **never overwritten**.

---

## Frontmatter Parsing

The hook uses the same two-pass strategy as the roleplaygames-studio validator:

1. Try `import yaml; yaml.safe_load(...)` for robust parsing.
2. Fall back to a minimal line-by-line regex parser if PyYAML is unavailable.

When writing frontmatter back, the hook serializes only YAML primitives (strings, nulls, lists of strings, ISO 8601 dates) — no nested objects.

---

## File Map

| File | Change |
|------|--------|
| `.claude/hooks/groom_frontmatter.py` | New — the hook script |
| `.claude/settings.json` | New — PostToolUse hook registration |
| `package.json` | Add `kanban-extension.groomedDirectories` setting |
| `package.nls.json` | Add `config.groomedDirectories.description` localization key |

---

## Error Handling

- File read failure (OSError): print warning to stderr, exit 0 (don't block the tool).
- Frontmatter write failure: print warning to stderr, exit 0.
- Invalid JSON in `.vscode/settings.json`: fall back to hardcoded defaults, continue.
- Hook never exits with a non-zero code for groomed files — it is advisory, not blocking.

---

## Testing

- Unit-test the inference rules in isolation (pure functions).
- Integration test: write a file with no frontmatter → assert hook adds all required fields.
- Integration test: write a file with complete frontmatter → assert hook is a no-op (file unchanged).
- Integration test: write a file in a non-groomed dir → assert hook skips it.
- Verify loop safety: two consecutive invocations on the same file produce identical output.
