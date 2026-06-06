# Product Architect — Conductor (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). The PA is a skill + reasoning (not a TS package), so verification here is **behavioral dogfood** against the stub MCP, plus TDD for any helper code. Run in a worktree.

**Goal:** A global **Conductor skill** that connects to the **Backlog MCP** and answers the three intents — *what's next*, *what's needed before X*, *add `<feature>`* — applying the PA's **opinionated ranking** (the MCP gives the objective graph; the PA ranks/decides).

**Architecture:** The PA is product #2 — a skill + role agents in `~/.claude/`, source-controlled at `packages/product-architect/`. It is a pure **MCP client**: it calls the Backlog MCP tools (`list_work_items`, `dependency_graph`, `list_sessions`, …) and needs only *usage instructions*, no shared code. The opinionated "what's next" ranking lives in the skill's documented rules.

**Specs:** `.kanban/specs/2026-06-06-product-architect-orchestrator-design.md` (§6 intents, §5 cast). **Contract:** the Backlog MCP tool surface (consume over MCP). **Depends on:** the Backlog MCP server (the stub is enough — it serves a real graph over fixtures).

**Out of scope (later slices):** the role party (Architect/Critic/Security/QA) + gated lifecycle, story↔session link capture at launch, curated learning. This slice is the **read-only portfolio brain**.

---

## File structure
- Create: `packages/product-architect/skill/SKILL.md` — the Conductor
- Create: `packages/product-architect/skill/references/ranking.md` — the opinionated "what's next" rules
- Create: `packages/product-architect/skill/references/mcp-usage.md` — which MCP tools, when
- Create: `packages/product-architect/INSTALL.md` — deploy to `~/.claude/skills/`
- Create/modify: `.mcp.json` (repo root) — register the Backlog MCP stub so a session can call it

---

## Task 1: Register the Backlog MCP for the session

- [ ] **Step 1:** Create `.mcp.json` at the repo root registering the stub server:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "pnpm",
      "args": ["-F", "@kanban/backlog-mcp", "exec", "tsx", "src/server.ts"],
      "env": { "PA_BOARD_ROOT": "${workspaceFolder}" }
    }
  }
}
```

- [ ] **Step 2: Verify** the tools are reachable: in a fresh Claude Code session in this repo, confirm the `backlog` MCP server connects and lists the 7 tools (`detect_frameworks`, `list_work_items`, `get_work_item`, `get_item_body`, `dependency_graph`, `list_sessions`, `get_session`). *(Evidence: paste the tool list.)*
- [ ] **Step 3: Commit** — `git commit -am "chore(pa): register backlog MCP (.mcp.json)"`

---

## Task 2: The ranking rules (the one opinionated, documented bit)

**Files:** Create `packages/product-architect/skill/references/ranking.md`

- [ ] **Step 1: Write it**

```markdown
# "What's next" ranking (PA-opinionated)

Source the **ready set** from the MCP: `dependency_graph().readySet` (ids whose deps are all done,
status backlog/todo). Fetch their `WorkItem`s via `list_work_items`. Rank by, in order:

