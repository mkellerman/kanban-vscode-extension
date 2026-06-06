# Reference: planning-framework formats → Backlog MCP adapters

**Date:** 2026-06-06
**Status:** reference (informs the Backlog MCP adapter slices)
**Scope:** on-disk format + folder structure for **BMAD-METHOD**, **Superpowers/native**, **GitHub Spec Kit**, and the original **kanban-markdown** extension — distilled for writing `FrameworkAdapter`s that normalize each into `WorkItem` (see `2026-06-06-backlog-mcp-design.md` §4/§5; contract in `packages/backlog-mcp/src/contract.ts`).

## Comparison matrix

| | **BMAD-METHOD** | **Superpowers / native** | **Spec Kit** | **kanban-markdown (LachyFS)** |
|---|---|---|---|---|
| **Repo / source** | `bmad-code-org/BMAD-METHOD` (MIT) — **2 generations** (v4 `.bmad-core/`, v6 `_bmad/`) | this repo `.kanban/` + plugin skills | `github/spec-kit` | `LachyFS/kanban-markdown-vscode-extension` (our fork's upstream) |
| **Storage** | per-story `.md` in `docs/stories/` (v4) or `{impl_artifacts}/` (v6); epics = headings in PRD/`epics.md` | per-story folder `.kanban/features/<id>/story.md` (current) or flat `<id>.md` (legacy) | per-feature dir `specs/NNN-name/` (spec.md + plan.md + tasks.md + …) | one `.md` per card in `.devtool/features/` |
| **Item file format** | markdown `##` headings; v4 no frontmatter, v6 small frontmatter + bare `Status:` line | YAML frontmatter + body; AC as `- [ ]` | markdown, **no frontmatter** (bold metadata block); tasks = `T###` checkboxes | YAML-*ish* frontmatter (**regex-parsed, not YAML**) + body |
| **Stable id** | `epic.story` (`1.2` / `1-2-slug`) | folder name | `NNN` dir prefix (or `YYYYMMDD-HHMMSS`) | frontmatter `id` (else filename) |
| **Status source → Norm** | v4: `## Status` (Draft/Approved/InProgress/Review/Done); v6: **central `sprint-status.yaml`** (kebab) | frontmatter `status` + `done/` folder (`completed`→`done` drift) | **only task checkboxes** `[ ]`/`[x]` → infer feature status from aggregate | column-id frontmatter (+ `done/` folder) |
| **Priority** | ✗ none | ✓ `priority` field | ✓ story `(Priority: P1/P2/P3)` | ✓ `priority` field |
| **Estimate** | ✗ (by design) | ✗ | ✗ | ✗ |
| **Dependencies** | implicit **sequential numbering** only | ✓ explicit `dependsOn` (folder-ids) — *the strongest* | phase order + `[P]` (parallel≠dep) + `[US#]` + inline `(depends on T0xx)` | ✗ none |
| **Hierarchy** | epic→story→task (task = in-story checkbox) via numbering | flat (`epic` string → parent) | feature→story(`US#`)→task(`T###`) | flat (`epic` string → parent) |
| **Acceptance criteria** | numbered list (v4) or Gherkin (v6 `epics.md`) | `- [ ]` under `## Acceptance criteria` | Given/When/Then + `FR-###`/`SC-###` in spec.md | ✗ (none; would scrape body `- [ ]`) |
| **Config file (where to read paths)** | `bmad-core/core-config.yaml` (v4) / `_bmad/bmm/config.yaml` (v6) | `.kanban/instructions.md` | `.specify/feature.json` + `specs/` scan | `package.json` setting `featuresDirectory` |
| **Adapter difficulty** | ★★★ (2 generations, sharding, central status) | ★ (native; mostly done) | ★★ (multi-file, infer status from tasks) | ★ (≈ our format; robustness shim) |

## Cross-cutting implications for the adapter layer

1. **Status derivation is per-adapter and never uniform.** native/kanban = a frontmatter field (+ `done/` folder); BMAD v6 = a central `sprint-status.yaml`; Spec Kit = aggregate of `tasks.md` checkboxes. The `FrameworkAdapter` interface is right (each owns `listItems`), but each computes `status` differently — none can be shared.
2. **`blocked`/`cancelled` are essentially un-sourceable.** No framework writes them. They only arise from our overlay/`dependency_graph` (a startable item with unmet deps → effectively blocked). Don't expect them from adapters.
3. **Dependencies degrade by source.** Only `native` has explicit `dependsOn`. BMAD = infer `story N.M depends on N.(M-1)` + `epic N on N-1`. Spec Kit = phase precedence (Foundational blocks all) + inline text; **`[P]` means parallel, NOT a dependency** (easy to get backwards). kanban-markdown = none. → Mark inferred deps as inferred; the graph is only as rich as the source.
4. **No estimates anywhere; priority only in 3 of 4.** `estimate` is always `null`. `priority` is `null` for BMAD and for Spec Kit *tasks* (stories carry P1–P3).
5. **Identity = the stable natural key, never the slug.** native=folder, BMAD=`epic.story`, Spec Kit=`NNN`, kanban=frontmatter id. Namespace per framework (`bmad:`, `speckit:`, `kanban-markdown:`); key joins on the number/folder, keep `source.path` to disambiguate. Slugs/titles rename freely.
6. **Each adapter reads a config to find artifacts** (don't hardcode dirs): BMAD `core-config.yaml`/`_bmad` config (+ sharding booleans), Spec Kit `.specify/feature.json` + branch-prefix resolution, native `.kanban/instructions.md`, kanban-markdown the VS Code setting.
7. **Parsing robustness, per format:** kanban-markdown is **regex-parsed** (mimic its serializer byte-for-byte on write, or it can't read back); BMAD is heading-based across **two generations** (match headings case-insensitively, flexible whitespace; detect `.bmad-core/` vs `_bmad/`); Spec Kit templates ship **sample/placeholder lines + HTML comments** (skip `<!-- -->` and `[Placeholder]`/`TXXX`/sample `T001` rows). All adapters: skip malformed items, never throw on one bad file.
8. **Item granularity choice.** BMAD/Spec Kit have real sub-items (tasks); native/kanban are flat. Decide whether tasks become `type:'task'` WorkItems (children) or stay inside the parent body — recommend emitting tasks as children for BMAD/Spec Kit (they carry the checkbox status), flat for native/kanban.

## Recommended adapter build order
1. **native** — done (read + setStatus). Add: `type` for epic/spec/plan, `children` inversion by `epic`, `blockedBy` fallback, preserve dropped fields in `overlay`.
2. **kanban-markdown** — cheapest next (≈ native's legacy flat format): one `.md`/card, regex frontmatter, `done/` folder. Mostly an id/robustness shim; also covers our own legacy flat files.
3. **spec-kit** — `specs/NNN-*/`; emit a `feature` per dir + `task` children from `tasks.md` checkboxes; infer status from checkbox aggregate; parse `[US#]`/`[P]`/phases.
4. **bmad** — hardest; gate on detecting v4 vs v6; read the config; parse `epic.story` numbering + (v6) `sprint-status.yaml`; AC numbered-list *and* Gherkin.

## Notes
- Full per-framework teardowns (templates, exact field tables, gotcha lists) were produced by four parallel research agents this session — see the transcript for the verbatim depth (BMAD story templates, Spec Kit `tasks.md` grammar, native schema-drift map, kanban-markdown serializer).
- This reference feeds the Backlog MCP spec's build order (its "superpowers + markdown adapters → BMAD → GitHub" slices) and the `FrameworkAdapter` design.
