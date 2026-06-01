import { useState, useRef, useEffect, useCallback } from 'react'
import type { Feature, FeatureStatus, PlanSection } from '../../shared/types'
import { getTitleFromContent, formatStatusLabel } from '../../shared/types'
import { vscode } from '../vscodeApi'

interface PlanEditorProps {
  feature: Feature
  sections: PlanSection[]
  focusTaskIndex?: number
  onClose: () => void
  onSectionsChange: (sections: PlanSection[]) => void
  onEditDetails: () => void
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="bg-zinc-100 dark:bg-zinc-700 px-1 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>
    return part
  })
}

function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n')
  const nodes: React.ReactNode[] = []
  let key = 0

  for (const line of lines) {
    const checkMatch = line.match(/^- \[(x| )\] (.*)$/i)
    if (checkMatch) {
      const checked = checkMatch[1].toLowerCase() === 'x'
      nodes.push(
        <div key={key++} className="flex items-start gap-2 py-0.5">
          <input type="checkbox" checked={checked} readOnly className="mt-0.5 flex-shrink-0 accent-indigo-500" />
          <span className={checked ? 'text-zinc-400 dark:text-zinc-500 line-through text-[12px]' : 'text-zinc-700 dark:text-zinc-300 text-[12px]'}>
            {renderInline(checkMatch[2])}
          </span>
        </div>
      )
    } else if (line.trim().startsWith('#')) {
      const level = (line.match(/^#+/) ?? [''])[0].length
      const text = line.replace(/^#+\s*/, '')
      const className = level === 1
        ? 'text-[13px] font-bold text-zinc-900 dark:text-zinc-100 mt-2 mb-1'
        : level === 2
          ? 'text-[12px] font-semibold text-zinc-800 dark:text-zinc-200 mt-1.5 mb-0.5'
          : 'text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 mt-1 mb-0.5'
      nodes.push(<div key={key++} className={className}>{renderInline(text)}</div>)
    } else if (line.trim()) {
      nodes.push(
        <p key={key++} className="text-zinc-600 dark:text-zinc-400 text-[12px] leading-relaxed mb-1 last:mb-0">
          {renderInline(line)}
        </p>
      )
    } else {
      nodes.push(<div key={key++} className="h-1" />)
    }
  }

  return <>{nodes}</>
}

// ── Status badge helpers ──────────────────────────────────────────────────────

function sectionStatus(section: PlanSection, taskStatuses?: Record<number, FeatureStatus>): FeatureStatus {
  // Explicit YAML status takes priority over checkbox-derived
  if (section.taskIndex !== undefined && taskStatuses?.[section.taskIndex] !== undefined) {
    return taskStatuses[section.taskIndex]
  }
  const checked = (section.content.match(/^- \[x\]/gim) ?? []).length
  const unchecked = (section.content.match(/^- \[ \]/gm) ?? []).length
  const total = checked + unchecked
  if (total === 0 || checked === 0) return 'todo'
  if (checked >= total) return 'done'
  return 'in-progress'
}

function StatusBadge({ status }: { status: FeatureStatus }) {
  const cls =
    status === 'done'        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
    status === 'in-progress' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
    status === 'review'      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
    status === 'backlog'     ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400' :
                               'bg-zinc-100 text-zinc-400 dark:bg-zinc-700 dark:text-zinc-500'
  return (
    <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>
      {formatStatusLabel(status)}
    </span>
  )
}

function MetaPill({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${className}`}>
      {children}
    </span>
  )
}

// ── Auto-resize textarea ──────────────────────────────────────────────────────

function AutoTextarea({ value, onChange, onBlur, onKeyDown }: {
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = `${ref.current.scrollHeight}px`
    }
  }, [value])

  useEffect(() => {
    ref.current?.focus()
    // Move cursor to end
    if (ref.current) {
      ref.current.selectionStart = ref.current.selectionEnd = value.length
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="w-full resize-none bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-600 rounded p-2 text-[12px] font-mono text-zinc-700 dark:text-zinc-300 leading-relaxed outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
      rows={3}
    />
  )
}

// ── PlanEditor ────────────────────────────────────────────────────────────────

export function PlanEditor({ feature, sections, focusTaskIndex, onClose, onSectionsChange, onEditDetails }: PlanEditorProps) {
  const title = getTitleFromContent(feature.content)

  // Build initial expanded set
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    if (focusTaskIndex !== undefined) {
      const focusedIdx = sections.findIndex(s => s.type === 'task' && s.taskIndex === focusTaskIndex)
      return focusedIdx >= 0 ? new Set([focusedIdx]) : new Set(sections.map((_, i) => i))
    }
    return new Set(sections.map((_, i) => i))
  })

  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')

  const togglePanel = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  const startEdit = (i: number) => {
    if (editingIdx !== null) commitEdit()
    setEditingIdx(i)
    setEditContent(sections[i].content)
  }

  const commitEdit = useCallback(() => {
    if (editingIdx === null) return
    const newSections = sections.map((s, i) => i === editingIdx ? { ...s, content: editContent } : s)
    onSectionsChange(newSections)
    setEditingIdx(null)
    setEditContent('')
  }, [editingIdx, editContent, sections, onSectionsChange])

  const cancelEdit = () => {
    setEditingIdx(null)
    setEditContent('')
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  }

  const handleClose = () => {
    if (editingIdx !== null) commitEdit()
    onClose()
  }

  const handleOpenFile = () => {
    vscode.postMessage({ type: 'openFile', featureId: feature.id })
  }

  // Status pill colors for feature meta
  const statusClass = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
  const prioClass = 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
  const epicClass = 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <span className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100 truncate mr-3">{title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onEditDetails}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-transparent text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Edit details
          </button>
          <button
            onClick={handleOpenFile}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-transparent text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Open file
          </button>
          <button
            onClick={handleClose}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 shrink-0 flex-wrap">
        <MetaPill className={statusClass}>{formatStatusLabel(feature.status)}</MetaPill>
        <MetaPill className={prioClass}>{feature.priority}</MetaPill>
        {feature.epic?.trim() && <MetaPill className={epicClass}>{feature.epic.trim()}</MetaPill>}
        {feature.labels.map(label => (
          <MetaPill key={label} className="bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400">{label}</MetaPill>
        ))}
      </div>

      {/* Panels */}
      <div className="flex-1 overflow-y-auto">
        {sections.map((section, i) => {
          const isOpen = expanded.has(i)
          const isFocused = section.type === 'task' && section.taskIndex === focusTaskIndex
          const isEditing = editingIdx === i
          const status = section.type === 'task' ? sectionStatus(section, feature.taskStatuses) : null
          const preview = section.content.replace(/\n/g, ' ').trim().slice(0, 80)

          return (
            <div
              key={i}
              className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
            >
              {/* Panel header */}
              <div
                className={[
                  'flex items-center gap-2 py-2 cursor-pointer select-none transition-colors',
                  isFocused
                    ? 'bg-[#f5f3ff] dark:bg-indigo-950/40 border-l-[3px] border-indigo-500 px-[9px]'
                    : 'px-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
                ].join(' ')}
                onClick={() => togglePanel(i)}
              >
                <span
                  className={[
                    'text-[9px] transition-transform duration-150 shrink-0',
                    isOpen ? 'rotate-90' : '',
                    isFocused ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-600',
                  ].join(' ')}
                >
                  ▶
                </span>

                <span
                  className={[
                    'text-[12px] font-semibold shrink-0',
                    !isOpen && section.type === 'description' ? 'mr-2' : 'flex-1',
                    isFocused ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-700 dark:text-zinc-300',
                  ].join(' ')}
                >
                  {section.type === 'description' ? 'Description' : section.title}
                </span>

                {/* Collapsed description inline preview */}
                {!isOpen && section.type === 'description' && preview && (
                  <span className="flex-1 text-[11px] italic text-zinc-300 dark:text-zinc-600 truncate">
                    {preview}
                  </span>
                )}

                {/* Right side: status / overview badge */}
                {section.type === 'description' ? (
                  <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-300 dark:text-zinc-600 shrink-0 ml-2">
                    overview
                  </span>
                ) : (
                  <>
                    {status && <StatusBadge status={status} />}
                    <button
                      className="text-[9px] font-semibold px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-300 dark:text-zinc-600 cursor-not-allowed shrink-0 ml-1"
                      onClick={e => e.stopPropagation()}
                    >
                      ✦ Build
                    </button>
                  </>
                )}
              </div>

              {/* Panel body */}
              {isOpen && (
                <div className="pl-[29px] pr-3 pb-3 pt-1">
                  {isEditing ? (
                    <AutoTextarea
                      value={editContent}
                      onChange={setEditContent}
                      onBlur={commitEdit}
                      onKeyDown={handleTextareaKeyDown}
                    />
                  ) : (
                    <div
                      className="cursor-text"
                      onClick={() => startEdit(i)}
                    >
                      {section.content.trim()
                        ? renderMarkdown(section.content)
                        : <span className="text-[11px] italic text-zinc-300 dark:text-zinc-600">Empty — click to edit</span>
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
