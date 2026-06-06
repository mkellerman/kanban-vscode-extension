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
| 1 | Form factor | **PA-native**: a global Conductor skill + role subagents, *and* the VS Code extension evolved to render the PA model. Not layer-only — extension code is in scope. |
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
| 13 | Engine location | Schema + board reader + dependency graph + scheduler + validate, **plus the session-reading engine (borrowed from claudine, MIT)**, live **once in `src/shared/` (TS)**, used by the board UI and exposed to the skill via a thin CLI. One parser, typed, vitest-tested. |
| 14 | Auditability & sessions | **Elevated to a core feature.** Each story links its Claude **session(s)**; a live session layer shows activity on cards; we capture `model` + token `usage` (which claudine omits). Full audit *reporting* phases later. |
| 15 | Unified board | One board, two card types: **story cards** (intent, gated lifecycle) primary, each with a **live session layer**, + a **Sessions side-lane** for loose sessions (link / promote-to-story). |
| 16 | Session linking | Auto by `story/<id>` branch/worktree + launch-time capture + manual link/promote. |
| 17 | Build on | **Own extension** (React, story-first) + **borrow claudine's MIT session engine** (attributed), extended with model/token capture. Not a fork. |

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

### 3.6 claudine — the borrowed session engine (MIT)
`salam/claudine` (MIT) is a VS Code kanban of Claude/Codex *sessions*; we borrow its JSONL-reading technique for our session layer (§8.4), **not** its product (its card = a session; ours = a story). Reusable fields per JSONL line: `type`, `uuid`, `parentUuid`, `timestamp`, `isSidechain`, `gitBranch`, `message.role`, `content[]` (`text`/`tool_use`/`tool_result`), `toolUseResult.interrupted`, `worktreeSession` — **plus `message.model` + `message.usage`, which claudine ignores and we capture** for the audit layer. Borrowed gotchas: `content` may be string|object|array (normalize); cwd→dir encoding is lossy (map forward only); `isActive` is a pure 2-min window (gate on new content before reacting); status/needs-input heuristics are English-keyword-fragile.

## 4. Architecture — four layers

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

Load-bearing decisions:
1. **Conductor is a skill** (your thread — it converses and gates). **Roles are subagents** (fresh context, uniform contract, never self-review).
2. **One engine in `src/shared/` (TS)** is the single source of truth for schema + graph + scheduler, used by *both* the board UI and the skill's CLI — no duplicate parsers.
3. **The per-story folder is the only ledger.** Spec/plan/audit live *inside* the story folder; nothing is smeared across sibling directories.
4. **The board unifies intent + execution.** Story cards (the lifecycle) carry a live session layer read by the shared session engine; a Sessions side-lane holds loose sessions. Story columns stay human-gated; session activity is advisory.

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
### 8.4 Sessions — the live execution layer (story ⇄ session)
The board unifies **intent** (story cards) and **execution** (Claude sessions), linked. Borrows claudine's JSONL technique (MIT, §3.6) and extends it.

