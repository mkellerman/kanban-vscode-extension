import { Plus, ChevronLeft, MoreVertical, ChevronRight } from 'lucide-react'
import { useState, useRef, useEffect, useMemo } from 'react'
import { FeatureCard } from './FeatureCard'
import { PlanCard } from './PlanCard'
import { TaskCard } from './TaskCard'
import type { Feature, KanbanColumn as KanbanColumnType, PlanTask } from '../../shared/types'
import { parseSuperpowersTasks, getTitleFromContent, formatStatusLabel } from '../../shared/types'
import type { LayoutMode } from '../store'
import { useStore } from '../store'
import type { DropTarget } from './KanbanBoard'
import { t } from '../lib/i18n'
import { vscode } from '../vscodeApi'

let activeDragTask: { featureId: string; taskIndex: number } | null = null

interface FeatureGroup {
  feature: Feature
  tasks: PlanTask[]
  allTasks: PlanTask[]
  isGhost: boolean
}

interface KanbanColumnProps {
  column: KanbanColumnType
  features: Feature[]
  allFeatures: Feature[]
  otherColumns: KanbanColumnType[]
  onFeatureClick: (feature: Feature) => void
  onAddFeature: (status: string) => void
  onCollapse: () => void
  onMoveAllCards: (targetColumnId: string) => void
  onArchiveAllCards?: () => void
  onDragStart: (e: React.DragEvent, feature: Feature) => void
  onDragOver: (e: React.DragEvent) => void
  onDragOverCard: (e: React.DragEvent, columnId: string, cardIndex: number) => void
  onDrop: (e: React.DragEvent, status: string) => void
  onDragEnd: () => void
  draggedFeature: Feature | null
  dropTarget: DropTarget | null
  layout: LayoutMode
}

