# Kanban Board — MCP Data Layer (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). TDD for logic; UI steps need `/visual-walkthrough` evidence. Run in a worktree.

**Goal:** Make the extension's board render **`WorkItem`s sourced from `@kanban/backlog-mcp` (library)** in the existing columns, replacing flat-`.md` reading as the board's data source. (Ready lane, dependency arrows, and the session live-strip are **slice 2+** — separate plans.)

**Architecture:** The board imports the MCP package in-process (decision: library, not subprocess). A thin `workItemSource` calls `listWorkItems()` and maps each `WorkItem` → the webview's existing card shape (status → column). Wire it into the existing `KanbanPanel` init/refresh message so the React/Zustand webview renders with minimal change.

**Specs:** `.kanban/specs/2026-06-06-kanban-board-design.md`. **Contract:** `packages/backlog-mcp/src/contract.ts` (consume; don't change). **Depends on:** the Backlog MCP package (the stub is enough — fixtures render until the native adapter lands).

**Out of scope (later slices):** Ready lane, dependency arrows, session live-strip + badge, write-back (drag → `set_status`), per-story-folder migration (that's the MCP `native` adapter).

---

## File structure
- Modify: `package.json` (root) — add `"@kanban/backlog-mcp": "workspace:*"`
- Create: `src/extension/workItemSource.ts` — load WorkItems via the lib + map to the board card shape
- Create: `tests/extension/workItemSource.test.ts`
- Modify: `src/extension/KanbanPanel.ts` — use `workItemSource` for the board payload (behind a setting/flag so the existing flat-`.md` path remains until cutover)
- Possibly Modify: `src/shared/types.ts` — only if a mapping field is missing (prefer mapping into the existing card shape)

---

## Task 1: Add the dependency

- [x] **Step 1:** add `"@kanban/backlog-mcp": "workspace:*"` to root `dependencies`, then `pnpm install`.
- [x] **Step 2: Verify** the import resolves.
- [x] **Step 3: Commit** (folded into the `McpFeatureRepository` series — see commits `5abe4f2`..`e6e3a66`).

---

## Task 2: WorkItem → board card mapping

**Files:** Create `src/extension/workItemSource.ts`; Test `tests/extension/workItemSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { toCard } from '../../src/extension/workItemSource'
import type { WorkItem } from '@kanban/backlog-mcp'

const wi: WorkItem = {
  id: 'native:ready-lane-ui', source: { framework: 'native', path: 'x' },
  type: 'story', title: 'Ready lane UI', status: 'todo', priority: 'high',
  parent: null, children: [], dependsOn: ['native:dependency-graph'],
  labels: [], estimate: null, acceptanceCriteria: [], bodyRef: 'b'
}

describe('toCard', () => {
  it('maps a WorkItem to the board card shape (status → column)', () => {
    const c = toCard(wi)
    expect(c.id).toBe('native:ready-lane-ui')
    expect(c.title).toBe('Ready lane UI')
    expect(c.status).toBe('todo')       // column key
    expect(c.priority).toBe('high')
    expect(c.source).toBe('native')     // provenance chip
    expect(c.dependsOn).toEqual(['native:dependency-graph'])
  })
})
```

- [ ] **Step 2: Verify it fails**, then **implement** `workItemSource.ts`

```ts
import { listWorkItems, type WorkItem } from '@kanban/backlog-mcp'

/** The shape the webview renders. Reuse the existing card/Feature interface if present;
 *  this slice maps the fields the current board needs + provenance + deps for slice 2. */
export interface BoardCard {
  id: string
  title: string
  status: string       // maps to a column id (backlog|todo|in-progress|review|done|…)
  priority: string | null
  source: string       // provenance chip (native|bmad|github|…)
  dependsOn: string[]
  labels: string[]
}

export function toCard(wi: WorkItem): BoardCard {
  return {
    id: wi.id,
    title: wi.title,
    status: wi.status,
    priority: wi.priority,
    source: wi.source.framework,
    dependsOn: wi.dependsOn,
    labels: wi.labels
  }
}

export async function loadBoardCards(): Promise<BoardCard[]> {
  return (await Promise.resolve(listWorkItems())).map(toCard)
}
```

*(Note: `listWorkItems` is sync in the stub, async after the MCP native-adapter slice; `await Promise.resolve(...)` tolerates both. If `tests/extension` runs in vitest `node` env, the `@kanban/backlog-mcp` source import is resolved by the workspace.)*

- [x] **Step 3: Run** tests → PASS
- [x] **Step 4: Commit** — landed as the `McpFeatureRepository` (an `IFeatureRepository` impl) rather than `workItemSource.ts`; the standalone file was later removed (`f7af4ff`). Mapping is covered by `tests/extension/McpFeatureRepository.test.ts`.

---

## Task 3: Feed the board from the MCP (behind a flag)

**Files:** Modify `src/extension/KanbanPanel.ts`

- [x] **Step 1:** Setting `kanban-extension.dataSource: "files" | "backlog-mcp"` added; selecting `backlog-mcp` constructs `McpFeatureRepository` instead of `FeatureRepositoryManager` (`e6e3a66`).
- [x] **Step 2:** `McpFeatureRepository` exposes the same `IFeatureRepository` interface, so `KanbanPanel` / `SidebarViewProvider` are source-agnostic (`4dfc26a`, `ece02b2`).
- [x] **Step 3: Build** — `pnpm build` and `pnpm typecheck` clean; full root suite (451 tests) green.

- [x] **Step 4: Manual verification — `/visual-walkthrough`** captured at `.kanban/walkthroughs/kanban-board-mcp-data-layer/index.html`. Verified against the `roleplaygames-studio` workspace (custom `.kanban/` layout with `plans/`, `specs/`, `milestones/`, `archive/` — no `.kanban/features/`). All five columns populate with real items (M5 Plugin Sandboxing, M6 Domain Packages, M7 Campaign Persistence, DEVINFRA-P1, Story Breakdown Design, etc.).

- [x] **Step 5: Commits** — `e6e3a66` (panel wiring), plus follow-up `b0fd430` (`feat(backlog-mcp): recursive .kanban/**/*.md discovery in native adapter`) on the dependency, required to render items from `plans/`/`specs/`/`milestones/` rather than only `features/<id>/story.md`.

---

## Self-review
- Spec coverage: consume MCP as library (Board spec #2) ✓ T1–2; render WorkItems in columns ✓ T3; provenance chip ✓ mapping.
- The flag keeps the released flat-`.md` board working — safe cutover.
- UI step gated on `/visual-walkthrough` per the repo verification policy.
- Next slices (separate plans): Ready lane + dependency arrows (from `dependency_graph`), session live-strip + badge (from `list_sessions`), drag→`set_status` write-back, then make `backlog-mcp` the default `dataSource`.
