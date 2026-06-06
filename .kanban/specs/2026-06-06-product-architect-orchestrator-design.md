# Design: Product Architect (PA) Orchestrator — Revision 3 (PA-native + session layer)

**Date:** 2026-06-06
**Status:** spec v3 — pending user review
**Supersedes:** v1, v2 (same file; see git history). v3 adds the unified two-card-type board (story *intent* + a live session *execution* layer), borrows claudine's MIT session-reading engine, and confirms building in our own extension (not a fork).

---

## 1. Vision

The **Product Architect (PA)** is a conversational orchestrator you talk to in Claude Code. It fuses a Product Owner, a Software Architect, and "all levels of the dev team" into one role you can ask:

- **"What's next?"** · **"What do we need before feature X lands?"** · **"Can you add this xyz feature?"**

It brainstorms requirements with you, produces a spec, has a plan written, has role-specific agents review it, and drives the work — subagents in a party, BMAD-style, on the Superpowers toolset, with the **Kanban board as the live, PA-aware dashboard and the source of truth**. Every story carries an **auditable trail** linking it to the Claude Code session(s) that worked it.

The PA is not a new workflow engine. It is the missing *breadth* layer over Superpowers' *depth* engine: portfolio awareness, a dependency graph, a role party, lifecycle conducting — and a board that natively renders all of it. The board **unifies two card types**: **story cards** (intent — the gated lifecycle) and a **live session layer** (execution — what the agent is doing right now, read from Claude's JSONL), linked, so planning and live agent activity share one surface with a full audit trail.

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | Form factor | **One of three products** (see `2026-06-06-architecture-overview.md`). The PA = a global Conductor skill + role subagents (this spec). The **Kanban Board** extension and the **Backlog MCP** are *separate* products it composes with — the board evolves to render the shared model, but the PA is **not** inside the extension. |
| 2 | Party stack | Custom party, informed by a deep gem-team + Superpowers analysis (best of each). |
| 3 | Party mode | Gated pipeline by default + on-demand round-table ("convene the party on X"). |
| 4 | Autonomy dial | Checkpoint at every column transition — PA works within a stage, stops for explicit go/no-go at each transition. |
| 5 | Core roster | 5 roles + Conductor (Product Owner, Architect, Critic, Security, QA); UX/Designer + DevOps optional, summoned. |
| 6 | Implementer | The TDD spine is the dev; `fullstack-developer` subagent only for independent parallel tasks. |
| 7 | Sprints | Continuous flow — "sprint" = current ordered focus set; no sprint objects, story points, or burndown. |
| 8 | Self-learning | Curated, gated skill extraction on `done` (high-confidence + reusable + novel, dedup-checked). |
| 9 | Standup | Reactive — briefs on request only; no SessionStart hook. |
| 10 | Install scope | Conductor skill + role agents global (`~/.claude/`), project-agnostic, scaffolds a board where missing. The **engine ships in the extension** (installed across the user's projects). |
| 11 | Story layout | **Per-story folder** `<id>/` bundling `story.md` + `spec.md` + `plan.md` + `audit.jsonl` + artifacts. |
| 12 | Data model | **Clean first-class schema** — `dependsOn`, `sessions`, etc. are real fields the extension understands. No `_extraFrontmatter` workarounds, no comma-string tolerance. |
| 13 | Engine location | Work-item normalization, dependency graph, **and session normalization** all live in **`packages/backlog-mcp`** (MCP server + library — see #19/#20). Vitest-tested; the PA's opinionated ranking/lifecycle is Conductor-side. |
| 14 | Auditability & sessions | The PA **records story↔session links** (captures the session id at launch) + appends an audit log at each transition, and reads normalized `Session`s from the **Backlog MCP**. Session-reading lives in the MCP; the **Board renders** the live layer; deep audit *reporting* is deferred. |
| 15 | Unified board | One board, two card types: **story cards** (intent, gated lifecycle) primary, each with a **live session layer**, + a **Sessions side-lane** for loose sessions (link / promote-to-story). |
| 16 | Session linking | Auto by `story/<id>` branch/worktree + launch-time capture + manual link/promote. |
| 17 | Build on | **Own extension** (React, story-first), not a fork. Own *baseline* session engine (technique borrowed from claudine, MIT-attributed; captures model+tokens). |
| 18 | claudine integration | **Optional** session enrichment, owned by the **Backlog MCP** (its sessions domain); no hard dependency on `claudine.claudine`. |
| 19 | Framework-agnostic data | The PA engine consumes **normalized `WorkItem`s from a separate Backlog MCP** (read-only adapters for Superpowers/BMAD/GitHub/markdown/…); our per-story-folder is just the `native` adapter. See `2026-06-06-backlog-mcp-design.md`. |
| 20 | Repo structure | **pnpm-workspace monorepo (for now)**: extension at repo root + a single `packages/backlog-mcp` (exposes an MCP server *and* a library). **No shared types package** — agents use the MCP (instructions only); the extension imports the package. Extractable to its own repo later. |

## 3. Best-of-both analysis (unchanged foundation)

### 3.1 Superpowers — the depth engine we keep intact
The lifecycle skills (`superpowers-backlog/todo/in-progress/review/done`) map 1:1 to the board columns and give bulletproof per-story rigor: the brainstorming **HARD-GATE**, **TDD iron law**, **evidence-before-assertions**, **never-review-your-own-work**, **worktree-per-story**, and **column transition = human gate**. The PA preserves these unchanged as the per-story spine.

### 3.2 Where Superpowers is thin — exactly the PA's job
| Gap | Question it blocks | PA adds |
|---|---|---|
| No portfolio / "what's next" view | "What's next?" | Board-wide scheduler |
| Dependencies are advisory text, never parsed | "What's needed before X?" | A real dependency graph (ready-set, critical path, cycles) |
| No roles | "party-mode like BMAD" | A role-specialist party, each owning a gate |
| No epic rollup, no provenance | sprint/project mgmt, auditability | Epic rollups, normalize/validate, **session-linked audit trail** |

### 3.3 gem-team — patterns we steal (adapted)
Uniform agent return contract (`status` drives the transition) · plan-gate (Critic) ≠ code-gate (Security/Reviewer), never self-review · complexity-scaled gating off `priority` · shared `context.json` read-cache · typed `handoff` baton + pre-mortem · curated skill extraction (dedup + confidence gate).

### 3.4 gem-team — what we reject
The 15-agent roster (~5 suffices) · autonomous no-gate execution (you want to witness each card move) · parallel YAML/JSON/PRD state sprawl — **the per-story folder is the only ledger** · an LLM verdict as the final done-decision for UI work (your `/visual-walkthrough` policy + human go/no-go stay authoritative).

### 3.5 awesome-copilot sourcing map
| Role / piece | Verdict | awesome-copilot source | Repo |
|---|---|---|---|
| Conductor (skill) | Author | `gem-orchestrator`, `ai-team-producer` | — |
| Product Owner | Adapt | `breakdown-epic-pm`, `prd.agent` | `backlog-grooming` ✓ |
| Architect | Author | `api-architect`, `adr-generator`, `hlbpa` | — |
| Critic | Author | `gem-critic`, `devils-advocate` | — |
| Security | Author | `gem-reviewer`, `agent-owasp-compliance` | + `/security-review` |
| QA | Adapt | `gem-browser-tester`, `breakdown-test` | `qa-expert` ✓ + `/visual-walkthrough` |
| Code reviewer · parallel dev · docs | Reuse | `gem-reviewer` · `gem-implementer` · `gem-documentation-writer` | `code-reviewer` · `fullstack-developer` · `documentation-engineer` ✓ |
| UX/Designer · DevOps (optional) | Author later | `gem-designer` · `gem-devops` | — |

### 3.6 claudine — borrowed technique + optional enrichment (MIT)
`salam/claudine` (MIT) is a VS Code kanban of Claude/Codex *sessions*. We (a) **borrow its JSONL-reading technique** for our own *baseline* session reader (§8.4), and (b) treat an installed claudine as **optional enrichment** (consume its Extension API; no hard dependency). We borrow the technique, **not** its product (its card = a session; ours = a story). Reusable fields per JSONL line: `type`, `uuid`, `parentUuid`, `timestamp`, `isSidechain`, `gitBranch`, `message.role`, `content[]` (`text`/`tool_use`/`tool_result`), `toolUseResult.interrupted`, `worktreeSession` — **plus `message.model` + `message.usage`, which claudine ignores and we capture** for the audit layer. Borrowed gotchas: `content` may be string|object|array (normalize); cwd→dir encoding is lossy (map forward only); `isActive` is a pure 2-min window (gate on new content before reacting); status/needs-input heuristics are English-keyword-fragile.

## 4. Architecture — the PA in context

> The diagram below predates the 3-product split — see `2026-06-06-architecture-overview.md` for the authoritative map. Box mapping: **PA** = Conductor + Role Party + Spine; the **"ENGINE" box** is now the **Backlog MCP** (`packages/backlog-mcp`, not `src/shared`); the **extension/board-UI box** is the separate **Kanban Board** product.

```
┌────────────────────────────────────────────────────────────────────┐
│ YOU ◄────── converse + approve at gates (Claude Code) ──────►        │
│         …and watch the board (VS Code extension) ◄──────►            │
└───────────────┬───────────────────────────────┬────────────────────┘
        ╔═══════▼═══════════════════╗   ┌────────▼──────────────────────┐
        ║ PA CONDUCTOR = SKILL      ║   │ PA-NATIVE EXTENSION (board UI) │
        ║ (global, your thread)     ║   │ • Ready lane                   │
        ║ intents · scheduler call  ║   │ • dependency arrows            │
        ║ · conducts spine + party  ║   │ • session/audit badge          │
        ╚═══╤═══════════════╤═══════╝   └───────────────┬────────────────┘
            │ CLI           │ dispatch                   │ imports
   ┌────────▼───────┐ ┌─────▼──────────────────┐ ┌──────▼─────────────────┐
   │ SUPERPOWERS    │ │ ROLE PARTY = SUBAGENTS  │ │ ENGINE  (src/shared/ TS)│
   │ SPINE (spine)  │ │ PO·Arch·Critic·Sec·QA   │ │ schema · reader · graph │
   │ brainstorm→…   │ │ uniform contract        │ │ · scheduler · validate  │
   └────────┬───────┘ └─────────────────────────┘ └──────┬─────────────────┘
            │ reads & writes                              │ reads
   ┌────────▼─────────────────────────────────────────────▼───────────────┐
   │ THE BOARD = per-story folders  .kanban/features/<id>/                  │
   │   story.md (frontmatter: status·priority·epic·order·dependsOn·sessions)│
   │   spec.md · plan.md · audit.jsonl · artifacts/                         │
   │   + .kanban/context.json (shared, regenerable cache)                   │
   └───────────────────────────────────────────────────────────────────────┘
```

Load-bearing decisions (PA):
1. **Conductor is a skill** (your thread — it converses and gates). **Roles are subagents** (fresh context, uniform contract, never self-review).
2. **The PA consumes, doesn't normalize.** Work items + the dependency graph come from the **Backlog MCP** (over the protocol); the PA never parses framework files.
3. **The PA owns *opinionated* orchestration only** — lifecycle gates + "what's next" ranking. Story columns stay human-gated; session activity (rendered by the Board) is advisory.
4. **One job per product.** Visualize = Board, normalize = MCP, orchestrate = PA.

## 5. The cast
| Player | Type | Owns gate | Job |
|---|---|---|---|
| Product Architect (Conductor) | skill | conducts all | portfolio Q&A, scheduling, seeds work, summons roles, normalize/validate |
| Product Owner | subagent | `backlog→todo` | groom into testable story; acceptance-criteria sign-off |
| Architect | subagent | `todo→in-progress` | review spec+plan for design soundness, fit, simplicity; ADR if warranted |
| Critic | subagent | `todo→in-progress` | devil's advocate: assumptions, edge cases, over-engineering, YAGNI |
| Security | subagent | `review→done` | OWASP-ish diff pass, secrets, path-traversal; `/security-review` |
| QA | subagent | `review→done` | `verification-before-completion` + `/visual-walkthrough` for UI |
| code-reviewer · fullstack-developer · documentation-engineer | subagents | as needed | code-quality · parallel impl · docs |

### 5.1 Uniform role contract
Each role subagent returns `{role, status: pass|needs_revision|blocking, confidence, verdict, findings[], what_works[], learnings}`. The Conductor switches on `status` → board transition (`pass`→advance, `needs_revision`→bounce, `blocking`→halt + record). Verdicts persist into `story.md` frontmatter (`reviews:`), rendered as card badges by the extension. Gating scales by `priority` (low→skip, medium→1 owning role, high/critical→both); **you** give the final go at every transition.

## 6. The conversational brain
The Conductor recognizes intents, answered via the CLI (which calls the shared engine) over the board + `context.json`.
- **`What's next?`** → ranked ready-set (priority → unblock-impact → age → `order`) + blocked list with named blockers.
- **`What's needed before X?`** → backward dependency closure: critical path, each prerequisite's column + next gate, the bottleneck.
- **`Can you add <xyz>?`** → seed a story folder, then enter the spine at grooming (brainstorming HARD-GATE).
- **Free intents:** `board health` (normalize/validate), `what's blocked and why`, `status of epic X`, `convene the party on X`.

### 6.5 Dependency graph
Computed from each story's first-class `dependsOn` list. Provides ready-set, transitive closure, critical path, and **cycle detection** — all in the TS engine, **cycle-safe** (the critical-path walk carries a visited-set and memoizes, so a cyclic board reports the cycle instead of hanging). Computed on demand; optionally cached in `.kanban/context.json` (regenerable).

## 7. The lifecycle (conducting, with your gates)
`▣ = YOU approve` · `◆ = role gate (priority-scaled)`. Spine skills invoked unchanged; artifacts written *inside the story folder*.
```
backlog:  PA seeds <id>/ → PO grooms → superpowers-backlog brainstorming (HARD-GATE) → <id>/spec.md
          ▣ approve spec ─────────────────────────────────────────────► todo
todo:     superpowers-todo writing-plans → <id>/plan.md
          ◆ Architect + Critic review plan   ▣ approve plan ───────────► in-progress
in-progress: superpowers-in-progress: worktree + TDD; handoff baton in story.md; session id appended to audit.jsonl
review:   superpowers-review: verification (real output)
          ◆ Security + code-reviewer + QA (QA needs /visual-walkthrough)   ▣ final go ─► done
done:     superpowers-done: seal story.md, merge/PR; curated learning extraction
```
`blocking` verdict → halt, append `## Review Feedback Tasks` to `story.md`, bounce back. Round-table summonable at any gate.

## 8. Cross-cutting capabilities
- **8.1 Normalize / validate** — validate `story.md` frontmatter against the schema; detect dependency cycles, missing `dependsOn` targets, zombie stories (>90d). (No legacy drift to reconcile — clean schema from the start.)
- **8.2 Shared context cache** — `.kanban/context.json` (architecture snapshot, relevant files, prior decisions) injected into role prompts via `promptBuilder.ts` templating.
- **8.3 Curated self-learning** — on `done`, extract a skill only if high-confidence + reusable + novel (dedup-checked).
### 8.4 Story ⇄ session linking + audit capture (the PA's session role)
The PA's job re: sessions is **linking and audit capture** — not reading or rendering. **Session-reading lives in the Backlog MCP** (its sessions domain, §5.2 of its spec); the **Board renders** the live layer, and the PA reads normalized `Session`s from the MCP when it needs them. The PA does not parse transcripts.

- **Linking (#16):** when the PA launches an agent for a story it **captures the new session id** (the JSONL filename) and records it on the work item (written via the MCP `native` adapter). Sessions also correlate by the `story/<id>` branch/worktree; loose sessions can be linked or **promoted to a story** manually.
- **Audit capture:** at each lifecycle move the PA appends `{ts, session, transition}` to the story's audit log. The richer per-story **trace/report** (tools, diffs, model, tokens via `session-report`) is the Board's / deferred.
- Recorded session ids are just data on the work item; the Board reads them + the transcripts to render the live layer.

### 8.5 Framework-agnostic work items (Backlog MCP)
The PA engine doesn't read planning files directly — it consumes **normalized `WorkItem`s from a standalone Backlog MCP** (see `.kanban/specs/2026-06-06-backlog-mcp-design.md`). Adapters normalize Superpowers / BMAD / GitHub Issues / markdown / our `native` per-story-folder format; foreign frameworks are **read-only**, with PA state kept in an overlay keyed by normalized id. This makes the PA framework-agnostic and *smaller* (no format coupling), and — being MCP — gives the Conductor a standard connection (resolving §14 q2). The **Conductor uses the MCP over the protocol** — only *usage instructions* in its skill, no shared code/types (the tool schemas are the contract); the **board imports the same package as a library**. The MCP also serves objective **graph queries** (ready-set, deps, cycles) so neither consumer reimplements them; only the PA's *opinionated* ranking + lifecycle gates are PA-side.

## 9. Install & packaging
- **Conductor skill + role agents → global `~/.claude/`** (project-agnostic; scaffolds `.kanban/` where missing).
- **Work-item normalization + graph → the Backlog MCP** (`packages/backlog-mcp`); **board UI → the Kanban Board** extension (its spec). The Conductor reaches planning data **over MCP** (no CLI-path hack); it needs only usage instructions, nothing compiled.
- **Dogfood in this repo** (the canonical board + extension).

### 9.1 Where the non-PA work lives
- **Board/UI** (FeatureRepository → MCP-library client, Ready lane, dependency arrows, session live-layer, badges) → the **Kanban Board** product (`2026-06-06-kanban-board-design.md`).
- **On-disk format** (per-story folders, first-class schema, flat→folder migration) → the **Backlog MCP** `native` adapter (`2026-06-06-backlog-mcp-design.md`).
- **The PA itself** ships as a global skill + role agents (§9).

## 10. Data model (owned elsewhere)
The PA consumes normalized `WorkItem`s and writes via the MCP `native` adapter; it does **not** own the on-disk format. The per-story-folder layout (`.kanban/features/<id>/` with `story.md` + `spec.md`/`plan.md`/`audit.jsonl`/`artifacts/`) and the first-class schema (`dependsOn`, `sessions`, `reviews`, `handoff`) live in the **Backlog MCP** spec (`native` adapter). The PA reads/writes them only through `WorkItem`s.

## 11. Non-goals (YAGNI)
- No second state ledger — the story folder is the only source of truth; the dependency graph is computed, not persisted.
- No 15-agent roster; no always-on DevOps/UX.
- No autonomous no-gate execution.
- No story points / velocity / burndown / sprint objects.
- The session **live layer** is the **Kanban Board** product, not the PA; the PA only records links + appends audit entries. Deep audit **reporting** is deferred.
- No new MCP servers or external services.

## 12. Build order (PA only — Board & MCP have their own)
The PA depends on the Backlog MCP existing first.
1. **Conductor skill** — connect to the Backlog MCP; the 3 intents (what's next / before X / add) over the MCP's items + graph; scaffolding.
2. **Role party** — uniform contract + author Architect/Critic/Security + adapt PO/QA + the gated lifecycle (complexity scaling, round-table).
3. **Linking + audit capture** — record story↔session ids at launch; append audit entries at transitions.
4. **Curated learning** on done.

(Backlog MCP build order → its spec; Kanban Board build order → its spec.)

## 13. Testing strategy (PA)
- **Role agents** — behavioral dogfood; assert the uniform contract; a `blocking` verdict bounces the card back.
- **Conductor intents** — against a fixture board served by the Backlog MCP: what's-next ranking, before-X path, add-seeding.
- **Linking/audit capture** — session id recorded at launch; audit entries appended at transitions.
- **Per repo policy** — any behavioral/UI step requires **`/visual-walkthrough` evidence** before done.
(Engine/graph tests live in the Backlog MCP spec; board-rendering tests in the Kanban Board spec.)

## 14. Open questions / risks
1. **Flat→folder migration** (lossless/reversible; existing `.kanban/specs|plans` move into story folders) is owned by the **Backlog MCP** `native` adapter — see its spec. Coordinate the cutover with the Board (which stops reading raw files).
2. **Engine reach from the global skill — RESOLVED via MCP.** Planning **and sessions** are served by the **Backlog MCP**; the Conductor connects over MCP the standard way — no `dist/pa-cli.js` path-discovery hack. (A thin CLI may still exist for non-MCP callers, but it's no longer the primary reach.)
3. **Session UUID capture — RESOLVED.** Session id = the JSONL transcript filename in `~/.claude/projects/<proj>/<uuid>.jsonl` (each line also carries `sessionId`); launch-capture + the branch/worktree watcher bind it to a story. **New risks from the borrowed engine:** normalize `message.content` polymorphism (string|object|array); cwd→dir encoding is lossy (map forward only); `isActive` is a pure time-window (gate on new content); status heuristics are English-keyword-fragile. **Linking edge cases:** pre-branch grooming sessions rely on launch-capture; work on `main`/a shared branch needs manual link; a worktree reused across stories must disambiguate.
4. **`order` fractional-indexing** remains the sole prioritization primitive for continuous flow; confirm scheduler ranking composes sensibly with manual drag order.
