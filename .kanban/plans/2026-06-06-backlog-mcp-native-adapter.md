# Backlog MCP — Real `native` Adapter (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). TDD; steps use `- [ ]`. Run in a worktree.

**Goal:** Replace the fixture data source in `@kanban/backlog-mcp` with a real **`native` adapter** (reads/writes the per-story-folder format) behind an adapter registry — the contract, library surface, and MCP server stay unchanged.

**Architecture:** Add `src/adapters/` with a `FrameworkAdapter` interface + a `native` adapter (parses `.kanban/features/<id>/story.md` via the `yaml` package). A registry detects present adapters and aggregates. `src/index.ts` library functions delegate to the registry instead of `fixtures`. Scope (the project root to scan) is passed in.

**Spec:** `.kanban/specs/2026-06-06-backlog-mcp-design.md` (§5 adapter contract, §5.1 native format). **Contract:** `packages/backlog-mcp/src/contract.ts` (frozen — do not change shapes).

**Tech:** TS + vitest + `yaml` (add as a dep). Out of scope: superpowers/bmad/github adapters, sessions domain, user-scope registry (later slices).

---

## File structure
- Add dep: `yaml` to `packages/backlog-mcp/package.json`
- Create: `src/adapters/types.ts` — `FrameworkAdapter` interface + `AdapterContext` (root, scope)
- Create: `src/adapters/native.ts` — the native per-story-folder adapter
- Create: `src/adapters/registry.ts` — detect + aggregate adapters
- Modify: `src/index.ts` — library functions delegate to the registry (root from `PA_BOARD_ROOT` env or cwd)
- Tests: `src/adapters/native.test.ts`, `src/adapters/registry.test.ts`
- Test fixture dir: `src/adapters/__fixtures__/board/.kanban/features/<id>/story.md`

---

## Task 1: Adapter interface

**Files:** Create `src/adapters/types.ts`; Test `src/adapters/registry.test.ts` (stub import)

- [ ] **Step 1: Write the interface** (no test — pure types)

```ts
import type { WorkItem } from '../contract'

export interface AdapterContext {
  /** absolute path of the project root to read */
  root: string
}

export interface FrameworkAdapter {
  name: string
  /** is this framework present under ctx.root? */
  detect(ctx: AdapterContext): Promise<boolean>
  /** read + normalize all work items under ctx.root */
  listItems(ctx: AdapterContext): Promise<WorkItem[]>
  /** full body text for an id this adapter owns */
  getBody(ctx: AdapterContext, id: string): Promise<string>
  /** native is read+write; foreign adapters omit this (read-only) */
  setStatus?(ctx: AdapterContext, id: string, status: string): Promise<void>
}
```

- [ ] **Step 2: Commit** — `git add -A && git commit -m "feat(mcp): FrameworkAdapter interface"`

---

## Task 2: Native adapter — parse a story folder

**Files:** Create `src/adapters/native.ts`; Test `src/adapters/native.test.ts`; fixture board under `src/adapters/__fixtures__/board/`

- [ ] **Step 1: Create the fixture board**

`src/adapters/__fixtures__/board/.kanban/features/ready-lane-ui/story.md`:
```md
---
id: "ready-lane-ui"
status: "todo"
priority: "high"
epic: null
order: "a1"
dependsOn: ["dependency-graph"]
sessions: []
created: "2026-06-01T00:00:00.000Z"
modified: "2026-06-02T00:00:00.000Z"
---
# Ready lane UI

A lane showing ready stories.

## Acceptance criteria
- [ ] shows ready items
```
And `src/adapters/__fixtures__/board/.kanban/features/dependency-graph/story.md` with `status: "done"`, no deps.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { nativeAdapter } from './native'

const root = resolve(__dirname, '__fixtures__/board')