1. **priority** — critical > high > medium > low (null = lowest)
2. **unblock-impact** — how many items list this one in `dependsOn` (more = earlier)
3. **age** — older first (don't let things rot) — use `created` if present
4. **order** — the native fractional-index drag order (tie-breaker)

Present the top N with a one-line reason each, then the BLOCKED list (`dependency_graph().blocked`)
naming each item's `waitingOn`. Never invent items — quote the MCP.
```

- [ ] **Step 2: Commit** — `git commit -am "docs(pa): what's-next ranking rules"`

---

## Task 3: The Conductor skill

**Files:** Create `packages/product-architect/skill/SKILL.md` + `references/mcp-usage.md`

- [ ] **Step 1: Write `mcp-usage.md`** — map each intent to MCP calls:

```markdown
# Backlog MCP usage
- what's next        → dependency_graph (readySet+blocked) + list_work_items → rank (references/ranking.md)
- what's before <X>  → list_work_items + walk dependsOn backward from X; show the chain + the bottleneck (deepest not-done)
- add <feature>      → create a native story (get_work_item to check id collision), then brainstorm the spec
- board health       → detect_frameworks + dependency_graph.cycles + stale items
```

- [ ] **Step 2: Write `SKILL.md`**

```markdown
---
name: product-architect
description: Use for portfolio/agile questions about a project's work — "what's next", "what's blocking / needed before feature X", "add this feature", "board health" — or to drive a story through the lifecycle. Reads work + sessions from the Backlog MCP (server name: `backlog`).
---

# Product Architect (Conductor)

You orchestrate agile work. You are a **pure consumer of the Backlog MCP** (server `backlog`):
call its tools for all work/session data — never read framework files yourself. The MCP gives the
*objective* graph; you apply *opinionated* ranking + keep the human in the loop.

## Setup
If the `backlog` MCP server isn't connected, tell the user to register it (`.mcp.json`) and stop.

## Intents (see references/mcp-usage.md)
- **"what's next?"** → `dependency_graph` + `list_work_items`, rank per `references/ranking.md`, present the
  ranked READY list + the BLOCKED list (with `waitingOn`). Offer to start the top item.
- **"what's needed before <X>?"** → walk `dependsOn` backward from X; render the chain, mark each node's
  status, name the bottleneck. Offer to push the bottleneck forward.
- **"add <feature>"** → create a native story, then invoke `superpowers:brainstorming` (HARD-GATE: design
  approved before any plan/code).
- **"board health"** → report `dependency_graph().cycles`, stale items, status drift.

## Rules
- Quote real numbers from MCP output; never invent board state.
- Keep the user in the loop: confirm before creating/seeding or any status change.
- Story columns are human-gated; session activity (from `list_sessions`) is advisory.
```

- [ ] **Step 3: Commit** — `git commit -am "feat(pa): Conductor skill (3 intents over the Backlog MCP)"`

---

## Task 4: Behavioral verification (dogfood against the stub)

- [ ] **Step 1:** With the stub MCP serving fixtures, exercise each intent and capture the response as evidence:
  - **what's next** → must list `native:ready-lane-ui` and `bmad:epic-1.story-2` in READY (ranked), and `native:live-arrows` under BLOCKED waiting on `native:ready-lane-ui`. (Matches the fixture graph.)
  - **what's needed before `native:live-arrows`** → chain shows `native:ready-lane-ui` (todo) → bottleneck; `native:dependency-graph` done.
  - **add "snooze a story"** → proposes a native story + offers to brainstorm; does **not** write code first.
- [ ] **Step 2:** Record the transcript of the three intents as the verification evidence on this plan. (Conversational flow — no app UI — so a captured transcript is the evidence; if any board UI is shown, attach `/visual-walkthrough`.)

---

## Task 5: Global install

**Files:** Create `packages/product-architect/INSTALL.md`

- [ ] **Step 1:** Document + perform the symlink so the skill is global:
```bash
mkdir -p ~/.claude/skills
ln -sfn "$(pwd)/packages/product-architect/skill" ~/.claude/skills/product-architect
```
(Release = copy instead of symlink.)
- [ ] **Step 2: Verify** the `product-architect` skill is discoverable in a fresh session outside this repo (it should appear in the skill list).
- [ ] **Step 3: Commit** — `git commit -am "docs(pa): global install (symlink skill)"`

---

## Self-review
- Spec coverage: the 3 intents (§6.1–6.3) ✓ T3; opinionated ranking PA-side (#5) ✓ T2; pure MCP-client (#19, claudine/sessions in MCP) ✓; keep-in-loop ✓ rules.
- The PA holds no work/session parsing — it only calls the MCP (honors "instructions, not shared code").
- Verification is behavioral (a skill, not a package); evidence = captured intent transcripts.
- Next slices (separate plans): role party + gated lifecycle; story↔session link capture at launch; curated learning on done.