export function KanbanColumn({
  column,
  features,
  allFeatures,
  otherColumns,
  onFeatureClick,
  onAddFeature,
  onCollapse,
  onMoveAllCards,
  onArchiveAllCards,
  onDragStart,
  onDragOver,
  onDragOverCard,
  onDrop,
  onDragEnd,
  draggedFeature,
  dropTarget,
  layout
}: KanbanColumnProps) {
  const isVertical = layout === 'vertical'
  const isDropTarget = dropTarget && dropTarget.columnId === column.id
  const isFlat = useStore((s) => s.cardSettings.planLayoutFlat)
  const [menuOpen, setMenuOpen] = useState(false)
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)

  const toggleGroupCollapse = (featureId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(featureId)) next.delete(featureId)
      else next.add(featureId)
      return next
    })
  }

  const handleColumnDrop = (e: React.DragEvent) => {
    if (activeDragTask) {
      e.preventDefault()
      const { featureId, taskIndex } = activeDragTask
      activeDragTask = null
      vscode.postMessage({ type: 'moveTask', featureId, taskIndex, newStatus: column.id })
      return
    }
    onDrop(e, column.id)
  }

  const groups = useMemo<FeatureGroup[]>(() => {
    const inColumn = new Set(features.map((f) => f.id))
    const result: FeatureGroup[] = features.map((feature) => {
      const allTasks = parseSuperpowersTasks(feature.content, feature.id, feature.taskStatuses)
      // Custom-status plans sit in backlog but their tasks haven't been board-managed yet —
      // show all tasks under the parent rather than filtering by column status.
      const tasks = feature.customStatus
        ? allTasks
        : allTasks.filter((t) => t.status === column.id)
      return { feature, tasks, allTasks, isGhost: false }
    })
    for (const feature of allFeatures) {
      if (inColumn.has(feature.id)) continue
      // Don't create ghost strips for custom-status plans; their tasks stay under the parent.
      if (feature.customStatus) continue
      const allTasks = parseSuperpowersTasks(feature.content, feature.id, feature.taskStatuses)
      const tasks = allTasks.filter((t) => t.status === column.id)
      if (tasks.length > 0) result.push({ feature, tasks, allTasks, isGhost: true })
    }
    return result
  }, [features, allFeatures, column.id])

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div
      className={
        isVertical
          ? "flex flex-col bg-zinc-100 dark:bg-zinc-800/50 rounded-lg"
          : "flex-shrink-0 w-72 h-full flex flex-col bg-zinc-100 dark:bg-zinc-800/50 rounded-lg"
      }
      onDragOver={onDragOver}
      onDrop={handleColumnDrop}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between w-full px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: column.color }} />
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{column.name}</h3>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">
            {features.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onCollapse}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            title={t('column.collapse', { name: column.name })}
          >
            <ChevronLeft size={16} className="text-zinc-500" />
          </button>
          <button
            onClick={() => onAddFeature(column.id)}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            title={t('column.addTo', { name: column.name })}
          >
            <Plus size={16} className="text-zinc-500" />
          </button>
          <div ref={menuRef} className="relative flex">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
              title={t('column.options')}
            >
              <MoreVertical size={16} className="text-zinc-500" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg py-1">
                <div
                  className={`relative ${features.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
                  onMouseEnter={() => setSubmenuOpen(true)}
                  onMouseLeave={() => setSubmenuOpen(false)}
                >
                  <button
                    className="w-full text-left px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-between gap-2"
                  >
                    <span>{t('column.moveAllCards')}</span>
                    <ChevronRight size={14} className="text-zinc-400 flex-shrink-0" />
                  </button>
                  {submenuOpen && (
                    <div className="absolute left-full top-0 ml-0.5 z-50 min-w-[160px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg py-1">
                      {otherColumns.map((col) => (
                        <button
                          key={col.id}
                          className="w-full text-left px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                          onClick={() => { onMoveAllCards(col.id); setMenuOpen(false); setSubmenuOpen(false) }}
                        >
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                          {col.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {onArchiveAllCards && (
                  <button
                    className={`w-full text-left px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 ${features.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
                    onClick={() => { onArchiveAllCards(); setMenuOpen(false) }}
                  >
                    {t('column.archiveAllCards')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Column Content */}
      <div
        className={
          isVertical
            ? "flex-1 p-2 flex flex-wrap gap-2"
            : "flex-1 overflow-y-auto p-2 min-h-[200px]"
        }
      >
        {groups.map((group) => {
          const featureIdx = group.isGhost
            ? -1
            : features.findIndex((f) => f.id === group.feature.id)
          const isDragging = draggedFeature?.id === group.feature.id
          const parentTitle = getTitleFromContent(group.feature.content)

          // ── Flat layout ──────────────────────────────────────────────────
          if (isFlat) {
            return (
              <div key={group.feature.id} className={isVertical ? 'w-64' : ''}>
                {/* Non-plan features still render as draggable FeatureCard */}
                {!group.isGhost && group.allTasks.length === 0 && (
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, group.feature)}
                    onDragOver={(e) => onDragOverCard(e, column.id, featureIdx)}
                    onDragEnd={onDragEnd}
                    className={`mb-1.5 ${isDragging ? 'opacity-40' : ''}`}
                  >
                    <FeatureCard
                      feature={group.feature}
                      onClick={() => onFeatureClick(group.feature)}
                      isDragging={isDragging}
                    />
                  </div>
                )}
                {/* Tasks as independent cards — no parent card, no indent */}
                {group.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="mb-1.5"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation()
                      activeDragTask = { featureId: group.feature.id, taskIndex: task.taskIndex }
                    }}
                    onDragEnd={() => { activeDragTask = null }}
                  >
                    <TaskCard
                      task={task}
                      parentFeature={group.feature}
                      variant="enabled"
                      onClick={() => vscode.postMessage({ type: 'openFeature', featureId: group.feature.id, focusTaskIndex: task.taskIndex })}
                    />
                  </div>
                ))}
              </div>
            )
          }

          // ── Nested layout (default) ───────────────────────────────────────
          return (
            <div key={group.feature.id} className={isVertical ? 'w-64 mb-2' : 'mb-2'}>
              {/* Drop indicator before this group */}
              {!group.isGhost && isDropTarget && dropTarget.index === featureIdx && (
                <div className="h-0.5 bg-blue-500 rounded-full mx-1 mb-1" />
              )}

              {/* plan:disabled — ghost strip */}
              {group.isGhost ? (
                <div className="bg-white dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-700/50 border-l-2 border-l-zinc-300 dark:border-l-zinc-600 rounded-md px-2.5 py-1.5 pb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 truncate">
                    {parentTitle}
                  </span>
                  <span className="text-[8px] font-bold uppercase tracking-wide text-zinc-300 dark:text-zinc-600 shrink-0">
                    {formatStatusLabel(group.feature.status)}
                  </span>
                </div>
              ) : (
                /* plan:enabled — draggable parent card */
                <div
                  draggable
                  onDragStart={(e) => onDragStart(e, group.feature)}
                  onDragOver={(e) => onDragOverCard(e, column.id, featureIdx)}
                  onDragEnd={onDragEnd}
                  className={isDragging ? 'opacity-40' : ''}
                >
                  {group.allTasks.length > 0 ? (
                    <PlanCard
                      feature={group.feature}
                      allTasks={group.allTasks}
                      onClick={() => onFeatureClick(group.feature)}
                      hasVisibleTasks={group.tasks.length > 0}
                      isCollapsed={!expandedGroups.has(group.feature.id)}
                      onToggleCollapse={() => toggleGroupCollapse(group.feature.id)}
                    />
                  ) : (
                    <FeatureCard
                      feature={group.feature}
                      onClick={() => onFeatureClick(group.feature)}
                      isDragging={isDragging}
                    />
                  )}
                </div>
              )}

              {/* Child task cards — only shown when expanded, always in compact (1-liner) view */}
              {expandedGroups.has(group.feature.id) && group.tasks.map((task, taskIdx) => (
                <div
                  key={task.id}
                  className={`ml-2.5 relative z-10 ${taskIdx === 0 ? '-mt-3' : 'mt-0.5'}`}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    activeDragTask = { featureId: group.feature.id, taskIndex: task.taskIndex }
                  }}
                  onDragEnd={() => { activeDragTask = null }}
                >
                  <TaskCard
                    task={task}
                    parentFeature={group.feature}
                    variant="enabled"
                    compact
                    onClick={() => vscode.postMessage({ type: 'openFeature', featureId: group.feature.id, focusTaskIndex: task.taskIndex })}
                  />
                </div>
              ))}
            </div>
          )
        })}

        {/* Drop indicator at end of list */}
        {isDropTarget && dropTarget.index === features.length && features.length > 0 && (
          <div className="h-0.5 bg-blue-500 rounded-full mx-1" />
        )}

        {groups.length === 0 && (
          <div className={isVertical ? "text-sm text-zinc-400 dark:text-zinc-500 py-4" : "text-center py-8 text-sm text-zinc-400 dark:text-zinc-500"}>
            {t('column.noFeatures')}
          </div>
        )}
      </div>
    </div>
  )
}
