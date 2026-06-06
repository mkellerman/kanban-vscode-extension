# Product Architect — Conductor Brain (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only "Conductor brain" — answer *what's next*, *what's needed before X*, and seed *add xyz* — plus the foundation fix that lets PA state (`blockedBy`/`reviews`/`handoff`) round-trip in feature frontmatter.

**Architecture:** Two parts. **(A) Extension foundation** — make `_extraFrontmatter` lossless in `src/shared/featureFrontmatter.ts` so arrays/maps survive the board UI's parse→serialize cycle (also fixes a latent bug for all custom schemas). **(B) Conductor brain** — a zero-dependency Node ESM module `board.mjs` (pure functions for parsing, dependency graph, scheduler, validation + a thin CLI), driven by a `product-architect` SKILL that recognizes intents and formats output conversationally. The board (feature `.md` frontmatter) stays the only ledger; the dependency graph is computed, never persisted.

**Tech Stack:** TypeScript + Vitest (extension, part A); Node ESM `.mjs` + built-in `node:test` (brain, part B, zero deps so it runs from a global skill anywhere); Markdown SKILL.

**Scope:** Spec build-order items 1–2. OUT of scope (later slices): role-specialist subagents, lifecycle conducting/gates, curated learning, `reviews`/`handoff` *parsing* in the brain (the fix preserves them; the party writes/reads them later).

**Reference spec:** `.kanban/specs/2026-06-06-product-architect-orchestrator-design.md`

---

## File Structure

**Part A — extension (repo, version-controlled, Vitest):**
- Modify: `src/shared/featureFrontmatter.ts` — lossless `_extraFrontmatter` parse + serialize
- Modify: `src/shared/types.ts` — `Feature._extraFrontmatter: Record<string, unknown>`
- Create: `tests/shared/featureFrontmatter.roundtrip.test.ts` — round-trip fixtures

**Part B — Conductor brain (developed in-repo, deployed global):**
- Create: `.claude/skills/product-architect/SKILL.md` — the Conductor (intents, formatting, scaffolding)
- Create: `.claude/skills/product-architect/scripts/board.mjs` — pure logic + CLI
- Create: `.claude/skills/product-architect/scripts/board.test.mjs` — `node:test` unit tests
- Create: `.claude/skills/product-architect/references/scheduler.md` — ranking rules doc

Each `board.mjs` function is a pure function of its inputs (graph/rank take parsed data, no filesystem) so it is unit-testable; only `readBoard`/`main` touch the filesystem.

---

## Task 1: Round-trip fix — failing test (Part A)

**Files:**
- Test: `tests/shared/featureFrontmatter.roundtrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseFeatureFile, serializeFeature } from '../../src/shared/featureFrontmatter'

const FILE = '/board/features/demo.md'

describe('_extraFrontmatter lossless round-trip', () => {
  it('preserves a list field (blockedBy) and a nested map (reviews) through parse→serialize→parse', () => {
    const original = [
      '---',
      'id: "demo"',
      'status: "todo"',
      'priority: "high"',
      'order: "a0"',
      'blockedBy:',
      '  - other-story',
      '  - another-story',
      'reviews:',
      '  architect: pass',
      '  security: blocking',
      '---',
      '# Demo',
      '',
      'Body text.',
    ].join('\n')

    const first = parseFeatureFile(original, FILE)
    expect(first).not.toBeNull()
    // blockedBy survives as an array
    expect(first!._extraFrontmatter?.blockedBy).toEqual(['other-story', 'another-story'])
    // reviews survives as an object
    expect(first!._extraFrontmatter?.reviews).toEqual({ architect: 'pass', security: 'blocking' })

    // serialize, then parse again — structure must be identical (no String() collapse)
    const round = parseFeatureFile(serializeFeature(first!), FILE)
    expect(round!._extraFrontmatter?.blockedBy).toEqual(['other-story', 'another-story'])
    expect(round!._extraFrontmatter?.reviews).toEqual({ architect: 'pass', security: 'blocking' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/shared/featureFrontmatter.roundtrip.test.ts`
Expected: FAIL — `blockedBy` comes back as the string `"other-story,another-story"` and `reviews` as `"[object Object]"` (the current `String(val)` behavior).

