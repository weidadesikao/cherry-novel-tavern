import { EmptyState } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { Share2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const VIEW = 600
const CENTER = VIEW / 2
const RADIUS = 220
const NODE_R = 26

/**
 * Read-only relationship graph: entities laid out on a circle, relations drawn
 * as directed edges. Editing the graph is a later milestone; for now it
 * visualizes the data created via the entity / relation APIs.
 */
const RelationsTab = ({ novelId }: { novelId: string }) => {
  const { t } = useTranslation()

  const { data: entities } = useQuery('/novels/:novelId/entities', { params: { novelId } })
  const { data: relations } = useQuery('/novels/:novelId/relations', { params: { novelId } })

  const nodes = useMemo(() => {
    const list = entities ?? []
    const count = Math.max(list.length, 1)
    return new Map(
      list.map((entity, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2
        return [
          entity.id,
          {
            id: entity.id,
            name: entity.name,
            x: CENTER + RADIUS * Math.cos(angle),
            y: CENTER + RADIUS * Math.sin(angle)
          }
        ] as const
      })
    )
  }, [entities])

  const hasRelations = (relations ?? []).length > 0

  if (!entities || entities.length === 0 || !hasRelations) {
    return (
      <div className="flex h-full items-center justify-center pt-3">
        <EmptyState icon={Share2} title={t('novels.relations.empty')} compact />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto pt-3">
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="h-full max-h-[600px] w-full max-w-[600px]" role="img">
        <defs>
          <marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {(relations ?? []).map((relation) => {
          const from = nodes.get(relation.fromEntityId)
          const to = nodes.get(relation.toEntityId)
          if (!from || !to) return null
          const midX = (from.x + to.x) / 2
          const midY = (from.y + to.y) / 2
          return (
            <g key={relation.id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-border"
                strokeWidth={1.5}
                markerEnd="url(#rel-arrow)"
              />
              <text x={midX} y={midY - 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {relation.relationType}
              </text>
            </g>
          )
        })}

        {[...nodes.values()].map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={NODE_R} className="fill-card stroke-primary" strokeWidth={1.5} />
            <text
              x={node.x}
              y={node.y + NODE_R + 14}
              textAnchor="middle"
              className="fill-foreground font-medium text-[12px]">
              {node.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default RelationsTab
