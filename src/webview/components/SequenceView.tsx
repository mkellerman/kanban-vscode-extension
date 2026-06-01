import type { Feature, FeatureStatus, Priority } from '../../shared/types'
import { getTitleFromContent } from '../../shared/types'
import { buildSequence, type SequenceNode } from '../../shared/sequenceSort'

const STATUSES: FeatureStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done']

const PRIORITY_CLASS: Record<Priority, string> = {
  critical: 'bg-red-900/40 text-red-200',
  high:     'bg-amber-900/40 text-amber-200',
  medium:   'bg-blue-900/40 text-blue-200',
  low:      'bg-zinc-800 text-zinc-400',
}

interface Props {
  features: Feature[]
  visibleStatuses: Set<FeatureStatus>
  collapsedRoots: Set<string>
  onToggleStatus: (status: FeatureStatus) => void
  onToggleCollapsed: (rootId: string) => void
  onOpenFeature: (featureId: string) => void
}

export function SequenceView({
  features, visibleStatuses, collapsedRoots,
  onToggleStatus, onToggleCollapsed, onOpenFeature,
}: Props) {
  const result = buildSequence(features, visibleStatuses)
  const hasAny = result.groups.length > 0

  return (
    <div className="bg-zinc-900 text-zinc-200 text-xs">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-700">
        <span className="text-[10px] uppercase tracking-wider text-zinc-400">Status:</span>
        {STATUSES.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onToggleStatus(s)}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              visibleStatuses.has(s)
                ? 'bg-blue-900/60 text-blue-100'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Warning banner */}
      {result.warnings.length > 0 && (
        <div className="px-3 py-1.5 bg-amber-950/50 border-b border-amber-900/40 text-amber-200">
          {result.warnings.map((w, i) => (
            <div key={i}>
              {w.kind === 'cycle'
                ? `⚠ Cycle broken: dropped ${w.edge.from} → ${w.edge.to}`
                : `⚠ Unknown dependency id: ${w.id}`}
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      {!hasAny ? (
        <div className="px-3 py-6 text-center text-zinc-500">
          No features match the current status filter.
        </div>
      ) : (
        result.groups.map((g, idx) => (
          <Group
            key={`${g.root.feature.id}-${idx}`}
            rank={idx + 1}
            node={g.root}
            blocksCount={result.blocksCount}
            collapsed={collapsedRoots.has(g.root.feature.id)}
            onToggleCollapsed={onToggleCollapsed}
            onOpenFeature={onOpenFeature}
          />
        ))
      )}
    </div>
  )
}

interface GroupProps {
  rank: number
  node: SequenceNode
  blocksCount: Map<string, number>
  collapsed: boolean
  onToggleCollapsed: (rootId: string) => void
  onOpenFeature: (featureId: string) => void
}

function Group({ rank, node, blocksCount, collapsed, onToggleCollapsed, onOpenFeature }: GroupProps) {
  const hasChildren = node.children.length > 0
  return (
    <div className="border-b border-zinc-800">
      <Row
        chev={hasChildren ? (collapsed ? '▸' : '▾') : null}
        rank={rank}
        node={node}
        blocksCount={blocksCount}
        onChevronClick={hasChildren ? () => onToggleCollapsed(node.feature.id) : undefined}
        onOpenFeature={onOpenFeature}
      />
      {hasChildren && !collapsed && (
        <Subtree
          nodes={node.children}
          blocksCount={blocksCount}
          onOpenFeature={onOpenFeature}
        />
      )}
    </div>
  )
}

function Subtree({
  nodes, blocksCount, onOpenFeature,
}: {
  nodes: SequenceNode[]
  blocksCount: Map<string, number>
  onOpenFeature: (featureId: string) => void
}) {
  return (
    <div className="pl-4">
      {nodes.map((child, i) => (
        <div key={`${child.feature.id}-${i}`}>
          <Row
            chev={null}
            arm
            rank={null}
            node={child}
            blocksCount={blocksCount}
            onOpenFeature={onOpenFeature}
          />
          {child.children.length > 0 && (
            <Subtree
              nodes={child.children}
              blocksCount={blocksCount}
              onOpenFeature={onOpenFeature}
            />
          )}
        </div>
      ))}
    </div>
  )
}

interface RowProps {
  chev: '▾' | '▸' | null
  arm?: boolean
  rank: number | null
  node: SequenceNode
  blocksCount: Map<string, number>
  onChevronClick?: () => void
  onOpenFeature: (featureId: string) => void
}

function Row({ chev, arm, rank, node, blocksCount, onChevronClick, onOpenFeature }: RowProps) {
  const feature = node.feature
  const blocks = blocksCount.get(feature.id) ?? 0
  const parsedTitle = getTitleFromContent(feature.content)
  const title = parsedTitle === 'Untitled' ? feature.id : parsedTitle

  return (
    <div
      role="button"
      onClick={() => onOpenFeature(feature.id)}
      className="grid items-center px-3 py-1 cursor-pointer hover:bg-zinc-800/40"
      style={{ gridTemplateColumns: '14px 28px 70px 1fr auto auto auto auto', gap: 10, minHeight: 28 }}
    >
      <span
        onClick={onChevronClick ? (e) => { e.stopPropagation(); onChevronClick() } : undefined}
        className={`text-center text-[10px] ${onChevronClick ? 'cursor-pointer text-zinc-300 hover:text-white' : 'invisible'}`}
      >
        {chev ?? '▾'}
      </span>
      <span className="text-right font-bold text-blue-400 tabular-nums">
        {rank ?? (arm ? '└' : '')}
      </span>
      <span className="font-mono text-[11px] text-zinc-400" aria-label={`id: ${feature.id}`} title={feature.id}>#{feature.id}</span>
      <span className="text-zinc-200 truncate">{title}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${PRIORITY_CLASS[feature.priority]}`}>
        {feature.priority}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-zinc-400">{feature.status}</span>
      <span className="text-[10px] text-zinc-500">{feature.dueDate ?? '—'}</span>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-900/60 bg-amber-950/30 text-amber-200 ${blocks > 0 ? '' : 'invisible'}`}>
        blocks: {blocks}
      </span>
    </div>
  )
}
