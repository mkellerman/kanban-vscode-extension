import { ChevronDown, ChevronUp } from 'lucide-react'
import { getTitleFromContent } from '../../shared/types'
import type { Feature, PlanTask } from '../../shared/types'
import { getPlanColor } from '../lib/planColors'

interface PlanCardProps {
  feature: Feature
  allTasks: PlanTask[]
  onClick: () => void
  hasVisibleTasks?: boolean
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

const severityClass: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  high:     'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  medium:   'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  low:      'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
}

export function PlanCard({ feature, allTasks, onClick, hasVisibleTasks, isCollapsed, onToggleCollapse }: PlanCardProps) {
  const title = getTitleFromContent(feature.content)
  const taskCount = allTasks.length
  const checkedSteps = allTasks.reduce((s, t) => s + t.checkedSteps, 0)
  const totalSteps = allTasks.reduce((s, t) => s + t.totalSteps, 0)
  const progress = totalSteps === 0 ? 0 : checkedSteps / totalSteps
  const epicTrimmed = feature.epic?.trim() || null
  const { border } = getPlanColor(feature.id)

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md cursor-pointer hover:shadow-sm transition-shadow"
      style={{ borderLeft: `3px solid ${border}` }}
    >
      <div className="px-2.5 pt-2 pb-3">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="text-[12px] font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {title}
          </span>
          {taskCount > 0 && (
            <span className="text-[8px] font-bold uppercase tracking-wide text-zinc-300 dark:text-zinc-600 shrink-0">
              {taskCount} tasks
            </span>
          )}
        </div>

        {taskCount > 0 && (
          <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden mb-1.5">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress * 100}%`, backgroundColor: border }}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex flex-wrap gap-1 min-w-0">
            {epicTrimmed && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
                {epicTrimmed}
              </span>
            )}
            {feature.labels.map((label) => (
              <span
                key={label}
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {feature.customStatus ? (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {feature.customStatus}
              </span>
            ) : (
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${severityClass[feature.priority] ?? ''}`}>
                {feature.priority}
              </span>
            )}
            {hasVisibleTasks && onToggleCollapse && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
                className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 dark:text-zinc-500 transition-colors"
              >
                {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