- **Session-reading engine** (in `src/shared/`, ported/adapted from claudine's `ConversationParser`, MIT-attributed): incremental **tail-parse** of `~/.claude/projects/<proj>/<uuid>.jsonl` — cache a byte-offset, read only appended bytes; LRU; shrink-detection — so huge transcripts stay cheap on every watcher fire. Extracts per session: last tool activity (`Read "x.ts"`), active/idle (2-min window), needs-input / error / interruption / rate-limit signals, sidechain (subagent) steps, git branch, worktree — **plus `model` + token `usage`, which claudine discards** (our audit gold).
- **Linking (#16):** a session auto-links when its `gitBranch`/cwd matches the story's `story/<id>` branch/worktree; the PA also captures the session it launches for a story (covers pre-branch grooming/planning); loose sessions can be linked or **promoted to a story** manually. Session id = the JSONL filename (resolves §14 q3).
- **Live layer on the story card:** session count, active dot + timer, last tool, a `needs-input` badge surfaced from the session, aggregate `model`/tokens; expandable to a per-session audit timeline. **Advisory only** — session activity never auto-moves the story's column (#4 stands); it surfaces attention (a `needs-input` session can list its story in a "needs attention" view).
- **Sessions side-lane:** loose, auto-discovered sessions (no linked story) with one-click **link** or **promote-to-story** (turn ad-hoc work into a tracked, auditable story).
- **Audit trail:** `<id>/audit.jsonl` appends `{ts, session, transition, model, tokens}` at each lifecycle move. Full **reporting** (per-story trace via the existing `session-report` skill + an extension audit view) phases later (§12).

## 9. Install & packaging
- **Conductor skill + role agents → global `~/.claude/`** (project-agnostic; scaffolds `.kanban/` where missing).
- **Engine + CLI + board UI → the extension** (`src/shared/`, `src/cli/`, `src/extension/`, `src/webview/`) — versioned in this repo, shipped in the `.vsix` the user already installs across projects. The skill calls the built CLI (`node dist/pa-cli.js <cmd>`), so there is no separate global script and no duplicate parser.
- **Dogfood in this repo** (the canonical board + extension).

### 9.1 Extension work (now in scope)
- **`FeatureRepository`**: read **per-story folders** (`<id>/story.md`) instead of flat `<id>.md`; treat `spec.md`/`plan.md`/`audit.jsonl` as story-scoped artifacts. Migration: a one-time converter from flat `.md` → folder.
- **Schema**: add `dependsOn`, `sessions`, `reviews`, `handoff` as first-class fields (parsed/serialized losslessly — no `_extraFrontmatter` path for these).
- **Board UI** (`src/webview/`): a **Ready lane** (engine's ready-set), **dependency arrows** between cards, and a **session/audit badge** (count of linked sessions; full audit view deferred).
- **CLI** (`src/cli/pa.ts` → `dist/pa-cli.js`): `whats-next`, `before <id>`, `health`, `dump`, `seed <title>` — thin wrappers over the shared engine.

## 10. Data model — per-story folder + clean schema
```
.kanban/features/<id>/
  story.md        # frontmatter below + body (title, acceptance criteria, context, review-feedback)
  spec.md         # the design (was .kanban/specs/…)
  plan.md         # the implementation plan (was .kanban/plans/…)
  audit.jsonl     # append-only: {ts, session, transition, model}
  artifacts/      # screenshots, walkthroughs, generated files
```
`story.md` frontmatter (all first-class, typed, lossless):
```yaml
id: "snooze-2026-06-06"
status: "todo"            # backlog | todo | in-progress | review | done
priority: "high"          # critical | high | medium | low
epic: null
order: "a0"               # fractional index (drag order)
dependsOn: ["other-id"]   # dependency edges — first-class list
sessions: ["d75cfc06-…"]  # Claude session UUIDs that worked this story
reviews: { architect: pass, security: blocking }
handoff: { do_not_reinvestigate: [...], target_files: [...], notes: "…" }
created: "…" · modified: "…" · completedAt: null · assignee: null · labels: []
```
Done stories: move the whole `<id>/` folder to `.kanban/features/done/<id>/`.

## 11. Non-goals (YAGNI)
- No second state ledger — the story folder is the only source of truth; the dependency graph is computed, not persisted.
- No 15-agent roster; no always-on DevOps/UX.
- No autonomous no-gate execution.
- No story points / velocity / burndown / sprint objects.
- The session **live layer** is in scope (build slice 3); only the deeper audit **reporting** (per-story trace via `session-report` + audit view) is deferred to slice 6.
- No new MCP servers or external services.

## 12. Build order (~6 plans)
1. **Core engine + schema + per-story folders (extension)** — `src/shared/` schema + folder-aware reader + dependency graph (cycle-safe critical path) + scheduler + validate; `FeatureRepository` reads folders; flat→folder migration; vitest. *Foundation.*
2. **CLI + Conductor skill** — `dist/pa-cli.js` + the global skill: the 3 intents + scaffolding. *Delivers "what's next."*
3. **Session layer (elevated)** — port claudine's tail-parse session-reading engine into `src/shared/` (MIT-attributed, + model/token capture); story⇄session linking (branch/worktree + launch capture); the live layer on story cards; the Sessions side-lane + promote-to-story.
4. **Board UI polish** — Ready lane + dependency arrows (the planning visuals).
5. **Role party** — uniform contract + author Architect/Critic/Security + adapt PO/QA + gates.
6. **Audit reporting + curated learning** — per-story trace via `session-report` + extension audit view; skill extraction on done.

(1)+(2) = the portfolio brain. (3) = the session/execution layer (the part you're most excited about). (4)+(5) = planning visuals + the party. (6) = audit reporting + learning.

## 13. Testing strategy
- **Engine (vitest, the bulk)** — pure functions over fixture boards: ready-set, ranking order, transitive closure, **cycle-safe critical path (must terminate on a cyclic fixture)**, validate. One parser → one set of parser tests.
- **FeatureRepository** — reads per-story folders; flat→folder migration is idempotent and lossless.
- **CLI** — smoke tests per command against a temp board.
- **Role agents** — behavioral dogfood; assert uniform contract; `blocking` bounces the card back.
- **Board UI** — any behavioral/UI step requires **`/visual-walkthrough` evidence** before done (repo policy).

## 14. Open questions / risks
1. **Flat→folder migration** must be lossless and reversible; existing `.kanban/specs|plans` move *into* the relevant story folders (or stay as historical docs if not tied to a live story). Plan the mapping carefully.
2. **CLI availability to the global skill** — the skill calls `node dist/pa-cli.js`; confirm the path resolution from an arbitrary project (the extension is installed globally, but its `dist/` lives in the VSIX install dir — the skill must locate it, e.g. via a known path or a tiny shim).
3. **Session UUID capture — RESOLVED.** Session id = the JSONL transcript filename in `~/.claude/projects/<proj>/<uuid>.jsonl` (each line also carries `sessionId`); launch-capture + the branch/worktree watcher bind it to a story. **New risks from the borrowed engine:** normalize `message.content` polymorphism (string|object|array); cwd→dir encoding is lossy (map forward only); `isActive` is a pure time-window (gate on new content); status heuristics are English-keyword-fragile. **Linking edge cases:** pre-branch grooming sessions rely on launch-capture; work on `main`/a shared branch needs manual link; a worktree reused across stories must disambiguate.
4. **`order` fractional-indexing** remains the sole prioritization primitive for continuous flow; confirm scheduler ranking composes sensibly with manual drag order.
