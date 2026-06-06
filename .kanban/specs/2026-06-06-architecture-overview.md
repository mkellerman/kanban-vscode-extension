# Architecture Overview — Three Products

**Date:** 2026-06-06
**Status:** overview / index — the north-star map for the three products and how they compose.

This effort is **three separate products**, each with a single responsibility, composing over shared data. Each has its own spec and is independently extractable.

| # | Product | Job | Form factor | Consumes | Spec |
|---|---|---|---|---|---|
| 1 | **Kanban Board** | **Visualize** work + live sessions + dependencies | VS Code extension (this repo) | Backlog MCP (library) + sessions | `2026-06-06-kanban-board-design.md` |
| 2 | **Product Architect (PA) Orchestrator** | **Orchestrate** — converse, plan, conduct, gate | Global skill + role subagents (`~/.claude/`) | Backlog MCP (over MCP) + sessions | `2026-06-06-product-architect-orchestrator-design.md` |
| 3 | **Backlog MCP** | **Normalize** frameworks → `WorkItem`s + graph **and** Claude sessions → `Session`s | MCP server **+** library | framework files + `~/.claude/projects` JSONL | `2026-06-06-backlog-mcp-design.md` |

## Data flow

```
   framework artifacts (Superpowers/BMAD/GitHub/markdown/native)  +  ~/.claude/projects JSONL (sessions)
              │
        ┌─────▼──────────────────────────┐
        │  (3) BACKLOG MCP                │  normalize → WorkItems + Sessions + graph
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
            │ launches agents        │ renders Sessions (from the MCP)
            ▼                        ▼
        Claude sessions  ~/.claude/projects/**/*.jsonl  (execution / audit)
```

**Sessions are an input to the MCP** (its sessions domain), alongside framework artifacts — the Board/PA consume normalized `Session`s from the MCP; they don't read JSONL themselves.

**The Board and the PA never call each other** — they meet through the shared work store + the Backlog MCP. The Board *shows* state; the PA *changes* it; the MCP *normalizes* it.

## Principles

- **Depend on capabilities, not formats.** Both planning and execution (sessions) come from the Backlog MCP. New framework / new session source = new adapter; consumers unchanged.
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

- **Sessions** normalized by the Backlog MCP too (sessions domain); claudine = **optional** enrichment there, no hard dependency — Backlog MCP spec §5.2.
- **Deployment scope:** project (this repo) vs user (all projects) — Backlog MCP spec §7.1.
- Backlog MCP foreign adapters = **read-only**; consumer state via overlay — Backlog MCP spec.
- Story ↔ session linking = branch/worktree + launch-capture + manual — PA spec.
- Human-gated lifecycle (checkpoint at every transition) — PA spec.
