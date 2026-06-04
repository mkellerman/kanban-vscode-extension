#!/usr/bin/env python3
"""
PostToolUse hook: adds missing frontmatter to .md files in groomed directories.

Reads kanban-extension.groomedDirectories from .vscode/settings.json.
Falls back to hardcoded defaults (.kanban/features, docs/superpowers).

Exit 0 always — this hook is advisory and never blocks the tool.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULTS = [
    {"path": ".kanban/features", "schema": "feature"},
    {"path": "docs/superpowers", "schema": "superpowers"},
]

FEATURE_FIELDS = [
    "id", "status", "priority", "assignee", "epic", "dueDate",
    "created", "modified", "completedAt", "labels", "order",
]

SUPERPOWERS_FIELDS = [
    "id", "type", "title", "slug", "status", "priority",
    "parent", "blockedBy", "relatedTo", "labels", "created", "modified",
]

DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")


def load_groomed_dirs():
    settings = Path(".vscode/settings.json")
    if settings.exists():
        try:
            with open(settings, encoding="utf-8") as f:
                data = json.load(f)
            dirs = data.get("kanban-extension.groomedDirectories")
            if dirs:
                return dirs
        except Exception:
            pass
    return DEFAULTS


def schema_for_file(file_path: Path, groomed_dirs: list) -> tuple:
    """Return (schema, dir_path) for the first matching groomed dir, or (None, None)."""
    cwd = Path.cwd()
    try:
        resolved = file_path.resolve()
    except Exception:
        return None, None
    for entry in groomed_dirs:
        dir_abs = (cwd / entry["path"]).resolve()
        try:
            resolved.relative_to(dir_abs)
            return entry["schema"], dir_abs
        except ValueError:
            continue
    return None, None


def parse_frontmatter(content: str):
    """Return (dict, body_str) or (None, None) if no frontmatter."""
    if not content.startswith("---\n"):
        return None, None
    end = content.find("\n---\n", 4)
    if end == -1:
        return None, None
    yaml_text = content[4:end]
    body = content[end + 5:]  # skip \n---\n
    try:
        import yaml
        data = yaml.safe_load(yaml_text)
        if not isinstance(data, dict):
            return None, None
        return data, body
    except ImportError:
        return _parse_simple(yaml_text), body
    except Exception:
        return None, None


def _parse_simple(yaml_text: str) -> dict:
    data = {}
    lines = yaml_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.startswith("#"):
            i += 1
            continue
        m = re.match(r"^(\w+):\s*(.*)", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val == "null":
                data[key] = None
            elif val.startswith('"') and val.endswith('"'):
                data[key] = val[1:-1]
            elif val == "[]":
                data[key] = []
            elif val.startswith("["):
                inner = val.lstrip("[").rstrip("]")
                data[key] = [x.strip().strip('"') for x in inner.split(",") if x.strip()]
            elif val == "":
                items = []
                i += 1
                while i < len(lines) and lines[i].startswith("  - "):
                    items.append(lines[i][4:].strip().strip('"'))
                    i += 1
                data[key] = items
                continue
            else:
                data[key] = val
        i += 1
    return data


def serialize_frontmatter(fm: dict) -> str:
    lines = []
    for key, val in fm.items():
        if val is None:
            lines.append(f"{key}: null")
        elif isinstance(val, list):
            if not val:
                lines.append(f"{key}: []")
            else:
                items = ", ".join(f'"{v}"' for v in val)
                lines.append(f"{key}: [{items}]")
        else:
            lines.append(f'{key}: "{val}"')
    return "\n".join(lines)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def infer_type_from_path(file_path: Path, dir_abs: Path) -> str:
    try:
        rel = file_path.resolve().relative_to(dir_abs)
        parts = rel.parts
        if len(parts) > 1:
            sub = parts[0]
            if sub == "specs":
                return "spec"
            if sub == "plans":
                return "plan"
            if sub == "guides":
                return "guide"
    except ValueError:
        pass
    return "spec"


def extract_title(body: str):
    m = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    return m.group(1).strip() if m else None


def slug_from_filename(stem: str) -> str:
    return DATE_PREFIX_RE.sub("", stem)


def created_from_filename(stem: str) -> str:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})-", stem)
    if m:
        return f"{m.group(1)}T00:00:00Z"
    return now_iso()


def infer_feature_fields(fm: dict, file_path: Path) -> dict:
    stem = file_path.stem
    defaults = {
        "id": stem,
        "status": "backlog",
        "priority": "medium",
        "assignee": None,
        "epic": None,
        "dueDate": None,
        "created": now_iso(),
        "modified": now_iso(),
        "completedAt": None,
        "labels": [],
        "order": "a0",
    }
    added = {}
    for field in FEATURE_FIELDS:
        if field not in fm:
            added[field] = defaults[field]
    return added


def infer_superpowers_fields(fm: dict, file_path: Path, dir_abs: Path, body: str) -> dict:
    stem = file_path.stem
    defaults = {
        "id": stem,
        "type": infer_type_from_path(file_path, dir_abs),
        "title": extract_title(body) or stem.replace("-", " ").title(),
        "slug": slug_from_filename(stem),
        "status": "todo",
        "priority": "medium",
        "parent": None,
        "blockedBy": [],
        "relatedTo": [],
        "labels": [],
        "created": created_from_filename(stem),
        "modified": now_iso(),
    }
    added = {}
    for field in SUPERPOWERS_FIELDS:
        if field not in fm:
            added[field] = defaults[field]
    return added


def build_updated_content(fm: dict, added: dict, body: str, had_frontmatter: bool) -> str:
    merged = {**fm, **added}
    # preserve original field order, then appended fields
    ordered = {k: merged[k] for k in list(fm.keys()) + [k for k in added if k not in fm]}
    return f"---\n{serialize_frontmatter(ordered)}\n---\n{body}"


def main():
    try:
        event = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_input = event.get("tool_input", {})
    file_path_str = tool_input.get("file_path", "")
    if not file_path_str or not file_path_str.endswith(".md"):
        sys.exit(0)

    file_path = Path(file_path_str)

    groomed_dirs = load_groomed_dirs()
    schema, dir_abs = schema_for_file(file_path, groomed_dirs)
    if schema is None:
        sys.exit(0)

    try:
        with open(file_path, encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        print(f"WARNING: groom_frontmatter: could not read {file_path}: {e}", file=sys.stderr)
        sys.exit(0)

    fm, body = parse_frontmatter(content)
    had_frontmatter = fm is not None
    if fm is None:
        fm = {}
        body = content

    if schema == "feature":
        added = infer_feature_fields(fm, file_path)
    else:
        added = infer_superpowers_fields(fm, file_path, dir_abs, body or "")

    if not added:
        sys.exit(0)  # nothing to do — idempotent

    new_content = build_updated_content(fm, added, body or "", had_frontmatter)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except OSError as e:
        print(f"WARNING: groom_frontmatter: could not write {file_path}: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
