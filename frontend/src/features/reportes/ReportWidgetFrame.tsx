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
  const section = REPORTES_VIEW_SECTIONS.find((item) => item.id === id)
  const label = section ? t(`reportes.${section.label}`) : id
  const showContent = Boolean(visible && children)
  return (
    <div className="reportes-widget-card">
      <div
        className={`reportes-widget-header ${editing ? '' : 'reportes-widget-header--inactive'}`}
        title={editing ? `${t('reportes.moveWidget')} ${label}` : undefined}
        aria-hidden={!editing}
      >
        <Grip size={15} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="reportes-widget-body">
        {showContent ? children : (
          <div className="reportes-widget-empty small text-muted">{t('reportes.blockNoData')}</div>
        )}
      </div>
    </div>
  )
}