---

## Task 2: Round-trip fix — implementation (Part A)

**Files:**
- Modify: `src/shared/types.ts` (the `_extraFrontmatter` property on `Feature`)
- Modify: `src/shared/featureFrontmatter.ts:36-41` (parse) and `:86-108` (serialize loop)

- [ ] **Step 1: Widen the type**

In `src/shared/types.ts`, find the `Feature` interface's extra-frontmatter field and change it from `Record<string, string>` to `Record<string, unknown>`:

```ts
  _extraFrontmatter?: Record<string, unknown>
```

- [ ] **Step 2: Preserve original values on parse**

In `src/shared/featureFrontmatter.ts`, replace the extra-frontmatter capture loop (currently lines ~36-41) with:

```ts
  // Capture any frontmatter fields not in the feature schema for lossless round-trips
  const extraKeys = Object.keys(parsed).filter(key => !KNOWN_KEYS.has(key))
  const _extraFrontmatter: Record<string, unknown> = {}
  for (const key of extraKeys) {
    _extraFrontmatter[key] = parsed[key] // preserve structure (arrays/maps/scalars), do NOT String()
  }
```

- [ ] **Step 3: Serialize arbitrary values faithfully**

In `serializeFeature`, the per-entry loop builds nodes manually and falls through to a `String`-coercing scalar for anything non-array. Add an object branch that uses the YAML document to build a faithful node. Replace the value-construction block (currently the `if (value === null …) … else if (Array.isArray(value)) … else { scalar }` chain) with:

```ts
    let v: Scalar | YAMLSeq | YAMLMap | ReturnType<Document['createNode']>
    if (value === null || value === undefined) {
      v = new Scalar(null)
    } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      const seq = new YAMLSeq()
      seq.flow = true
      for (const item of value as string[]) {
        const s = new Scalar(item)
        s.type = 'QUOTE_DOUBLE'
        seq.add(s)
      }
      v = seq
    } else if (typeof value === 'object') {
      // arrays-of-non-strings and nested maps (reviews/handoff): let the yaml lib build the node
      v = doc.createNode(value)
    } else {
      v = new Scalar(value as string)
      v.type = 'QUOTE_DOUBLE'
    }

    map.add(new Pair(k, v))
```

Ensure `YAMLMap` is imported (it already is) and `Document` is imported from `yaml` (it already is, used as `new Document()`).

- [ ] **Step 4: Run the round-trip test to verify it passes**

Run: `pnpm vitest run tests/shared/featureFrontmatter.roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full shared + extension suite to check for regressions**

Run: `pnpm vitest run tests/shared tests/extension && pnpm typecheck`
Expected: PASS. (If a consumer relied on `_extraFrontmatter` values being strings, the typecheck/test will flag it — fix by reading the value as the appropriate type. Grep first: `grep -rn "_extraFrontmatter" src/`.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/featureFrontmatter.ts src/shared/types.ts tests/shared/featureFrontmatter.roundtrip.test.ts
git commit -m "fix: preserve arrays/maps in _extraFrontmatter round-trip"
```

---

## Task 3: Brain — frontmatter parsing (Part B)

**Files:**
- Create: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, readBlockedBy } from './board.mjs'

