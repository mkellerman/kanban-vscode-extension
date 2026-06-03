import * as fs from 'fs'
import * as path from 'path'
import type { KanbanColumn } from '../../shared/types'

export interface PromptContext {
  title: string
  status: string
  priority: string
  labels: string[]
  content: string   // raw feature content — buildPrompt normalizes description from this
  filePath: string
}

const SAFE_ID = /^[a-zA-Z0-9_\-.]+$/

/** Maximum size for user-supplied templates (local file or settings). 16 KB. */
const MAX_TEMPLATE_BYTES = 16384

function resolveLocalTemplate(
  workspaceRoot: string,
  columnId: string
): string | null {
  if (!SAFE_ID.test(columnId)) return null
  try {
    const instructionsDir = path.resolve(workspaceRoot, '.kanban', 'instructions')
    const candidate = path.resolve(instructionsDir, columnId + '.md')
    const rel = path.relative(instructionsDir, candidate)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
    const realInstructionsDir = fs.realpathSync(instructionsDir)
    // Stage 2a: verify the instructions dir itself stays within workspaceRoot
    const realWorkspaceRoot = fs.realpathSync(workspaceRoot)
    const rootRel = path.relative(realWorkspaceRoot, realInstructionsDir)
    if (rootRel.startsWith('..') || path.isAbsolute(rootRel)) return null
    const realCandidate = fs.realpathSync(candidate)
    const realRel = path.relative(realInstructionsDir, realCandidate)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) return null
    const content = fs.readFileSync(realCandidate, 'utf8')
    const capped = content.slice(0, MAX_TEMPLATE_BYTES)
    return capped.trim() ? capped : null
  } catch {
    return null
  }
}

function substitute(template: string, ctx: PromptContext, column: KanbanColumn): string {
  const labelsStr = ctx.labels.length > 0 ? ` [${ctx.labels.join(', ')}]` : ''
  let description = ctx.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (description.length > 200) description = description.slice(0, 200) + '...'

  const vars: Record<string, string> = {
    title: ctx.title,
    priority: ctx.priority,
    status: ctx.status,
    columnName: column.name,
    labels: labelsStr,
    description,
    filePath: ctx.filePath
  }
  let result = template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')

  if (!template.includes('{{filePath}}')) {
    result += `\nSee full details in: ${ctx.filePath}`
  }
  return result
}

export function buildPrompt(
  ctx: PromptContext,
  column: KanbanColumn,
  extensionRoot: string,
  workspaceRoot: string | null,
  settingsTemplate?: string
): string {
  // Level 1: local .kanban/instructions/{columnId}.md
  if (workspaceRoot !== null) {
    const local = resolveLocalTemplate(workspaceRoot, column.id)
    if (local) return substitute(local, ctx, column)
  }

  // Level 2: settings prompt field
  if (settingsTemplate && settingsTemplate.trim()) {
    const capped = settingsTemplate.slice(0, MAX_TEMPLATE_BYTES)
    return substitute(capped, ctx, column)
  }

  // Level 3: bundled prompts/{columnId}.md (no size cap — extension-controlled)
  try {
    const bundled = fs.readFileSync(path.join(extensionRoot, 'prompts', column.id + '.md'), 'utf8')
    if (bundled.trim()) return substitute(bundled, ctx, column)
  } catch {
    // fall through
  }

  // Level 4: generic fallback
  const fallback = `Implement this feature: "{{title}}" ({{priority}} priority){{labels}}. {{description}} {{filePath}}`
  return substitute(fallback, ctx, column)
}
