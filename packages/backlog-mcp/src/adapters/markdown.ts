/** Shared markdown helpers for file-per-card adapters (native, kanban-markdown, …). */
import { parse } from 'yaml'

export function splitFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: text }
  const parsed = parse(m[1]) as unknown
  return { fm: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}, body: m[2] ?? '' }
}

export function titleFromBody(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : fallback
}

export function acceptanceCriteria(body: string): string[] {
  const section = body.split(/^##\s+/m).find((s) => /^acceptance criteria/i.test(s))
  if (!section) return []
  return [...section.matchAll(/^- \[[ xX]\]\s+(.*)$/gm)].map((x) => x[1].trim())
}
