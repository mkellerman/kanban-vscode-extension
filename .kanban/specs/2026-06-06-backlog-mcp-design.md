# Design: Backlog MCP — a framework-agnostic work-item normalizer

**Date:** 2026-06-06
**Status:** spec v1 — pending user review
**Codename:** Rosetta (placeholder)
**Relationship:** A standalone product the **Product Architect** consumes. See `.kanban/specs/2026-06-06-product-architect-orchestrator-design.md`.

---

## 1. Problem & vision

Every planning framework stores work differently — Superpowers (`.kanban/` + specs/plans), BMAD (PRD → epics → stories → tasks), GitHub Issues, Jira/Linear exports, plain-markdown checklists. An agent built for one is blind to the others, and re-teaching it each format is endless.

**Backlog MCP** is a local **MCP server** that reads heterogeneous planning artifacts from whatever framework(s) a workspace uses and serves them as **one normalized model of work items** over MCP. Any MCP-capable agent — the Product Architect, Claude Code, Cursor, anything — becomes **framework-agnostic for free**. Adding a framework = adding an adapter; consumers change nothing.

> The principle the PA is built on: **depend on capabilities, not formats.** Backlog MCP is the planning-side capability. (The session-side analogue is the PA's `SessionProvider` / claudine layer — same pattern, see §9.)

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | Consumer coupling | Consumers (incl. the PA) talk **only** to the normalized model; **our `.kanban/` format is just one adapter** ("native"), not special-cased. |
| 2 | Direction | **Read-only first** for foreign frameworks — never mutate someone else's BMAD/Jira/GitHub files. Consumer-specific state lives in an **overlay** keyed by normalized id. (Per-adapter write-back is a later opt-in.) |
| 3 | Packaging | **Monorepo package for now** — `packages/backlog-mcp` in this repo (pnpm workspace; shared types in `packages/contracts`; extension stays at root), co-developed with the PA and **extractable to its own repo later** (the package boundary keeps it standalone). A Node/TS **MCP server**, `npx`-distributable; the PA extension can launch or connect to it. |
| 4 | Write authority | The **native adapter is read+write** (it's our own format); **foreign adapters are read-only**; foreign PA-state goes to the overlay. |
| 5 | Scope | Normalize + serve. **Orchestration stays in the consumer** (the PA owns the dependency graph / scheduler / lifecycle); Backlog MCP just answers "what work exists, normalized." |

### Repo layout (monorepo, for now)
Lives in the kanban-extension repo as a pnpm-workspace package; the extension stays at the repo root.
```
/                     # repo root = the VS Code extension (PA engine: graph/scheduler/validate)
  pnpm-workspace.yaml # packages: ['packages/*']
  src/…               # extension code; note the extension's own internal src/shared/ is unrelated
  packages/
    contracts/        # @repo/contracts — WorkItem + NormStatus + normalized session types (pure, no deps)
    backlog-mcp/      # @repo/backlog-mcp — the MCP server + adapters (depends on @repo/contracts)
```
Named `contracts` (not `shared`) to avoid colliding with the extension's existing `src/shared/`. Extraction later = lift out `packages/backlog-mcp` + `packages/contracts`.

## 3. Architecture

```
   frameworks (adapters, pluggable)        normalized core           MCP surface (read-only first)
 ┌──────────────────────────────┐        ┌───────────────────┐    detect_frameworks()
 │ native    .kanban/<id>/story  │ R/W ─┐ │ WorkItem {        │    list_work_items(filter)
 │ superpowers  specs/ + plans/  │ R  ──┤ │   id, source,     │    get_work_item(id)
 │ bmad      docs/epics,stories  │ R  ──┼►│   type, title,    │ ──► get_item_body(id)
 │ github    issues (gh/api)     │ R  ──┤ │   status, prio,   │    list_frameworks()
 │ jira/linear  export files     │ R  ──┤ │   parent,children,│    refresh()
 │ markdown  - [ ] task lists    │ R  ──┘ │   dependsOn[], …  │    [set_status / write — native only now]
 └──────────────────────────────┘        └─────────┬─────────┘
   detect() · listItems() · normalize()             │ merge
   (+ writeStatus() later, per adapter)    ┌─────────▼─────────┐
                                           │ overlay (consumer │  per-normalized-id state the
                                           │ state, by id)     │  source can't hold (e.g. PA's
                                           └───────────────────┘  sessions/reviews/handoff)
```

`'live'`: every MCP call reads the current artifacts (with caching/watching, §7) and normalizes on the fly — not a one-time migration. **Add a framework → add an adapter → consumers unchanged.**

## 4. The normalized `WorkItem`

```ts
interface WorkItem {
  id: string                  // stable, source-namespaced, e.g. "bmad:epic-3.story-2" | "gh:#142" | "native:snooze-2026-06-06"
  source: { framework: string; path: string }   // provenance: which adapter + where on disk
  type: 'epic' | 'feature' | 'story' | 'task' | 'enabler' | 'spec' | 'plan'
  title: string
  status: NormStatus          // 'backlog'|'todo'|'in-progress'|'review'|'done'|'blocked'|'cancelled'
  priority: 'critical' | 'high' | 'medium' | 'low' | null
  parent: string | null       // normalized id
  children: string[]          // normalized ids (epic→stories, story→tasks)
  dependsOn: string[]         // normalized ids
  labels: string[]
  estimate: string | null     // points / t-shirt, verbatim if present
  acceptanceCriteria: string[]
  bodyRef: string             // fetch full text via get_item_body(id) (keep list payloads small)
  overlay?: Record<string, unknown>   // consumer state merged in (PA: sessions/reviews/handoff/pa_status)
}
```

**Status normalization** is per-adapter (each framework's vocabulary → `NormStatus`), e.g. BMAD `Draft|Approved|InProgress|Review|Done` and GitHub `open/closed (+labels)` each map to the common set. Unmappable states pass through as `labels`.

## 5. Adapter contract

```ts
interface FrameworkAdapter {
  name: string
  detect(root: string): Promise<boolean>          // is this framework present in the workspace?
  listItems(root: string): Promise<WorkItem[]>     // read + parse + normalize (id, deps, hierarchy)
  getBody(id: string): Promise<string>             // full text on demand
  // later, opt-in (native implements now; foreign deferred):
  setStatus?(id: string, status: NormStatus): Promise<void>
}
```

**First adapters:** `native` (our `.kanban/<id>/story.md` per-story folders — read+write), `superpowers` (specs/plans + any `.kanban` features), `bmad` (PRD/epics/stories/tasks docs), `github-issues` (via `gh`), `markdown` (`- [ ]` task lists / a `TASKS.md`). Each is ~one file; the registry auto-detects which are present.

## 6. MCP surface (read-only first)

| Tool | Returns / does |
|---|---|
| `detect_frameworks()` | `[{ framework, root, itemCount }]` — what's present in the workspace |
| `list_work_items({ type?, status?, framework?, parent? })` | `WorkItem[]` (no bodies — small payloads) |
| `get_work_item(id)` | one `WorkItem` (with `overlay` merged) |
| `get_item_body(id)` | full markdown/text for an item |
| `refresh()` | invalidate caches / force re-scan |
| `set_status(id, status)` | **native adapter only** for now; foreign → error "read-only" until per-adapter write-back ships |

Orchestration tools (`dependency_graph`, `whats_next`) are deliberately **NOT** here — they belong to the consumer (the PA computes them from `list_work_items`). Backlog MCP answers "what exists," not "what to do."

## 7. 'Live' semantics, caching & watching

- Each call reads current state; an in-memory cache keyed by file path + mtime/byte-size avoids re-parsing unchanged files (mirrors the session engine's tail-parse discipline).
- Optional file watching emits an MCP notification (or the consumer polls `refresh()`); cheap because adapters re-parse only changed files.
- Adapters must be **defensive** (skip malformed items, never throw on one bad file) and **fast** (lazy bodies via `bodyRef`).

## 8. The overlay (consumer state without mutation)

Foreign frameworks are read-only, but a consumer (the PA) needs to attach its own state (sessions, reviews, handoff, and a `pa_status` when its lifecycle differs from the source's). That state lives in an **overlay store keyed by normalized id** (e.g. `.kanban/overlay/<id>.json`), merged into `WorkItem.overlay` at read time. The **native** adapter needs no overlay — its items hold their own state in `story.md`. **Status authority** (§14 q1): for foreign items the source's `status` is authoritative for its fields; the overlay's `pa_status` is a separate, clearly-labeled lifecycle marker.

## 9. Relationship to the PA & the session normalizer

- **PA:** its engine (dependency graph, scheduler, "what's next", conducting) consumes `WorkItem[]` from Backlog MCP. The PA's per-story-folder is just the `native` adapter. This makes the PA framework-agnostic and *smaller*, and — because it's MCP — the Conductor skill connects the standard way (resolving the PA spec's §14.2 CLI-reach problem).
- **Session normalizer (symmetry):** the PA's `SessionProvider` (own JSONL reader + optional claudine) is the *execution-side* version of this exact pattern. **Open choice (§14):** one MCP server with two domains (work items + sessions) or two servers. Either way, the PA consumes normalized capabilities, not formats.

## 10. Non-goals

- Not a project-management UI (it's a normalization service; the PA/board is the UI).
- Not a two-way sync engine (read-only first; write-back is later, per-adapter, opt-in).
- Not an orchestrator (no scheduling/graph/lifecycle — that's the consumer's job).
- No cloud / no network beyond a framework's own CLI (e.g. `gh`); local artifacts only.

## 11. Build order

1. **Core + native adapter + MCP server skeleton** — `WorkItem` schema, adapter registry, `detect_frameworks`/`list_work_items`/`get_work_item`/`get_item_body`, the `native` adapter (read), the overlay merge. Vitest + an MCP smoke test.
2. **Superpowers + markdown adapters** — prove multi-framework on real repos.
3. **BMAD adapter** — the headline second framework.
4. **GitHub Issues adapter** (via `gh`).
5. **Native write (`set_status`) + watching/notifications.**
6. **(Later) per-adapter write-back** for foreign frameworks.

(1) alone makes the PA framework-agnostic over our own format via a clean MCP boundary; (2)+(3) deliver the actual cross-framework payoff.

## 12. Testing

- **Adapter conformance suite** — a shared test that every adapter must pass against a fixture repo of its framework: ids are stable + namespaced, hierarchy (parent/children) and `dependsOn` resolve to valid ids, status maps into `NormStatus`, malformed files are skipped not fatal.
- **Normalization** — golden tests: fixture framework dir → expected `WorkItem[]`.
- **Overlay merge** — foreign item + overlay → merged `WorkItem`; native item ignores overlay.
- **MCP layer** — tool-call smoke tests over a temp workspace with two frameworks present at once.

## 13. Open questions

1. **Status authority** between a foreign source and the PA overlay (§8) — confirm `source.status` vs `overlay.pa_status` precedence and how the board displays both.
2. **Stable cross-framework ids** — namespacing scheme must survive re-scans and item renames (BMAD story files can be renamed; GitHub numbers are stable; markdown checklist items have no natural id — hash of text + position?).
3. **One server vs two** (work items + sessions) — decide alongside the PA's session layer (§9).
4. **Dependency expression varies** — BMAD/GitHub express deps differently (or not at all); the adapter must infer `dependsOn` where the framework lacks it (e.g. GitHub "blocked by #N" text, BMAD story ordering).
5. **Distribution** — `npx` standalone vs bundled-in-the-extension vs both; how the PA discovers/launches it.
