import { getTitleFromContent } from '../../shared/types'
import type { Feature, PlanTask } from '../../shared/types'

interface PlanCardProps {
  feature: Feature
  allTasks: PlanTask[]
  accentColor: string
  onClick: () => void
}

const severityClass: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  high:     'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  medium:   'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  low:      'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
}

export function PlanCard({ feature, allTasks, accentColor, onClick }: PlanCardProps) {
  const title = getTitleFromContent(feature.content)
  const taskCount = allTasks.length
  const checkedSteps = allTasks.reduce((s, t) => s + t.checkedSteps, 0)
  const totalSteps = allTasks.reduce((s, t) => s + t.totalSteps, 0)
  const progress = totalSteps === 0 ? 0 : checkedSteps / totalSteps

  const epicTrimmed = feature.epic?.trim() || null

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md cursor-pointer hover:shadow-sm transition-shadow"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="px-2.5 pt-2 pb-3">
        {/* Row 1: title + N tasks */}
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

        {/* Row 2: progress bar (full width) */}
        {taskCount > 0 && (
          <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden mb-1.5">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress * 100}%`, backgroundColor: accentColor }}
            />
          </div>
        )}

        {/* Row 3: epic + labels (left), severity (right) */}
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
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${severityClass[feature.priority] ?? ''}`}>
            {feature.priority}
          </span>
        </div>
      </div>
    </div>
  )
}
