# Design: Product Architect (PA) Orchestrator

**Date:** 2026-06-06
**Status:** spec — pending user review
**Topic:** A conversational orchestrator role that drives the full agile lifecycle on top of the Kanban board, conducting a party of role specialists and the Superpowers per-story spine, while keeping the user in the loop at every gate.

---

## 1. Vision

The **Product Architect (PA)** is a conversational orchestrator you talk to in Claude Code. It fuses a Product Owner, a Software Architect, and "all levels of the dev team" into one role you can ask:

- **"What's next?"**
- **"What do we need before feature X lands?"**
- **"Can you add this xyz feature?"**

It brainstorms requirements with you, produces a spec, has a plan written, has role-specific agents review it, and then drives the work — all via subagents in a "party," BMAD-style, built on the Superpowers toolset, with the **Kanban board as the live source of truth and dashboard**.

The PA is **not a new workflow engine**. It is the missing *breadth* layer on top of Superpowers' world-class *depth* engine: portfolio awareness, a dependency graph, a role party, and lifecycle conducting.

## 2. Decisions locked (during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Form factor | Hybrid — build the orchestration layer now; keep clean seams to surface it as a VS Code extension chat panel later |
| 2 | Party stack | Compose a **custom** party, informed by a deep analysis of gem-team + Superpowers (best of each) |
| 3 | Party mode | **Gated pipeline by default + on-demand round-table** ("convene the party on X") |
| 4 | Autonomy dial | **Checkpoint at every column transition** — PA works within a stage, stops for explicit go/no-go at each transition |
| 5 | Core roster | **5 roles + Conductor** (Product Owner, Architect, Critic, Security, QA); UX/Designer + DevOps are optional, summoned on demand |
| 6 | Implementer | **The TDD spine is the dev**; `fullstack-developer` subagent only for independent parallel tasks |
| 7 | Sprints | **Continuous flow** — "sprint" = current ordered focus set (existing `order` field); no sprint objects, no story points, no burndown |
| 8 | Self-learning | **Curated, gated skill extraction on `done`** (high-confidence + reusable + novel, dedup-checked) + durable decisions → `context.json` |
| 9 | Standup | **Reactive** — briefs on request only; no SessionStart hook, no automatic token spend |
| 10 | Install scope | **Global** (`~/.claude/`), project-agnostic; scaffolds `.kanban/` in projects that lack one; dogfooded in this repo |

## 3. Best-of-both analysis (the foundation)

### 3.1 Superpowers — the depth engine we keep intact

The Superpowers lifecycle skills (`superpowers-backlog/todo/in-progress/review/done`) already live in this repo's `.claude/skills/` and already read `.kanban/instructions.md`. They give bulletproof per-story rigor and map **1:1 to the board columns**:

```
backlog → todo → in-progress → review → done
   │         │         │          │        │
brainstorm  writing-  worktree +  verify + seal +
→ spec      plans     TDD spine   review   merge + archive
(HARD-GATE) (plan)    (build)     (gates)  (learnings)
```

Load-bearing patterns the PA preserves unchanged:
- **Brainstorming HARD-GATE** — no code until a design is presented and explicitly approved.
- **TDD Iron Law** — no production code without a failing test first; watch it fail.
- **Evidence before assertions** — `verification-before-completion`: run the command, paste the output; "agent said success" never counts.
- **Never review your own work** — reviews run as fresh subagents with curated context.
- **Worktree-per-story isolation** — branch `story/<id>`, created once, recorded in frontmatter.
- **Column transition = explicit invocation = human gate.**

### 3.2 Where Superpowers is thin — exactly the PA's job

| Superpowers gap | Blocks which question | PA adds |
|---|---|---|
| No portfolio / "what's next" view (each skill takes one story ID you hand it) | **"What's next?"** | Board-wide scheduler (priority + deps + age + order) |
| `blockedBy` is advisory text, never parsed | **"What's needed before X?"** | A real dependency graph (ready-set, critical path, cycle detection) |
| No roles — one faceless generalist | "party-mode like BMAD" | A party of role specialists, each owning a gate |
| No epic rollup, no schema validation, no multi-role sign-off | sprint/project management | Epic rollups, normalize/validate, multi-role gating |

