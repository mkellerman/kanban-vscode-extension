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
| 3 | Session data | The board **renders** the live session layer from **normalized `Session`s served by the Backlog MCP** (`list_sessions`/`get_session`). It does **not** read JSONL itself — session-reading + claudine-optional live in the MCP (its sessions domain). |
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
   │ Backlog MCP — sessions domain │ ───────►│  (visualize only)          │
   │ list_sessions / get_session   │ live    └────────────────────────────┘
   │ (MCP owns reader + claudine)  │ status
   └──────────────────────────────┘
```

- **Data layer:** today's `FeatureRepository` (flat-`.md` reader) is **replaced by a Backlog-MCP-library client** — `getWorkItems()` / `getGraph()` from `@repo/backlog-mcp`. The board stops owning the file format (the MCP's `native` adapter owns per-story folders).
- **Session layer:** the board consumes **normalized `Session`s from the Backlog MCP** (`list_sessions`) — the MCP owns the JSONL reading + claudine-optional. The board just renders the live status linked to each `WorkItem`.
- **Render layer:** the existing React/Vite webview, extended.

## 4. What changes in the extension

- **Replace** `FeatureRepository` flat-`.md` reading with the Backlog-MCP library client (items + graph). (The `native` adapter in the MCP now owns reading/writing per-story folders.)
- **Webview additions:** a **Ready lane**, **dependency arrows** between cards, a **session live-strip** (active dot/timer, last tool, needs-input) + **session/audit badge**, and a `source` provenance chip.
- **Reuse:** columns, drag-drop, filters, l10n, settings, `KanbanPanel`/`SidebarViewProvider`, CSP/security.
- **AgentLauncher** stays (the PA, or a card action, launches agents); the board reflects resulting sessions via the **MCP's sessions domain**.

## 5. Build order

1. **MCP-library data layer** — swap `FeatureRepository` to consume `@repo/backlog-mcp` (`getWorkItems`/`getGraph`); render existing columns from `WorkItem`s. (Board renders any framework.)
2. **Ready lane + dependency arrows** — from the MCP graph.
3. **Live session layer** — render the live-strip from the MCP's `list_sessions` (the MCP owns the reader + claudine-optional).
4. **Session/audit badge** + `source` chip + the expandable per-card session timeline.

## 6. Testing

- **Data layer** — board renders a fixture set of `WorkItem`s (mixed sources) correctly into columns/Ready lane; arrows match the graph.
- **Session rendering** — given fixture `Session`s from the MCP, the live-strip renders correctly (active/idle, last tool, needs-input, model/tokens). (The reader's own tests live in the Backlog MCP spec.)
- **Per repo policy** — every behavioral/UI step requires **`/visual-walkthrough` evidence** before done.

## 7. Open questions

1. **MCP access from the extension** — import `@repo/backlog-mcp` as an in-process library (recommended; same repo) vs. spawn it as an MCP subprocess. Library is simpler in-process; confirm.
2. **Session placement — RESOLVED:** session-reading lives in the **Backlog MCP** (sessions domain); the board just renders normalized `Session`s. Audit *reporting* (per-story trace) is deferred (board feature or later, via `session-report`).
3. **Migration** — the flat-`.md` → per-story-folder change is owned by the MCP `native` adapter; the board just needs the new `WorkItem`s. Coordinate the cutover so the board never reads raw files again.