test('parseFrontmatter reads scalars, block lists, and body', () => {
  const text = ['---', 'id: "x"', 'status: "todo"', 'priority: "high"',
    'blockedBy:', '  - a', '  - b', '---', '# Title', '', 'Body.'].join('\n')
  const { fields, body } = parseFrontmatter(text)
  assert.equal(fields.id, 'x')
  assert.equal(fields.status, 'todo')
  assert.deepEqual(fields.blockedBy, ['a', 'b'])
  assert.match(body, /# Title/)
})

test('readBlockedBy tolerates a legacy comma-string', () => {
  assert.deepEqual(readBlockedBy({ blockedBy: 'a,b , c' }), ['a', 'b', 'c'])
  assert.deepEqual(readBlockedBy({ blockedBy: ['a', 'b'] }), ['a', 'b'])
  assert.deepEqual(readBlockedBy({}), [])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — `Cannot find module './board.mjs'` / exports undefined.

- [ ] **Step 3: Implement the parser**

Create `board.mjs` with:

```js
#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'

export const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

const unquote = (s) =>
  (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1) : s
const coerce = (s) => (s === 'null' || s === '' ? null : s)

export function parseFrontmatter(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fields: {}, body: text }
  const fields = {}
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const raw = kv[2].trim()
    if (raw === '') {
      const list = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        list.push(unquote(lines[++i].replace(/^\s*-\s+/, '').trim()))
      }
      fields[key] = list.length ? list : null
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = raw.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean)
    } else {
      fields[key] = coerce(unquote(raw))
    }
  }
  return { fields, body: m[2] || '' }
}

// Tolerant: accept a YAML list OR a legacy comma-string (post-bug corruption).
export function readBlockedBy(fields) {
  const v = fields.blockedBy
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs
git commit -m "feat(pa): board frontmatter parser with tolerant blockedBy"
```

---

## Task 4: Brain — feature model + board reader (Part B)

**Files:**
- Modify: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { toFeature } from './board.mjs'

test('toFeature derives id from filename, title from first heading, blockedBy tolerant', () => {
  const text = ['---', 'status: "todo"', 'priority: "low"', 'order: "a1"',
    'blockedBy: ["dep-a"]', '---', '# Snooze a story', 'desc'].join('\n')
  const f = toFeature(text, '/b/features/snooze-2026.md')
  assert.equal(f.id, 'snooze-2026')
  assert.equal(f.title, 'Snooze a story')
  assert.equal(f.status, 'todo')
  assert.deepEqual(f.blockedBy, ['dep-a'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — `toFeature` is not exported.

- [ ] **Step 3: Implement `toFeature` + `readBoard`**

Append to `board.mjs`:

```js
export function toFeature(text, filePath) {
  const { fields, body } = parseFrontmatter(text)
  const id = fields.id || basename(filePath, '.md')
  const titleMatch = body.match(/^#\s+(.+)$/m)
  return {
    id,
    file: basename(filePath),
    filePath,
    status: fields.status || 'backlog',
    priority: fields.priority || 'medium',
    order: fields.order || 'a0',
    epic: fields.epic ?? null,
    created: fields.created || null,
    modified: fields.modified || null,
    title: titleMatch ? titleMatch[1].trim() : id,
    blockedBy: readBlockedBy(fields),
  }
}

// Recursively read every .md under <featuresDir> (includes the done/ subfolder).
export async function readBoard(featuresDir) {
  const out = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) }
    catch { return } // missing board dir → empty board
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.md')) out.push(toFeature(await readFile(p, 'utf8'), p))
    }
  }
  await walk(featuresDir)
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs
git commit -m "feat(pa): feature model + recursive board reader"
```

---

## Task 5: Brain — dependency graph (ready / blocked) (Part B)

**Files:**
- Modify: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { buildGraph } from './board.mjs'

const F = (id, status, blockedBy = [], extra = {}) =>
  ({ id, status, priority: 'medium', order: 'a0', blockedBy, title: id, ...extra })

test('buildGraph computes ready and blocked sets', () => {
  const feats = [
    F('done-dep', 'done'),
    F('ready-1', 'todo', ['done-dep']),     // blocker done → ready
    F('blocked-1', 'todo', ['ready-1']),    // blocker not done → blocked
    F('in-flight', 'in-progress', []),       // not a "next" candidate
  ]
  const g = buildGraph(feats)
  assert.deepEqual(g.readySet.map((f) => f.id), ['ready-1'])
  assert.deepEqual(g.blockedSet.map((f) => f.id), ['blocked-1'])
  assert.equal(g.unblockImpact('done-dep'), 1) // ready-1 depends on it
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — `buildGraph` not exported.

- [ ] **Step 3: Implement `buildGraph`**

Append to `board.mjs`:

```js
const STARTABLE = new Set(['backlog', 'todo'])

export function buildGraph(features) {
  const byId = new Map(features.map((f) => [f.id, f]))
  const isDone = (id) => byId.get(id)?.status === 'done'
  const blockersMet = (f) => f.blockedBy.every(isDone)

  const readySet = features.filter((f) => STARTABLE.has(f.status) && blockersMet(f))
  const blockedSet = features.filter((f) => STARTABLE.has(f.status) && !blockersMet(f))

  // direct dependents: how many features list `id` in their blockedBy
  const unblockImpact = (id) => features.filter((f) => f.blockedBy.includes(id)).length

  return { byId, features, readySet, blockedSet, unblockImpact, isDone, blockersMet }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs
git commit -m "feat(pa): dependency graph with ready/blocked sets"
```

---

## Task 6: Brain — closure, critical path, cycle detection (Part B)

**Files:**
- Modify: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { prerequisites, criticalPath, detectCycles } from './board.mjs'

test('prerequisites = transitive blockedBy closure', () => {
  const g = buildGraph([
    F('a', 'done'), F('b', 'todo', ['a']), F('c', 'backlog', ['b']),
  ])
  assert.deepEqual(prerequisites(g, 'c').sort(), ['a', 'b'])
})

test('criticalPath returns the longest prerequisite chain ending at the target', () => {
  const g = buildGraph([
    F('a', 'todo'), F('b', 'todo', ['a']), F('c', 'todo', ['b']),
  ])
  assert.deepEqual(criticalPath(g, 'c'), ['a', 'b', 'c'])
})

test('detectCycles finds a cycle', () => {
  const g = buildGraph([F('x', 'todo', ['y']), F('y', 'todo', ['x'])])
  assert.equal(detectCycles(g).length >= 1, true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement the graph algorithms**

Append to `board.mjs`:

```js
export function prerequisites(graph, id, seen = new Set()) {
  const f = graph.byId.get(id)
  if (!f) return [...seen]
  for (const dep of f.blockedBy) {
    if (!seen.has(dep)) { seen.add(dep); prerequisites(graph, dep, seen) }
  }
  return [...seen]
}

// Longest dependency chain ending at id (inclusive), by recursion over blockedBy.
export function criticalPath(graph, id) {
  const f = graph.byId.get(id)
  if (!f || f.blockedBy.length === 0) return [id]
  let longest = []
  for (const dep of f.blockedBy) {
    const path = criticalPath(graph, dep)
    if (path.length > longest.length) longest = path
  }
  return [...longest, id]
}

export function detectCycles(graph) {
  const cycles = []
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map(graph.features.map((f) => [f.id, WHITE]))
  const stack = []
  const visit = (id) => {
    if (!graph.byId.has(id)) return
    color.set(id, GRAY); stack.push(id)
    for (const dep of graph.byId.get(id).blockedBy) {
      if (color.get(dep) === GRAY) cycles.push([...stack.slice(stack.indexOf(dep)), dep])
      else if (color.get(dep) === WHITE) visit(dep)
    }
    stack.pop(); color.set(id, BLACK)
  }
  for (const f of graph.features) if (color.get(f.id) === WHITE) visit(f.id)
  return cycles
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs
git commit -m "feat(pa): transitive closure, critical path, cycle detection"
```

---

## Task 7: Brain — scheduler ranking (Part B)

**Files:**
- Modify: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`
- Create: `.claude/skills/product-architect/references/scheduler.md`

- [ ] **Step 1: Write the failing test**

```js
import { rankReady } from './board.mjs'

test('rankReady orders by priority, then unblock-impact, then age, then order', () => {
  const feats = [
    F('low-old', 'todo', [], { priority: 'low', created: '2020-01-01' }),
    F('high-a', 'todo', [], { priority: 'high', created: '2026-01-01', order: 'a5' }),
    F('high-b', 'todo', [], { priority: 'high', created: '2026-01-01', order: 'a1' }),
  ]
  const g = buildGraph(feats)
  const ranked = rankReady(g, new Date('2026-06-06')).map((f) => f.id)
  // both high before low; between the highs, lower `order` wins (a1 < a5)
  assert.deepEqual(ranked, ['high-b', 'high-a', 'low-old'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — `rankReady` not exported.

- [ ] **Step 3: Implement `rankReady`**

Append to `board.mjs`:

```js
// Rank the ready set: priority asc(rank) → unblock-impact desc → age desc(older first) → order asc.
export function rankReady(graph, now = new Date()) {
  const ageDays = (f) => (f.created ? (now - new Date(f.created)) / 86400000 : 0)
  return [...graph.readySet].sort((a, b) =>
    (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
    graph.unblockImpact(b.id) - graph.unblockImpact(a.id) ||
    ageDays(b) - ageDays(a) ||
    String(a.order).localeCompare(String(b.order))
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS.

- [ ] **Step 5: Document the ranking rules**

Create `.claude/skills/product-architect/references/scheduler.md`:

```markdown
# Scheduler ranking rules

The "ready set" = stories with `status` in {backlog, todo} whose every `blockedBy` id
resolves to a story with `status: done`.

Ready stories are ranked by, in order:
1. **priority** — critical > high > medium > low
2. **unblock-impact** — how many other stories directly list this one in `blockedBy` (more = earlier)
3. **age** — older `created` first (don't let things rot)
4. **order** — the board's fractional-index drag order (tie-breaker)

Blocked stories (startable but blockers unmet) are reported separately with the blocker(s) named.
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs .claude/skills/product-architect/references/scheduler.md
git commit -m "feat(pa): scheduler ranking + rules doc"
```

---

## Task 8: Brain — normalize / validate (Part B)

**Files:**
- Modify: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { validateBoard } from './board.mjs'

test('validateBoard flags status drift, missing blockers, and cycles', () => {
  const feats = [
    F('a', 'completed'),                 // drift: should be "done"
    F('b', 'todo', ['ghost']),           // missing blocker
    F('x', 'todo', ['y']), F('y', 'todo', ['x']), // cycle
  ]
  const issues = validateBoard(buildGraph(feats), new Date('2026-06-06'))
  const kinds = new Set(issues.map((i) => i.kind))
  assert.ok(kinds.has('status-drift'))
  assert.ok(kinds.has('missing-blocker'))
  assert.ok(kinds.has('cycle'))
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — `validateBoard` not exported.

- [ ] **Step 3: Implement `validateBoard`**

Append to `board.mjs`:

```js
const ZOMBIE_DAYS = 90

export function validateBoard(graph, now = new Date()) {
  const issues = []
  for (const f of graph.features) {
    if (f.status === 'completed') issues.push({ kind: 'status-drift', id: f.id, detail: 'status "completed" should be "done"' })
    for (const dep of f.blockedBy) {
      if (!graph.byId.has(dep)) issues.push({ kind: 'missing-blocker', id: f.id, detail: `blockedBy references unknown story "${dep}"` })
    }
    if (STARTABLE.has(f.status) && f.modified) {
      const days = (now - new Date(f.modified)) / 86400000
      if (days > ZOMBIE_DAYS) issues.push({ kind: 'zombie', id: f.id, detail: `no change in ${Math.round(days)}d` })
    }
  }
  for (const cyc of detectCycles(graph)) issues.push({ kind: 'cycle', id: cyc.join(' → '), detail: 'dependency cycle' })
  return issues
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs
git commit -m "feat(pa): board normalize/validate checks"
```

---

## Task 9: Brain — CLI + card seeding (Part B)

**Files:**
- Modify: `.claude/skills/product-architect/scripts/board.mjs`
- Test: `.claude/skills/product-architect/scripts/board.test.mjs`

- [ ] **Step 1: Write the failing test (seed helper is pure → testable)**

```js
import { buildSeedCard } from './board.mjs'

test('buildSeedCard produces valid frontmatter + title + id', () => {
  const { id, content } = buildSeedCard('Snooze a story until date', '2026-06-06T00:00:00.000Z')
  assert.equal(id, 'snooze-a-story-until-date-2026-06-06')
  assert.match(content, /^---\n[\s\S]*status: "backlog"[\s\S]*---\n# Snooze a story until date/)
  // round-trips through our own parser
  const f = toFeature(content, `/b/features/${id}.md`)
  assert.equal(f.status, 'backlog')
  assert.equal(f.title, 'Snooze a story until date')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: FAIL — `buildSeedCard` not exported.

- [ ] **Step 3: Implement `buildSeedCard` + the CLI `main`**

Append to `board.mjs`:

```js
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

export function buildSeedCard(title, nowIso) {
  const id = `${slug(title)}-${nowIso.slice(0, 10)}`
  const content = [
    '---', `id: "${id}"`, 'status: "backlog"', 'priority: "medium"',
    'assignee: null', 'epic: null', `created: "${nowIso}"`, `modified: "${nowIso}"`,
    'labels: []', 'order: "a0"', 'blockedBy: []', '---',
    `# ${title}`, '', '_Seeded by the Product Architect; pending grooming._', '',
  ].join('\n')
  return { id, content }
}

// ---- CLI ----
function fmtNext(graph, now) {
  const ranked = rankReady(graph, now)
  const lines = ranked.map((f, i) =>
    `  ${i + 1}. [${f.priority}] ${f.id} — unblocks ${graph.unblockImpact(f.id)} · ${f.title}`)
  const blocked = graph.blockedSet.map((f) =>
    `  - ${f.id} (waits on: ${f.blockedBy.filter((d) => !graph.isDone(d)).join(', ') || '?'})`)
  return [`READY (${ranked.length}):`, ...lines, blocked.length ? `BLOCKED (${blocked.length}):` : '', ...blocked]
    .filter(Boolean).join('\n')
}

async function main(argv) {
  const [cmd, ...rest] = argv
  const featuresDir = process.env.PA_FEATURES_DIR || join(process.cwd(), '.kanban', 'features')
  if (cmd === 'whats-next' || cmd === 'health' || cmd === 'before' || cmd === 'dump') {
    const graph = buildGraph(await readBoard(featuresDir))
    if (cmd === 'whats-next') console.log(fmtNext(graph, new Date()))
    else if (cmd === 'health') console.log(JSON.stringify(validateBoard(graph, new Date()), null, 2))
    else if (cmd === 'dump') console.log(JSON.stringify(graph.features, null, 2))
    else if (cmd === 'before') {
      const id = rest[0]
      console.log(JSON.stringify({ criticalPath: criticalPath(graph, id), prerequisites: prerequisites(graph, id) }, null, 2))
    }
  } else if (cmd === 'seed') {
    const title = rest.join(' ').trim()
    if (!title) { console.error('usage: board.mjs seed <title>'); process.exit(2) }
    const { id, content } = buildSeedCard(title, new Date().toISOString())
    await mkdir(featuresDir, { recursive: true })
    await writeFile(join(featuresDir, `${id}.md`), content, 'utf8')
    console.log(id)
  } else {
    console.error('usage: board.mjs <whats-next|before <id>|health|dump|seed <title>>'); process.exit(2)
  }
}

// Run main only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `node --test .claude/skills/product-architect/scripts/board.test.mjs`
Expected: PASS (all tests across tasks 3–9).

- [ ] **Step 5: Smoke-test the CLI against a temp board**

Run:
```bash
tmp=$(mktemp -d); mkdir -p "$tmp/.kanban/features"
printf '%s\n' '---' 'id: "dep"' 'status: "done"' 'priority: "high"' '---' '# Dep' > "$tmp/.kanban/features/dep.md"
printf '%s\n' '---' 'id: "go"' 'status: "todo"' 'priority: "high"' 'blockedBy: ["dep"]' '---' '# Go' > "$tmp/.kanban/features/go.md"
PA_FEATURES_DIR="$tmp/.kanban/features" node .claude/skills/product-architect/scripts/board.mjs whats-next
```
Expected: prints `READY (1):` with `go` listed (its blocker `dep` is done).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/product-architect/scripts/board.mjs .claude/skills/product-architect/scripts/board.test.mjs
git commit -m "feat(pa): CLI (whats-next/before/health/dump/seed) + card seeding"
```

---

## Task 10: The Conductor SKILL (Part B)

**Files:**
- Create: `.claude/skills/product-architect/SKILL.md`

- [ ] **Step 1: Write the SKILL**

```markdown
---
name: product-architect
description: Use when the user asks portfolio/agile questions about a Kanban board — "what's next", "what's blocking / what's needed before feature X", "add this feature", "board health" — or wants to drive a story through the lifecycle. Operates on a .kanban/ board of markdown feature files.
---

# Product Architect (Conductor)

You orchestrate an agile board. The board is the source of truth: feature `.md`
files under `.kanban/features/` with YAML frontmatter (`status`, `priority`, `epic`,
`order`, `blockedBy`). The deterministic logic lives in `scripts/board.mjs` — call it,
never re-implement its graph/ranking in prose.

## Setup check
If `.kanban/features/` does not exist in the workspace, offer to scaffold it:
create `.kanban/features/`, `.kanban/instructions.md`, and `.kanban/context.json`.
Do not proceed with board queries until a board exists.

## Intents

- **"what's next?"** → run `node <skilldir>/scripts/board.mjs whats-next`. Present the
  ranked READY list and the BLOCKED list in prose. Offer to start the top item.
- **"what's needed before <X>?" / "what's blocking <X>?"** → run `... before <id>`.
  Render the `criticalPath` as a chain and name the bottleneck (the deepest not-done item).
- **"add <feature>" / "can you add <X>"** → run `... seed "<title>"` to create the
  backlog card, then invoke `superpowers:brainstorming` to groom it. Honor the
  brainstorming HARD-GATE: present a design and get approval before any plan or code.
- **"board health"** → run `... health`. Summarize issues (status drift, missing
  blockers, cycles, zombies) and offer to fix them (edit the offending frontmatter).

## Rules
- Quote real numbers from the script output; never invent board state.
- Keep the user in the loop: after seeding or before any status change, confirm with them.
- `<skilldir>` is this skill's directory; resolve the script path relative to it.
```

- [ ] **Step 2: Verify the skill is discoverable and runs end-to-end (dogfood)**

Run (from the repo root, which has `.kanban/`):
```bash
node .claude/skills/product-architect/scripts/board.mjs health
```
Expected: prints a JSON issues array (likely `[]` or drift items) without error — confirms the script resolves and reads this repo's board.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/product-architect/SKILL.md
git commit -m "feat(pa): Conductor SKILL with intents + scaffolding"
```

---

## Task 11: Global install + dogfood verification

**Files:**
- Create: `.claude/skills/product-architect/INSTALL.md` (deploy notes)

- [ ] **Step 1: Document + perform the global symlink**

Create `.claude/skills/product-architect/INSTALL.md`:

```markdown
# Install (global)

For development, symlink the global skill at the repo copy so edits are live everywhere:

    ln -sfn "$(pwd)/.claude/skills/product-architect" ~/.claude/skills/product-architect

For a release on a machine without this repo, copy instead of symlink:

    cp -R .claude/skills/product-architect ~/.claude/skills/product-architect

The brain script is zero-dependency Node ESM; it runs anywhere `node` is on PATH.
```

Run:
```bash
mkdir -p ~/.claude/skills
ln -sfn "$(pwd)/.claude/skills/product-architect" ~/.claude/skills/product-architect
```

- [ ] **Step 2: Verify global availability**

Run: `node ~/.claude/skills/product-architect/scripts/board.mjs whats-next`
Expected: runs against the current directory's `.kanban/` board (or prints `READY (0):` if none), proving the global path works.

- [ ] **Step 3: Full verification sweep**

Run:
```bash
node --test .claude/skills/product-architect/scripts/board.test.mjs
pnpm vitest run tests/shared/featureFrontmatter.roundtrip.test.ts
pnpm typecheck
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/product-architect/INSTALL.md
git commit -m "docs(pa): global install notes + symlink"
```

---

## Manual verification (per repo policy)

The brain is CLI/logic, so unit tests + CLI smoke tests are the primary evidence. There is **no UI** in this slice. If a later slice surfaces board state in the extension UI, that step will require `/visual-walkthrough` evidence per the repo's verification policy. For this slice, attach the passing `node --test` and `pnpm vitest run` output to the plan when marking tasks done.

## Self-review checklist (run before execution)

- [ ] Spec coverage: round-trip fix (§10/§14.1) ✓ T1–2; dependency graph (§6.5) ✓ T5–6; scheduler (§6.1) ✓ T7; 3 intents (§6.1–6.3) ✓ T9–10; normalize/validate (§8.1) ✓ T8; scaffolding + global install (§9) ✓ T10–11.
- [ ] No placeholders — every step has real code/commands.
- [ ] Type/name consistency — `toFeature`, `buildGraph`, `rankReady`, `prerequisites`, `criticalPath`, `detectCycles`, `validateBoard`, `buildSeedCard`, `readBlockedBy`, `parseFrontmatter` are defined once and reused with the same signatures.