### 3.3 gem-team — the patterns we steal (adapted to the board)

| Pattern (source) | How the PA uses it |
|---|---|
| **Uniform agent return contract** (`gem-*.agent.md`) | Every role subagent returns the same `{status, confidence, findings, learnings}`; `status` drives the board transition. Highest-ROI steal. |
| **Plan-gate ≠ code-gate; never self-review** (`gem-critic` + `gem-reviewer`) | Critic kills bad *plans* before code (at `todo→in-progress`); Security/Reviewer gate *code* before `done`. |
| **Complexity-scaled gating** (`gem-orchestrator` Phase 2) | Drive off existing `priority`: low → skip role review, medium → one owning role, high/critical → both must clear. |
| **Shared context cache** (`context_envelope.json`) | One `.kanban/context.json` (architecture snapshot + relevant files + prior decisions), injected into every role prompt via the existing `promptBuilder.ts` `{{...}}` templating. |
| **Typed handoffs + pre-mortem** (`gem-planner`, `gem-debugger`) | Column transitions carry a `handoff` baton (`do_not_reinvestigate`, target files, "write test Y first"); specs carry `failure_modes`. |
| **Curated self-learning** (`gem-skill-creator`) | On `done`, extract a skill only if high-confidence + reusable + novel (dedup-checked) so the library compounds without bloat. |

### 3.4 gem-team — what we deliberately reject (overkill for a personal, board-centric tool)

