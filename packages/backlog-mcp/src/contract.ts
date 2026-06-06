/**
 * The Backlog MCP contract — the single agreement all three products code against.
 *
 * Agents (the PA Conductor) consume these shapes over the MCP tool schemas;
 * the Kanban Board imports them as library types. Freeze changes here deliberately.
 */
import { z } from 'zod'

// ---- Work items (planning) ----

export const NORM_STATUS = [
  'backlog', 'todo', 'in-progress', 'review', 'done', 'blocked', 'cancelled'
] as const
export type NormStatus = (typeof NORM_STATUS)[number]

export const PRIORITY = ['critical', 'high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITY)[number]

export const WORK_ITEM_TYPE = [
  'epic', 'feature', 'story', 'task', 'enabler', 'spec', 'plan'
] as const
export type WorkItemType = (typeof WORK_ITEM_TYPE)[number]

export const WorkItemSchema = z.object({
  /** stable, source-namespaced — e.g. "native:snooze-2026-06-06" | "bmad:epic-3.story-2" | "gh:#142" */
  id: z.string(),
  source: z.object({ framework: z.string(), path: z.string() }),
  type: z.enum(WORK_ITEM_TYPE),
  title: z.string(),
  status: z.enum(NORM_STATUS),
  priority: z.enum(PRIORITY).nullable(),
  parent: z.string().nullable(),
  children: z.array(z.string()),
  dependsOn: z.array(z.string()),
  labels: z.array(z.string()),
  estimate: z.string().nullable(),
  acceptanceCriteria: z.array(z.string()),
  /** fetch full text via get_item_body(id) — keeps list payloads small */
  bodyRef: z.string(),
  /** consumer state merged in (PA: sessions/reviews/handoff/pa_status) */
  overlay: z.record(z.unknown()).optional()
})
export type WorkItem = z.infer<typeof WorkItemSchema>

// ---- Sessions (execution) ----

export const SESSION_STATUS = ['active', 'idle', 'needs-input', 'error', 'done'] as const
export type SessionStatus = (typeof SESSION_STATUS)[number]

export const SessionSchema = z.object({
  /** uuid = the JSONL transcript filename in ~/.claude/projects/<proj>/<uuid>.jsonl */
  id: z.string(),
  project: z.string(),
  status: z.enum(SESSION_STATUS),
  /** human-readable last tool activity, e.g. 'Edit "ReadyLane.tsx"' */
  lastActivity: z.string().nullable(),
  gitBranch: z.string().nullable(),
  worktree: z.string().nullable(),
  model: z.string().nullable(),
  tokens: z.number().nullable(),
  /** the WorkItem this session is linked to, if any */
  workItemId: z.string().nullable()
})
export type Session = z.infer<typeof SessionSchema>

// ---- Derived: dependency graph (objective queries over work items) ----

export const DependencyGraphSchema = z.object({
  /** ids whose dependsOn are all done and which are startable (backlog/todo) */
  readySet: z.array(z.string()),
  /** startable items with unmet deps, and what they wait on */
  blocked: z.array(z.object({ id: z.string(), waitingOn: z.array(z.string()) })),
  /** dependency cycles (each is a list of ids forming the loop) */
  cycles: z.array(z.array(z.string()))
})
export type DependencyGraph = z.infer<typeof DependencyGraphSchema>

export const FrameworkInfoSchema = z.object({
  framework: z.string(),
  root: z.string(),
  itemCount: z.number()
})
export type FrameworkInfo = z.infer<typeof FrameworkInfoSchema>

// ---- The MCP tool surface (input shapes are zod raw shapes for the SDK) ----

export const ListWorkItemsInput = {
  type: z.enum(WORK_ITEM_TYPE).optional(),
  status: z.enum(NORM_STATUS).optional(),
  framework: z.string().optional(),
  parent: z.string().optional()
}
export const IdInput = { id: z.string() }
export const ListSessionsInput = {
  project: z.string().optional(),
  workItemId: z.string().optional()
}

export const SetStatusInput = {
  id: z.string(),
  status: z.enum(NORM_STATUS),
}

export const CreateItemInputShape = {
  type:               z.enum(WORK_ITEM_TYPE),
  title:              z.string(),
  status:             z.enum(NORM_STATUS).optional(),
  priority:           z.enum(PRIORITY).nullish(),
  parent:             z.string().nullish(),
  dependsOn:          z.array(z.string()).optional(),
  labels:             z.array(z.string()).optional(),
  estimate:           z.string().nullish(),
  acceptanceCriteria: z.array(z.string()).optional(),
  body:               z.string().optional(),
}

export const UpdateItemInputShape = {
  id:    z.string(),
  patch: z.object({
    title:              z.string().optional(),
    status:             z.enum(NORM_STATUS).optional(),
    priority:           z.enum(PRIORITY).nullish(),
    parent:             z.string().nullish(),
    dependsOn:          z.array(z.string()).optional(),
    labels:             z.array(z.string()).optional(),
    estimate:           z.string().nullish(),
    acceptanceCriteria: z.array(z.string()).optional(),
  }),
}

export const SetBodyInput = {
  id:   z.string(),
  body: z.string(),
}

/** Catalogue of tools the server exposes — names + descriptions are the contract. */
export const TOOL_DESCRIPTIONS = {
  detect_frameworks: 'List the frameworks present in scope: [{ framework, root, itemCount }].',
  list_work_items: 'List normalized WorkItems, optionally filtered by type/status/framework/parent.',
  get_work_item: 'Get one normalized WorkItem by id (overlay merged).',
  get_item_body: 'Get the full markdown/text body for a work item by id.',
  set_status: 'Set the status of a work item by id (native adapter only).',
  create_item: 'Create a new work item in the native adapter. Returns the created WorkItem.',
  update_item: 'Patch frontmatter fields (and title/AC in body) of an existing work item. Returns the updated WorkItem.',
  set_body: 'Replace the markdown body of a work item (frontmatter unchanged).',
  delete_item: 'Delete a work item and its entire folder (native adapter only).',
  dependency_graph: 'Objective graph over the items: ready-set, blocked (with waitingOn), cycles.',
  list_sessions: 'List normalized Claude/Codex Sessions, optionally filtered by project/workItemId.',
  get_session: 'Get one normalized Session by id (uuid).'
} as const
export type ToolName = keyof typeof TOOL_DESCRIPTIONS
