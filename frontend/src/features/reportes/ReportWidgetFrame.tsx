import type { ReactNode } from 'react'
import { Grip } from 'lucide-react'
import { REPORTES_VIEW_SECTIONS } from './reportesViewConfig'

type ReportWidgetFrameProps = {
  id: string
  children: ReactNode
  visible: boolean
  editing: boolean
  t: (key: string) => string
}

export function ReportWidgetFrame({ id, children, visible, editing, t }: ReportWidgetFrameProps) {
  if (!visible || !children) return null
  const section = REPORTES_VIEW_SECTIONS.find((item) => item.id === id)
  return (
    <div key={id} className="reportes-grid-item">
      <div className="reportes-widget-card">
        {editing && (
          <div className="reportes-widget-header" title={`${t('reportes.moveWidget')} ${section ? t(`reportes.${section.label}`) : id}`}>
            <Grip size={15} />
            <span>{section ? t(`reportes.${section.label}`) : id}</span>
          </div>
        )}
        <div className="reportes-widget-body">{children}</div>
      </div>
    </div>
  )
}
