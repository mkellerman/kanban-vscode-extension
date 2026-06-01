import { formatStatusLabel, getTitleFromContent } from '../../shared/types'
import type { Feature, PlanTask } from '../../shared/types'
import { getPlanColor } from '../lib/planColors'

interface TaskCardProps {
  task: PlanTask
  parentFeature: Feature
  variant: 'enabled' | 'disabled'
  compact?: boolean
  onClick?: () => void
}

const severityClass: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  high:     'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  medium:   'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  low:      'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
}

export function TaskCard({ task, parentFeature, variant, compact, onClick }: TaskCardProps) {
  const { border, chipBg, chipText } = getPlanColor(parentFeature.id)

  if (compact) {
    return (
      <div
        className="bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700/50 rounded px-2.5 py-1 shadow-sm flex items-center gap-2 cursor-pointer hover:shadow-md transition-shadow"
        style={{ borderLeft: `2px solid ${border}` }}
        onClick={onClick}
      >
        <span className="text-[10px] font-medium text-zinc-700 dark:text-zinc-200 truncate flex-1">
          {task.title}
        </span>
      </div>
    )
  }

  if (variant === 'disabled') {
    return (
      <div
        className="bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700/50 rounded px-2.5 py-1 shadow-sm flex items-center justify-between gap-2"
        style={{ borderLeft: `2px solid ${border}`, opacity: 0.55 }}
      >
        <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 truncate">
          {task.title}
        </span>
        <span className="text-[8px] font-bold uppercase tracking-wide text-zinc-300 dark:text-zinc-600 shrink-0">
          {formatStatusLabel(task.status)}
        </span>
      </div>
    )
  }

  // task:enabled — full card
  const epicTrimmed = parentFeature.epic?.trim() || null
  const planTitle = getTitleFromContent(parentFeature.content)

  return (
    <div
      className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2.5 py-1.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
      style={{ borderLeft: `2px solid ${border}` }}
      onClick={onClick}
    >
      {/* Plan chip */}
      <div
        className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full mb-1.5"
        style={{ background: chipBg, color: chipText }}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: border }} />
        <span className="truncate max-w-[140px]">{planTitle}</span>
      </div>

      <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 truncate mb-1.5">
        {task.title}
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex flex-wrap gap-1 min-w-0">
          {epicTrimmed && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
              {epicTrimmed}
            </span>
          )}
          {parentFeature.labels.map((label) => (
            <span
              key={label}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400"
            >
              {label}
            </span>
          ))}
        </div>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${severityClass[parentFeature.priority] ?? ''}`}>
          {parentFeature.priority}
        </span>
      </div>
    </div>
  )
}
