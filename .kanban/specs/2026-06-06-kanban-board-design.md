# Design: Kanban Board (extension) — the visualize product

**Date:** 2026-06-06
**Status:** spec v1 — pending user review
**Product:** #1 of three (see `2026-06-06-architecture-overview.md`). Siblings: Product Architect (`…-product-architect-orchestrator-design.md`), Backlog MCP (`…-backlog-mcp-design.md`).

---

## 1. Vision

The Kanban Board is the **human's window** onto the work. Its one job is to **visualize**: render the normalized work model (whatever framework it came from) and the **live execution** layer (what agents are doing right now), with dependencies and readiness made visible. It does **not** normalize (that's the Backlog MCP) and does **not** orchestrate (that's the PA). It evolves from today's extension, which reads flat `.md` files, into a renderer of `WorkItem`s + sessions.

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | Role | **Visualize only.** No normalization, no orchestration. A consumer of the other two products. |
| 2 | Work data | Render `WorkItem`s from the **Backlog MCP, imported as a library** (in-process). The board never parses framework files itself — every framework (native/Superpowers/BMAD/GitHub/markdown) arrives pre-normalized, so they all render identically. |
| 3 | Session data | The board **owns the live session layer**: a `SessionProvider` (own JSONL tail-parse reader, technique borrowed from claudine, MIT) with **optional claudine enrichment** (no hard dependency). Renders activity dot/timer, last tool, needs-input, model/tokens. |
| 4 | Layout | Columns = `WorkItem.status` (lifecycle); a **Ready lane** (from the MCP's `ready_set`); **dependency arrows** (from the MCP's `dependency_graph`); a per-card **session badge** + expandable live strip. |
| 5 | Framework-agnostic UI | BMAD/GitHub/native items render the same — they're all `WorkItem`s. A small `source` chip shows provenance. |

## 3. Architecture

```
   ┌──────────────────────────────┐         ┌────────────────────────────┐
   │ Backlog MCP (library import)  │  items  │  KANBAN BOARD (webview)    │
   │ list_work_items / graph /     │ ───────►│  columns · Ready lane ·    │
   │ ready_set                     │  +graph │  dependency arrows ·       │
   └──────────────────────────────┘         │  session live-strip + badge│
   ┌──────────────────────────────┐ sessions│                            │
   │ SessionProvider (in extension)│ ───────►│  (visualize only)          │
   │ own JSONL reader + optional   │ live    └────────────────────────────┘
   │ claudine enrichment           │ status
   └──────────────────────────────┘
```

- **Data layer:** today's `FeatureRepository` (flat-`.md` reader) is **replaced by a Backlog-MCP-library client** — `getWorkItems()` / `getGraph()` from `@repo/backlog-mcp`. The board stops owning the file format (the MCP's `native` adapter owns per-story folders).
- **Session layer:** the `SessionProvider` reads `~/.claude/projects/**/*.jsonl` (tail-parse) and links sessions to a `WorkItem` by the item's recorded session ids (written by the PA at launch) and/or `gitBranch`/worktree match. claudine, if installed, enriches.
- **Render layer:** the existing React/Vite webview, extended.

## 4. What changes in the extension

- **Replace** `FeatureRepository` flat-`.md` reading with the Backlog-MCP library client (items + graph). (The `native` adapter in the MCP now owns reading/writing per-story folders.)
- **Webview additions:** a **Ready lane**, **dependency arrows** between cards, a **session live-strip** (active dot/timer, last tool, needs-input) + **session/audit badge**, and a `source` provenance chip.
- **Reuse:** columns, drag-drop, filters, l10n, settings, `KanbanPanel`/`SidebarViewProvider`, CSP/security.
- **AgentLauncher** stays (the PA, or a card action, launches agents); the board reflects resulting sessions via the `SessionProvider`.

## 5. Build order

1. **MCP-library data layer** — swap `FeatureRepository` to consume `@repo/backlog-mcp` (`getWorkItems`/`getGraph`); render existing columns from `WorkItem`s. (Board renders any framework.)
2. **Ready lane + dependency arrows** — from the MCP graph.
3. **Live session layer** — `SessionProvider` (own reader) + render the live-strip; **claudine-optional** enrichment.
4. **Session/audit badge** + `source` chip + the expandable per-card session timeline.

## 6. Testing

- **Data layer** — board renders a fixture set of `WorkItem`s (mixed sources) correctly into columns/Ready lane; arrows match the graph.
- **SessionProvider** — own-reader unit tests (tail-parse, last-activity, needs-input, model/tokens); claudine-adapter path when present; graceful absence.
- **Per repo policy** — every behavioral/UI step requires **`/visual-walkthrough` evidence** before done.

## 7. Open questions

1. **MCP access from the extension** — import `@repo/backlog-mcp` as an in-process library (recommended; same repo) vs. spawn it as an MCP subprocess. Library is simpler in-process; confirm.
2. **Session placement** — session-reading lives here (the renderer). Confirm the PA only needs the *link ids* (which it captures at launch) and never needs to parse transcripts itself; audit *reporting* (per-story trace) — board feature or later, via `session-report`.
3. **Migration** — the flat-`.md` → per-story-folder change is owned by the MCP `native` adapter; the board just needs the new `WorkItem`s. Coordinate the cutover so the board never reads raw files again.
