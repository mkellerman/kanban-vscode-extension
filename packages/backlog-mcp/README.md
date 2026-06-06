# @kanban/backlog-mcp

Framework-agnostic **work + session normalizer** — the shared foundation the
**Kanban Board** and **Product Architect** both consume. See the design specs:
`.kanban/specs/2026-06-06-backlog-mcp-design.md` (+ the architecture overview).

> **Status: stub / contract.** This package currently freezes the **contract**
> (`WorkItem`, `Session`, `DependencyGraph`, the tool surface) and serves
> **fixtures** through both interfaces, so the Board and PA can build in parallel.
> Real adapters (native → superpowers → bmad → github → sessions) replace the data
> source next; the contract stays put.

## Two interfaces, one core

- **Library** (`import … from '@kanban/backlog-mcp'`) — for the extension/board, in-process.
- **MCP server** (`pnpm dev`) — for agents (the PA Conductor), over stdio.

## Contract

`src/contract.ts` is the single source of truth. Tools:
`detect_frameworks`, `list_work_items`, `get_work_item`, `get_item_body`,
`dependency_graph`, `list_sessions`, `get_session`.

## Scripts

```sh
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm dev         # run the stub MCP server on stdio
```
