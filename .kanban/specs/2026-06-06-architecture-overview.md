# Architecture Overview — Three Products

**Date:** 2026-06-06
**Status:** overview / index — the north-star map for the three products and how they compose.

This effort is **three separate products**, each with a single responsibility, composing over shared data. Each has its own spec and is independently extractable.

| # | Product | Job | Form factor | Consumes | Spec |
|---|---|---|---|---|---|
| 1 | **Kanban Board** | **Visualize** work + live sessions + dependencies | VS Code extension (this repo) | Backlog MCP (library) + sessions | `2026-06-06-kanban-board-design.md` |
| 2 | **Product Architect (PA) Orchestrator** | **Orchestrate** — converse, plan, conduct, gate | Global skill + role subagents (`~/.claude/`) | Backlog MCP (over MCP) + sessions | `2026-06-06-product-architect-orchestrator-design.md` |
| 3 | **Backlog MCP** | **Normalize** heterogeneous frameworks → `WorkItem`s + graph | MCP server **+** library | local framework artifacts | `2026-06-06-backlog-mcp-design.md` |

## Data flow

```
   framework artifacts (Superpowers / BMAD / GitHub / markdown / native)
              │
        ┌─────▼──────────────────────────┐
        │  (3) BACKLOG MCP                │  normalize → WorkItems + objective graph
        │  • MCP server  (for agents)     │  (ready-set, deps, cycles)
        │  • library     (for in-process) │
        └───┬───────────────────────┬─────┘
            │ over MCP              │ as library
   ┌────────▼─────────┐   ┌─────────▼───────────────┐
   │ (2) PRODUCT      │   │ (1) KANBAN BOARD         │
   │     ARCHITECT    │   │     (extension)          │
   │ converse · plan ·│   │ render WorkItems + the   │
   │ conduct · gate   │   │ live session layer +     │
   │ (opinionated     │   │ Ready lane + dep arrows  │
   │  ranking/gates)  │   │ (visualize only)         │
   └────────┬─────────┘   └─────────┬───────────────┘
            │ launches agents        │ SessionProvider (own reader + optional claudine)
            ▼                        ▼
        Claude sessions  ~/.claude/projects/**/*.jsonl  (execution / audit)
```

**The Board and the PA never call each other** — they meet through the shared work store + the Backlog MCP. The Board *shows* state; the PA *changes* it; the MCP *normalizes* it.

## Principles

- **Depend on capabilities, not formats.** Planning comes from the Backlog MCP; execution from the `SessionProvider`. New framework / new session source = new adapter; consumers unchanged.
- **One job per product.** Normalize (MCP) ≠ visualize (Board) ≠ orchestrate (PA). Objective graph queries live in the MCP; *opinionated* ranking/lifecycle live in the PA; rendering lives in the Board.
- **Loose coupling.** Each product is separately useful and separately extractable. The MCP helps any agent; the Board works without the PA; the PA works on any board the MCP can read.

## Repo layout (monorepo, for now)

```
/                       # product 1 — the Kanban Board extension (stays at root)
  pnpm-workspace.yaml
  packages/
    backlog-mcp/        # product 3 — MCP server + library
    product-architect/  # product 2 — source (skill + role agents + thin CLI), deployed to ~/.claude/
```

(The PA source may instead live under `.claude/` and deploy to `~/.claude/`; TBD in its spec. Each package/product lifts out to its own repo later.)

## Cross-cutting decisions (live in the per-product specs)

- claudine = **optional** session enrichment (no hard dependency) — PA/Board spec.
- Backlog MCP foreign adapters = **read-only**; consumer state via overlay — Backlog MCP spec.
- Story ↔ session linking = branch/worktree + launch-capture + manual — PA spec.
- Human-gated lifecycle (checkpoint at every transition) — PA spec.