describe('native adapter', () => {
  it('detects a .kanban board', async () => {
    expect(await nativeAdapter.detect({ root })).toBe(true)
  })
  it('reads story folders into namespaced WorkItems with deps', async () => {
    const items = await nativeAdapter.listItems({ root })
    const ready = items.find((i) => i.id === 'native:ready-lane-ui')
    expect(ready).toBeDefined()
    expect(ready!.status).toBe('todo')
    expect(ready!.priority).toBe('high')
    expect(ready!.dependsOn).toEqual(['native:dependency-graph']) // namespaced
    expect(ready!.acceptanceCriteria.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run it to verify it fails** — `pnpm -F @kanban/backlog-mcp test` → FAIL (no `native`)

- [ ] **Step 4: Implement `native.ts`**

```ts
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { WorkItem, NormStatus, Priority } from '../contract'
import type { FrameworkAdapter, AdapterContext } from './types'

const NS = 'native'
const id = (folder: string) => `${NS}:${folder}`
const stripNs = (x: string) => (x.startsWith(`${NS}:`) ? x.slice(NS.length + 1) : x)

function featuresDir(root: string) {
  return join(root, '.kanban', 'features')
}

function splitFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: text }
  return { fm: (parse(m[1]) ?? {}) as Record<string, unknown>, body: m[2] ?? '' }
}

function acceptanceCriteria(body: string): string[] {
  const section = body.split(/^##\s+/m).find((s) => /^acceptance criteria/i.test(s))
  if (!section) return []
  return [...section.matchAll(/^- \[[ x]\]\s+(.*)$/gim)].map((x) => x[1].trim())
}

function toWorkItem(folder: string, text: string, path: string): WorkItem {
  const { fm, body } = splitFrontmatter(text)
  const deps = Array.isArray(fm.dependsOn) ? (fm.dependsOn as unknown[]).map(String) : []
  const titleMatch = body.match(/^#\s+(.+)$/m)
  return {
    id: id(folder),
    source: { framework: NS, path },
    type: 'story',
    title: titleMatch ? titleMatch[1].trim() : folder,
    status: ((fm.status as NormStatus) ?? 'backlog'),
    priority: ((fm.priority as Priority) ?? null),
    parent: fm.epic ? id(String(fm.epic)) : null,
    children: [],
    dependsOn: deps.map((d) => id(stripNs(d))),
    labels: Array.isArray(fm.labels) ? (fm.labels as unknown[]).map(String) : [],
    estimate: null,
    acceptanceCriteria: acceptanceCriteria(body),
    bodyRef: `${id(folder)}#body`
  }
}

async function listFolders(dir: string): Promise<{ folder: string; path: string }[]> {
  const out: { folder: string; path: string }[] = []
  for (const base of [dir, join(dir, 'done')]) {
    let entries
    try { entries = await readdir(base, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'done') continue
      const p = join(base, e.name, 'story.md')
      try { await stat(p); out.push({ folder: e.name, path: p }) } catch { /* no story.md */ }
    }
  }
  return out
}

export const nativeAdapter: FrameworkAdapter = {
  name: NS,
  async detect(ctx) {
    try { await stat(featuresDir(ctx.root)); return true } catch { return false }
  },
  async listItems(ctx) {
    const folders = await listFolders(featuresDir(ctx.root))
    return Promise.all(folders.map(async (f) => toWorkItem(f.folder, await readFile(f.path, 'utf8'), f.path)))
  },
  async getBody(ctx, itemId) {
    const folder = stripNs(itemId)
    const text = await readFile(join(featuresDir(ctx.root), folder, 'story.md'), 'utf8')
    return splitFrontmatter(text).body.trim()
  },
  async setStatus(ctx, itemId, status) {
    const folder = stripNs(itemId)
    const path = join(featuresDir(ctx.root), folder, 'story.md')
    const text = await readFile(path, 'utf8')
    const { fm, body } = splitFrontmatter(text)
    fm.status = status
    fm.modified = new Date().toISOString()
    await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  }
}
```

- [ ] **Step 5: Run the test to verify it passes** — `pnpm -F @kanban/backlog-mcp test` → PASS

- [ ] **Step 6: Commit** — `git commit -am "feat(mcp): native per-story-folder adapter (read + setStatus)"`

---

## Task 3: Registry — detect + aggregate

**Files:** Create `src/adapters/registry.ts`; Test `src/adapters/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { Registry } from './registry'
import { nativeAdapter } from './native'

const root = resolve(__dirname, '__fixtures__/board')

it('detects frameworks and lists items across adapters', async () => {
  const reg = new Registry([nativeAdapter], { root })
  const fw = await reg.detectFrameworks()
  expect(fw.map((f) => f.framework)).toContain('native')
  const items = await reg.listItems()
  expect(items.some((i) => i.id === 'native:ready-lane-ui')).toBe(true)
})
```

- [ ] **Step 2: Verify it fails**, then **implement `registry.ts`**

```ts
import type { FrameworkAdapter, AdapterContext } from './types'
import type { WorkItem, FrameworkInfo } from '../contract'

export class Registry {
  constructor(private adapters: FrameworkAdapter[], private ctx: AdapterContext) {}

  async present(): Promise<FrameworkAdapter[]> {
    const flags = await Promise.all(this.adapters.map((a) => a.detect(this.ctx)))
    return this.adapters.filter((_, i) => flags[i])
  }
  async detectFrameworks(): Promise<FrameworkInfo[]> {
    const present = await this.present()
    return Promise.all(present.map(async (a) => ({
      framework: a.name, root: this.ctx.root, itemCount: (await a.listItems(this.ctx)).length
    })))
  }
  async listItems(): Promise<WorkItem[]> {
    const present = await this.present()
    return (await Promise.all(present.map((a) => a.listItems(this.ctx)))).flat()
  }
  adapterFor(id: string): FrameworkAdapter | undefined {
    return this.adapters.find((a) => id.startsWith(`${a.name}:`))
  }
  ctxRef() { return this.ctx }
}
```

- [ ] **Step 3: Test passes; Commit** — `git commit -am "feat(mcp): adapter registry (detect + aggregate)"`

---

## Task 4: Wire the library to the registry (replace fixtures)

**Files:** Modify `src/index.ts`; Test: extend `src/index.test.ts`

- [ ] **Step 1: Write the failing test** — point the library at the fixture board and assert it reads real folders

```ts
// src/board-source.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { setBoardRoot, listWorkItems, dependencyGraph } from './index'

beforeAll(() => setBoardRoot(resolve(__dirname, 'adapters/__fixtures__/board')))

it('serves real native items + a graph from the fixture board', async () => {
  const items = await listWorkItems()
  expect(items.some((i) => i.id === 'native:ready-lane-ui')).toBe(true)
  const g = await dependencyGraph()
  expect(g.readySet).toContain('native:ready-lane-ui') // dep is done
})
```

- [ ] **Step 2: Refactor `index.ts`** — functions become async, delegate to a `Registry` built from `setBoardRoot()` (default: `process.env.PA_BOARD_ROOT ?? process.cwd()`). Keep `dependencyGraph`/`detectCycles` pure (operate on the items the registry returns). Drop the `fixtures` import from the runtime path (keep fixtures only for the contract test). **Update `server.ts`** handlers to `await` the now-async functions.

(Show the diff: `listWorkItems`/`getWorkItem`/`getItemBody`/`detectFrameworks` call `registry.listItems()` etc.; `dependencyGraph(items?)` stays sync over given items but gains an async no-arg overload that fetches first.)

- [ ] **Step 3: Run full package test + typecheck + the MCP smoke** (from the project root)

```bash
pnpm -F @kanban/backlog-mcp test && pnpm -F @kanban/backlog-mcp typecheck
PA_BOARD_ROOT=packages/backlog-mcp/src/adapters/__fixtures__/board \
  bash -c 'printf "%s\n%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"s\",\"version\":\"0\"}}}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_work_items\",\"arguments\":{}}}" | pnpm -F @kanban/backlog-mcp exec tsx src/server.ts' 2>&1 | grep -i ready-lane-ui
```
Expected: the `list_work_items` response contains `native:ready-lane-ui` read from the real folder.

- [ ] **Step 4: Commit** — `git commit -am "feat(mcp): library + server read real boards via the registry"`

---

## Self-review
- Spec coverage: native format (§5.1) ✓ T2; adapter contract (§5) ✓ T1/T3; read-only-foreign groundwork (interface has optional setStatus) ✓; scope (root in AdapterContext) ✓ groundwork.
- No placeholders; every code step is complete.
- Names: `FrameworkAdapter`, `AdapterContext`, `nativeAdapter`, `Registry`, `setBoardRoot` consistent across tasks.
- Next slices (separate plans): superpowers + markdown adapters; bmad; github; the **sessions domain**; user-scope registry.