- The **15-agent roster** → we need ~5.
- **Autonomous no-gate wave execution** → you *want* to witness each card move (decision #4).
- **Parallel YAML/JSON/PRD state sprawl** → **the feature `.md` (frontmatter + body) is the only ledger**; no second source of truth that can drift.
- An LLM reviewer's verdict as the **final done-decision** for UI/behavioral work → your `/visual-walkthrough` policy + human go/no-go remain authoritative.

### 3.5 awesome-copilot sourcing map (what to author / adapt / reuse)

| Role / piece | Verdict | Informed by (awesome-copilot) | Have in repo |
|---|---|---|---|
| PA Conductor (skill) | **Author** | `gem-orchestrator`, `ai-team-producer` (Remy) | — |
| Product Owner | **Adapt** | `breakdown-epic-pm`, `breakdown-feature-prd`, `prd.agent` | `backlog-grooming` ✓ |
| Architect | **Author** | `api-architect`, `adr-generator`, `hlbpa`, `create-architectural-decision-record` | — |
| Critic | **Author** | `gem-critic`, `devils-advocate`, `critical-thinking` | — |
| Security | **Author** | `gem-reviewer`, `agent-owasp-compliance`, `codeql` | + `/security-review` skill |
| QA | **Adapt** | `gem-browser-tester`, `breakdown-test` | `qa-expert` ✓ + `/visual-walkthrough` |
| Code reviewer | **Reuse** | `gem-reviewer` | `code-reviewer` ✓ |
| Implementer (parallel) | **Reuse** | `gem-implementer` | `fullstack-developer` ✓ |
| Docs (optional) | **Reuse** | `gem-documentation-writer` | `documentation-engineer` ✓ |
| UX/Designer, DevOps (optional, summoned) | **Author later** | `gem-designer`, `accessibility`; `gem-devops`, `devops-expert` | — |

## 4. Architecture — three layers

```
┌──────────────────────────────────────────────────────────────────┐
│ YOU  ◄───────────── converse, approve at gates ─────────────►      │
└───────────────┬──────────────────────────────────────────────────┘
        ╔═══════▼════════════════════════════════════════╗
        ║ PA CONDUCTOR = a SKILL (runs in YOUR thread)    ║  ← the thing you talk to
        ║ • portfolio Q&A: "what's next / before X?"      ║
        ║ • dependency graph + scheduler                  ║
        ║ • seeds work, conducts the spine, summons roles ║
        ║ • normalize / validate the board                ║
        ╚═══╤════════════════════════╤═══════════════════╝
            │ invokes (unchanged)    │ dispatches at gates
   ┌────────▼──────────┐   ┌─────────▼─────────────────────────────┐
   │ SUPERPOWERS SPINE │   │ ROLE PARTY = SUBAGENTS (fresh context) │
   │ (per-story engine)│   │ PO · Architect · Critic · Security · QA│
   │ brainstorm→plan→  │   │ each returns the SAME contract         │
   │ worktree→TDD→     │   │ → status drives the board transition   │
   │ verify→review→done│   └────────────────────────────────────────┘
   └────────┬──────────┘
            │ reads & writes
   ┌────────▼───────────────────────────────────────────────────────┐
   │ THE KANBAN BOARD = THE LEDGER (one feature .md per story)          │
   │ frontmatter: status·priority·epic·order  ·  body: deps/reviews/handoff │
   │ + .kanban/context.json (shared context cache)                    │
   └─────────────────────────────────────────────────────────────────┘
```

Three load-bearing decisions in this picture:

1. **The Conductor is a *skill*, not a subagent** — it must converse with you and stop at gates, so it runs in *your* main thread. (Subagents can't talk to you. This is what makes "keep me in the loop" structural, not aspirational.)
2. **The roles are *subagents*** — fresh curated context, no session pollution, uniform contract. Matches both gem-team and Superpowers' "never review your own work."
3. **The board is the *only* ledger, one file per story** — native fields in frontmatter; PA state in the markdown body (round-trip-safe — see §10/§14.1). Specs and plans are *derived* docs; the card is truth. No parallel store to drift.

## 5. The cast

| Player | Type | Owns gate | Job |
|---|---|---|---|
| **Product Architect** (Conductor) | skill (main thread) | — (conducts all) | Portfolio Q&A, scheduling, seeds work, summons roles, normalize/validate, conducts the spine |
| **Product Owner** | subagent | `backlog → todo` | Groom idea into a testable story; acceptance-criteria sign-off (is this the *right* thing, well-defined?) |
| **Architect** | subagent | `todo → in-progress` | Review spec + plan for design soundness, simplicity, fit with the codebase; ADR if warranted |
| **Critic** | subagent | `todo → in-progress` (with Architect) | Devil's advocate: challenge assumptions, edge cases, over-engineering, YAGNI |
| **Security** | subagent | `review → done` | OWASP-ish diff pass, secrets, path-traversal (this repo's `SAFE_ID` / symlink guards); delegates to `/security-review` |
| **QA** | subagent | `review → done` (with Security) | `verification-before-completion` + **`/visual-walkthrough` evidence** for behavioral/UI work |
| code-reviewer / fullstack-developer / documentation-engineer | subagents | as needed | Code-quality pass · parallel implementer · docs |
| UX/Designer · DevOps | subagents | optional | Summoned only when a story is UI-heavy or touches infra |

### 5.1 The uniform role contract

Every role subagent returns this shape. The Conductor switches on `status`:

```yaml
role: architect
status: pass | needs_revision | blocking      # → advance / bounce-back / halt + set blockedBy
confidence: 0.0–1.0
verdict: "<one line>"
findings:
  - severity: blocking | major | minor | nit
    issue: "<what>"
    location: "file.ts:42"
    suggestion: "<fix>"
what_works: ["<always name what's good — gem-critic rule>"]
learnings:
  patterns: []
  gotchas: []
  decisions: []
```

The latest verdicts persist into the story's `## Reviews` body section (not frontmatter — see §14.1) so they survive outside the chat; a future extension can render them as badges.

## 6. The conversational brain

The Conductor recognizes **intents**, answered from the board (all frontmatter + bodies) + the dependency graph + `context.json`.

### 6.1 `What's next?`
Rank the **ready set** (stories whose `blockedBy` are all `done`) by: `priority` → unblock-impact (how many others it frees) → age → `order`.
```
You: what's next?
PA:  3 stories READY (blockers clear), ranked:
     1. ●high  live-dependency-arrows      unblocks 2 others · ready 4d
     2. ●med   epic-filter-persistence     quick win · same epic you just shipped
     3. ○low   tooltip-copy-polish         trivial
     ⚠ 2 BLOCKED: agent-badge-x (waits on #1), bulk-move-undo (waits on plan approval)
     Start #1? I'll have the Product Owner groom it, then brainstorm the spec with you.
```

### 6.2 `What's needed before feature X lands?`
Walk the dependency graph backward from X (transitive `blockedBy` closure); show the critical path and each prerequisite's column + next gate.
```
You: what do we need before live-dependency-arrows lands?
PA:  Critical path — 4 prerequisites, longest chain 3 deep:
     ✓ blockedby-frontmatter-parse   done
     ✓ dependency-graph-compute      done
     ◑ ready-lane-ui                 in-progress → next gate: Security+QA review
     ○ arrow-render-canvas           todo → plan NOT yet approved   ← bottleneck
     → live-dependency-arrows        backlog → not groomed
     Everything hinges on arrow-render-canvas. Push its plan to you for approval?
```

### 6.3 `Can you add <xyz>?`
Seed a backlog card (id + frontmatter + stub body), then enter the spine at grooming with the brainstorming HARD-GATE intact.
```
You: can you add a "snooze story until date" feature?
PA:  Seeded backlog card snooze-story-until-date. Product Owner is drafting acceptance
     criteria; then I'll brainstorm the spec with you. No code until you approve the design.
```

### 6.4 Free intents
`board health` (normalize/validate — drift, zombies, cycles), `what's blocked and why`, `status of epic X`, `convene the party on X` (round-table).

### 6.5 Dependency graph
Built by parsing each story's `## Dependencies` body section (lists blocking ids) across the board. Provides: ready-set, transitive closure, critical path, **cycle detection** (gem-planner's "no circular deps"). Body storage round-trips losslessly; frontmatter does not for arrays (§14.1). The graph is *computed on demand* (optionally cached in `.kanban/context.json`, regenerable), so there is no separate authoritative store to drift.

## 7. The lifecycle (conducting, with your gates)

`▣ = YOU approve` (decision #4). `◆ = role gate` (subagents, complexity-scaled by `priority`). Spine skills invoked unchanged.

```
backlog:
  PA seeds card → Product Owner grooms acceptance criteria
  → superpowers-backlog runs brainstorming (HARD-GATE) → spec to .kanban/specs/
  ▣ YOU approve the spec ───────────────────────────────────────────► todo
todo:
  → superpowers-todo runs writing-plans → plan to .kanban/plans/
  ◆ Architect + Critic review the plan   (low→skip · med→1 · high→both)
  ▣ YOU approve the plan ──────────────────────────────────────────► in-progress
in-progress:
  → superpowers-in-progress: worktree + TDD spine builds it
    (fullstack-developer subagents only for independent parallel tasks)
    handoff baton carried in frontmatter (do_not_reinvestigate, target_files, notes)
review:
  → superpowers-review: verification-before-completion (real command output)
  ◆ Security + code-reviewer + QA   (QA requires /visual-walkthrough for behavioral/UI)
  ▣ YOU give final go ─────────────────────────────────────────────► done
done:
  → superpowers-done: seal frontmatter, merge/PR, move to done/
  → curated learning extraction (high-confidence + novel only) + context.json update
```

Behaviors:
- **`blocking` verdict from an owning role** → transition halts; PA appends a `## Review Feedback Tasks` section and bounces the card back (the `superpowers-review` pattern), optionally setting `blockedBy`.
- **Round-table on demand** — *"convene the party on X"* makes the relevant roles debate in one thread instead of returning silent verdicts.
- **Complexity scaling** — `priority` decides how many owning roles must clear a `◆` gate; **you** still give the final `▣` go regardless.

## 8. Cross-cutting capabilities

### 8.1 Normalize / validate
Runs before scheduling and on `board health`. Reconciles the schema drift found during analysis:
- `worktree` vs `workspace` field naming.
- `status: completed` (written by `superpowers-done`) vs the board enum `done`.
- Spec/plan location: **standardize on `.kanban/specs/` + `.kanban/plans/`** per CLAUDE.md (authoritative over the stale `docs/superpowers/` paths still referenced in `instructions.md`).
- Validate frontmatter against the declared schema; report (and offer to fix) violations, zombie cards (>90 days no action), and dependency cycles.

### 8.2 Shared context cache
`.kanban/context.json`: architecture snapshot, relevant-files shortlist, prior decisions (with evidence paths). Injected into every role prompt via `promptBuilder.ts` `{{context}}` templating so agents stop re-discovering the codebase. Updated on `done`.

### 8.3 Curated self-learning
On `done`, if a recorded learning is **high-confidence + reusable (a procedure, not an instance) + novel** (dedup-checked against existing skills): author a skill. Durable decisions flow to `context.json`; recurring conventions can be proposed for CLAUDE.md (approval-gated). This re-enables the learning step currently disabled in the local `superpowers-done`.

## 9. Install & packaging (global)

Authored to `~/.claude/` (decision #10), project-agnostic:

```
~/.claude/
  skills/
    product-architect/
      SKILL.md                 ← Conductor: intents, scheduler, dependency graph, conducting, normalize
      references/
        scheduler.md           ← ranking rules (ready-set · priority · unblock-impact · age · order)
        contract.md            ← the uniform role return contract
        gates.md               ← which role owns which gate + complexity scaling
    superpowers-backlog/        ┐
    superpowers-todo/           │  promoted from this repo's project-local .claude/skills/
    superpowers-in-progress/    │  so the spine travels with the global PA
    superpowers-review/         │  (the Superpowers BASE plugin is already global)
    superpowers-done/           ┘
  agents/
    pa-architect.md  pa-critic.md  pa-security.md       ← NEW
    pa-product-owner.md (adapt backlog-grooming)  pa-qa.md (adapt qa-expert)
    (reuse) code-reviewer.md · fullstack-developer.md · documentation-engineer.md

per-project (PA scaffolds if absent):
  .kanban/
    features/ … (the board)        instructions.md (board conventions + schema)
    context.json (shared cache)
```

- **Project-agnostic Conductor** — reads whatever `.kanban/` board exists in the current workspace. In a project with no board, it offers to **scaffold** `.kanban/` + `instructions.md` + `context.json`.
- **Lifecycle skills promoted to global** — they must travel with the PA; ensure they carry no project-specific assumptions (audit during the move).
- **Dogfood in this repo** — the one place with a real board + spine; primary test bed despite the global install.

### 9.1 Extension seams (hybrid — layer first)
Clean contracts so a future extension chat panel reuses this logic with no rework:
- **Scheduler + dependency graph** = pure function of frontmatter → lift into `src/extension/` TS later to drive a "Ready" lane, dependency arrows, a "what's next" panel.
- **Role verdicts** persist into the `## Reviews` body section → render as card badges later.
- **Dependencies** live in the story body now (round-trip-safe) → promote to a first-class `blockedBy` field + dependency-arrow UI later, once the extension round-trips losslessly (§14.1).
- **Intents** = named/documented → expose as extension buttons/commands later.

## 10. PA state storage — markdown body sections (not frontmatter)

**Decision (2026-06-06):** the extension's frontmatter round-trip is lossy for arrays/maps (§14.1) and we chose **not** to add extension code now, so the PA's structured state lives in **dedicated sections of each story's markdown body** — which round-trips losslessly (`content` is preserved verbatim by `parseFeatureFile`/`serializeFeature`) and travels with the card (no separate store to drift). This is consistent with how the Superpowers spine already writes the body (acceptance criteria, `## Review Feedback Tasks`). Example sections:

```md
## Dependencies
blockedBy:
- other-story-id
- another-story-id

## Reviews
- architect: pass        (2026-06-06)
- security: blocking      (2026-06-06) — secrets in diff

## Handoff
do_not_reinvestigate: root cause confirmed in X
target_files: src/foo.ts, src/bar.ts
notes: write the failing test for the null case first
```

- Native frontmatter (`status`, `priority`, `epic`, `order`, `assignee`, `labels`, `worktree`) stays in frontmatter — extension-owned, round-trips fine.
- The board-level **dependency graph** is *computed* by scanning every story's `## Dependencies` section; not separately persisted (optionally cached in `.kanban/context.json`, regenerable).
- **Upgrade path:** if we later make `_extraFrontmatter` lossless or promote `blockedBy` to a first-class field, these migrate into frontmatter (the seam in §9.1).
- **Alternative considered & rejected as default:** JSON sidecars (`.kanban/state/<id>.json` / a global `graph.json`) — a separate file can drift from the board and isn't visible in the card; body sections keep one file per story. Easy to switch if preferred.

## 11. Non-goals (YAGNI)

- No second state ledger — the feature `.md` (frontmatter + body) is the only source of truth; the dependency graph is computed, not persisted.
- No 15-agent roster; no always-on DevOps/UX.
- No autonomous no-gate execution.
- No story points / velocity / burndown / sprint objects.
- No extension UI today (only the seams in §9.1).
- No new MCP servers or external services.

## 12. Build order (decomposes into ~3 implementation plans)

1. **Body-section schema + normalize/validate** — define & parse the `## Dependencies`/`## Reviews`/`## Handoff` body sections, reconcile drift, extend `instructions.md`. (Foundation.)
2. **Conductor brain** — board read + dependency graph + scheduler + the 3 intents. *First plan; testable on day one, delivers "what's next" immediately.*
3. **Role party** — uniform contract + author Architect/Critic/Security + adapt PO/QA.
4. **Conducting** — wire roles into the lifecycle gates + complexity scaling + round-table.
5. **Curated learning** on `done` + `context.json`.

(1)+(2) form a coherent, independently valuable first plan (the portfolio brain). (3)+(4) the party. (5) the learning loop.

## 13. Testing strategy

- **Scheduler + dependency graph** — unit-testable pure logic against fixture boards: ready-set correctness, critical-path computation, cycle detection, ranking order. This is the most testable surface; build it as a small module with fixtures.
- **Body-section parser** — round-trip test: write `## Dependencies`/`## Reviews`/`## Handoff`, parse back, assert structure preserved; simulate an extension parse→serialize cycle and confirm the body survives intact.
- **Normalize/validate** — test against the known drift fixtures (`worktree`/`workspace`, `completed`/`done`, dir reconciliation).
- **Role agents** — behavioral: dogfood on real stories in this repo; assert each returns a well-formed uniform contract; assert a `blocking` verdict bounces the card back and appends `## Review Feedback Tasks`.
- **Lifecycle conducting** — drive one real story end-to-end in this repo; verify each `▣` gate stops and each `◆` gate scales by `priority`.
- **Per repo policy** — any behavioral/UI verification step requires `/visual-walkthrough` evidence attached before it is marked done.

## 14. Open questions / assumptions to verify

1. **[VERIFIED 2026-06-06 — assumption is FALSE for structured fields]** `_extraFrontmatter` round-trips unknown fields *lossily*: `src/shared/featureFrontmatter.ts:40` coerces every unknown value with `String(val)`. On the next extension re-serialize (any card mutation via the board UI), a YAML **array** `blockedBy: ["a","b"]` collapses to the string `"a,b"`, and a **map** (`reviews`, `handoff`) becomes `"[object Object]"` — total loss. Only scalar unknown fields survive. **Implication:** the structured fields in §10 are NOT safe with the current extension. Resolved by the *round-trip storage decision*: (a) make `_extraFrontmatter` lossless — small fix to `featureFrontmatter.ts` to preserve arbitrary YAML and serialize it faithfully (benefits all custom schemas, e.g. `superpowers`); (b) keep PA state in a sidecar/body, not frontmatter; or (c) flatten to round-trip-safe scalars. **[RESOLVED 2026-06-06 → chose (b): store PA state in markdown body sections (§10); no extension code now. Option (a), lossless `_extraFrontmatter`, is the documented upgrade path and a fix for the latent custom-schema data-loss bug — flagged separately.]**
2. **Promoting lifecycle skills to global** must not break their project-local assumptions (they read `.kanban/instructions.md` relative to the workspace — confirm that resolves correctly from a global install).
3. **Reading large boards** via Glob+Read is fine initially; a small read-only board-dump helper script is a deferred performance nicety.
4. **`order` fractional-indexing** is the sole prioritization primitive for "continuous flow" — confirm the scheduler's age/priority ranking composes sensibly with manually dragged `order`.
