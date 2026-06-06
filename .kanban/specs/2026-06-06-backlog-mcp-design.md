# Design: Backlog MCP — a framework-agnostic work + session normalizer

**Date:** 2026-06-06
**Status:** spec v1 — pending user review
**Codename:** Rosetta (placeholder)
**Relationship:** A standalone product the **Product Architect** consumes. See `.kanban/specs/2026-06-06-product-architect-orchestrator-design.md`.

---

## 1. Problem & vision

Every planning framework stores work differently — Superpowers (`.kanban/` + specs/plans), BMAD (PRD → epics → stories → tasks), GitHub Issues, Jira/Linear exports, plain-markdown checklists. An agent built for one is blind to the others, and re-teaching it each format is endless.

**Backlog MCP** is a local **MCP server** that reads heterogeneous local artifacts — planning (Superpowers/BMAD/GitHub/markdown/native) **and** Claude/Codex **sessions** (JSONL) — and serves them as **two normalized models** (`WorkItem`s + `Session`s) over MCP. Any MCP-capable agent — the Product Architect, the Kanban Board, Claude Code, Cursor — becomes **framework-agnostic for free**. Adding a framework or session source = adding an adapter; consumers change nothing.

> The principle the PA is built on: **depend on capabilities, not formats.** Backlog MCP provides **both** capabilities — planning (`WorkItem`s) and execution (`Session`s) — so the Board and PA never read raw artifacts themselves.

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | Consumer coupling | Consumers talk **only** to the normalized model. **Agents (the PA Conductor) use the MCP server** — they need usage instructions, nothing compiled/shared. **The extension imports the same package as a library.** Our `.kanban/` format is just one adapter (`native`), not special-cased. |
| 2 | Direction | **Read-only first** for foreign frameworks — never mutate someone else's BMAD/Jira/GitHub files. Consumer-specific state lives in an **overlay** keyed by normalized id. (Per-adapter write-back is a later opt-in.) |
| 3 | Packaging | **Single monorepo package for now** — `packages/backlog-mcp` (pnpm workspace; extension stays at root), exposing **both an MCP server** (for agents) **and a library** (the extension imports it). Co-developed with the PA, **extractable to its own repo later**. `npx`-distributable as a server. **No separate `contracts` package.** |
| 4 | Write authority | The **native adapter is read+write** (it's our own format); **foreign adapters are read-only**; foreign PA-state goes to the overlay. |
| 5 | Scope | Normalize + serve, **plus objective derived queries** (dependency graph: ready-set, deps closure, critical path, cycles) — computed once so neither consumer reimplements them. **Opinionated orchestration stays in the PA** ("what's next" ranking weights, lifecycle gates, conducting). |
| 6 | Two domains | Normalizes **work items AND sessions**. Sessions: read Claude/Codex JSONL (tail-parse, claudine technique, MIT) → normalized `Session`s (status, last activity, model, tokens); **claudine-optional enrichment lives here**, not in the Board. (Resolves the old one-vs-two question → one server, two domains.) |
| 7 | Deployment scope | **Project scope** (repo `.mcp.json`) → this repo only. **User scope** (global) → all projects. Same server, mode set by config. Sessions cross-project = free (all under `~/.claude/projects/*`); planning cross-project needs a **project-root registry** (the session-dir encoding is lossy). |

### Repo layout (monorepo, for now)
Lives in the kanban-extension repo as a single pnpm-workspace package; the extension stays at the repo root.
```
/                     # repo root = the VS Code extension
  pnpm-workspace.yaml # packages: ['packages/*']
  packages/
    backlog-mcp/      # @repo/backlog-mcp — normalizer + adapters + graph, exposed two ways:
                      #   • MCP server entrypoint  → agents (the PA Conductor) use this over the protocol
                      #   • library export         → the extension imports it in-process
```
**Nothing extra is shared.** Agents get the contract from the MCP **tool schemas** at runtime (just need usage instructions); the extension imports the same package as a library. No separate types package (an earlier `contracts` idea — dropped). Extraction later = lift out `packages/backlog-mcp`.

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

### 5.1 The `native` on-disk format
The `native` adapter (read+write) owns the canonical layout:
```
.kanban/features/<id>/
  story.md      # frontmatter (below) + body: title, acceptance criteria, context, review-feedback
  spec.md       # design   ·   plan.md   # implementation plan   ·   audit.jsonl   # {ts,session,transition}
  artifacts/    # screenshots, walkthroughs, generated files
```
`story.md` frontmatter (first-class, typed, lossless): `id`, `status` (backlog|todo|in-progress|review|done), `priority`, `epic`, `order` (fractional index), `dependsOn: [ids]`, `sessions: [uuids]`, `reviews: {role: verdict}`, `handoff: {…}`, `created`/`modified`/`completedAt`/`assignee`/`labels`. Done stories: move the whole `<id>/` folder to `.kanban/features/done/<id>/`. **Flat→folder migration** (from today's flat `<id>.md`) is a one-time, lossless/reversible converter in this adapter.

### 5.2 Sessions domain (the execution side)
The MCP also normalizes **Claude/Codex sessions** so the Board (render live activity) and the PA (link + audit) consume them the same way as work items — neither reads JSONL itself.
- **Reader:** incremental **tail-parse** of `~/.claude/projects/<proj>/<uuid>.jsonl` (byte-offset cache, read only appended bytes; LRU; shrink-detection) — claudine's technique (MIT), so huge transcripts stay cheap. Extracts: last tool activity, active/idle, needs-input/error/interruption/rate-limit, sidechain steps, git branch, worktree — **plus `model` + token `usage`** (which claudine omits).
- **claudine-optional:** if `claudine.claudine` is installed, a session adapter enriches via its Extension API and we skip our own watcher; absent it, the own reader covers everything. No hard dependency.
- **Normalized `Session`:** `{ id (uuid), project, status, lastActivity, gitBranch, worktree, model, tokens, workItemId? }`. Linked to a `WorkItem` by recorded session id (the PA writes it at launch) and/or `story/<id>` branch/worktree.

## 6. MCP surface (read-only first)

| Tool | Returns / does |
|---|---|
| `detect_frameworks()` | `[{ framework, root, itemCount }]` — what's present in the workspace |
| `list_work_items({ type?, status?, framework?, parent? })` | `WorkItem[]` (no bodies — small payloads) |
| `get_work_item(id)` | one `WorkItem` (with `overlay` merged) |
| `get_item_body(id)` | full markdown/text for an item |
| `refresh()` | invalidate caches / force re-scan |
| `dependency_graph()` / `ready_set()` | objective graph over the items: ready-set (all deps satisfied), transitive closure, critical path, cycle detection |
| `list_sessions({ project?, workItemId? })` / `get_session(id)` | normalized `Session`s (live status/activity/model/tokens); filter by project or linked work item |
| `set_status(id, status)` | **native adapter only** for now; foreign → error "read-only" until per-adapter write-back ships |

`dependency_graph()` / `ready_set()` **are** here — they're objective queries *over* the normalized items, computed once so neither the board nor the Conductor reimplements them. What stays **out**: the PA's *opinionated* decisions — "what's next" ranking weights and lifecycle gates live in the PA. Backlog MCP answers "what exists and how it depends," not "what you should do about it."

## 7. 'Live' semantics, caching & watching

- Each call reads current state; an in-memory cache keyed by file path + mtime/byte-size avoids re-parsing unchanged files (mirrors the session engine's tail-parse discipline).
- Optional file watching emits an MCP notification (or the consumer polls `refresh()`); cheap because adapters re-parse only changed files.
- Adapters must be **defensive** (skip malformed items, never throw on one bad file) and **fast** (lazy bodies via `bodyRef`).

### 7.1 Deployment scope — project vs user
Same server; the mode is set by where it's registered:
- **Project scope** (repo `.mcp.json`, root = the repo): serve only this repo's framework artifacts + its sessions (filter `~/.claude/projects/` to this repo's encoded cwd).
- **User scope** (global MCP config, no single root): serve **all** projects. *Sessions:* enumerate every `~/.claude/projects/*` dir — clean and cross-project. *Planning:* aggregate across a **project-root registry** the server maintains (seeded by repos it's run in, or a configured list), because the `~/.claude/projects` dir encoding is lossy and can't be reverse-mapped to repo paths reliably.
- The mode is an explicit flag/env the launcher sets; the same adapters run either way (one project-root vs many).

## 8. The overlay (consumer state without mutation)

Foreign frameworks are read-only, but a consumer (the PA) needs to attach its own state (sessions, reviews, handoff, and a `pa_status` when its lifecycle differs from the source's). That state lives in an **overlay store keyed by normalized id** (e.g. `.kanban/overlay/<id>.json`), merged into `WorkItem.overlay` at read time. The **native** adapter needs no overlay — its items hold their own state in `story.md`. **Status authority** (§14 q1): for foreign items the source's `status` is authoritative for its fields; the overlay's `pa_status` is a separate, clearly-labeled lifecycle marker.

## 9. Relationship to the PA & the session normalizer

- **PA:** its engine (dependency graph, scheduler, "what's next", conducting) consumes `WorkItem[]` from Backlog MCP. The PA's per-story-folder is just the `native` adapter. This makes the PA framework-agnostic and *smaller*, and — because it's MCP — the Conductor skill connects the standard way (resolving the PA spec's §14.2 CLI-reach problem).
- **Sessions (§5.2):** the MCP normalizes sessions too — the Board renders them, the PA links + audits them. This is now **inside** the MCP, not a separate `SessionProvider` in the Board/PA (resolving the old one-vs-two question: one server, two domains). claudine-optional lives here.

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
5. **Sessions domain** — JSONL tail-parse reader + normalized `Session` + `list_sessions`/`get_session` + claudine-optional + scope-aware enumeration (project vs user).
6. **Native write (`set_status`) + watching/notifications.**
7. **(Later) per-adapter write-back** for foreign frameworks.

(1) alone makes the PA framework-agnostic over our own format via a clean MCP boundary; (2)+(3) deliver the actual cross-framework payoff.

## 12. Testing

- **Adapter conformance suite** — a shared test that every adapter must pass against a fixture repo of its framework: ids are stable + namespaced, hierarchy (parent/children) and `dependsOn` resolve to valid ids, status maps into `NormStatus`, malformed files are skipped not fatal.
- **Normalization** — golden tests: fixture framework dir → expected `WorkItem[]`.
- **Overlay merge** — foreign item + overlay → merged `WorkItem`; native item ignores overlay.
- **MCP layer** — tool-call smoke tests over a temp workspace with two frameworks present at once.

## 13. Open questions

1. **Status authority** between a foreign source and the PA overlay (§8) — confirm `source.status` vs `overlay.pa_status` precedence and how the board displays both.
2. **Stable cross-framework ids** — namespacing scheme must survive re-scans and item renames (BMAD story files can be renamed; GitHub numbers are stable; markdown checklist items have no natural id — hash of text + position?).
3. **One server vs two — RESOLVED:** one server, two domains (work items + sessions; §5.2/§6).
4. **Dependency expression varies** — BMAD/GitHub express deps differently (or not at all); the adapter must infer `dependsOn` where the framework lacks it (e.g. GitHub "blocked by #N" text, BMAD story ordering).
5. **User-scope planning discovery** — sessions enumerate cleanly from `~/.claude/projects/*`, but planning artifacts need each repo's root, and the dir encoding is lossy → user scope needs a project-root **registry** (auto-seeded vs user-configured — TBD).
6. **Distribution** — `npx` standalone vs bundled-in-the-extension vs both; how consumers discover/launch it (and pass the scope mode).
