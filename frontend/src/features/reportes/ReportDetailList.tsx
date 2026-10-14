import { useEffect, useState, type ReactNode } from 'react'
import { Button } from 'react-bootstrap'

export function ReportDetailList({ items, pageSize, renderItem, t, tableColumns }: {
  items: any[]; pageSize: number; renderItem: (item: any, index: number) => ReactNode;
  t: (key: string, params?: any) => string; tableColumns?: number;
}) {
  const [limit, setLimit] = useState(pageSize)
  const identity = JSON.stringify(items.map(item => item.id || [item.case_id, item.case_code, item.bug, item.name]))
  useEffect(() => { setLimit(pageSize) }, [identity, pageSize])
  const footer = items.length > pageSize ? <>
    <span className="small text-muted me-2">{t('reportes.shownRecords', { shown: Math.min(limit, items.length), total: items.length })}</span>
    {limit < items.length && <Button size="sm" variant="outline-primary" onClick={() => setLimit(value => value + pageSize)}>{t('reportes.showMoreRecords')}</Button>}
  </> : null
  return <>{items.slice(0, limit).map(renderItem)}{footer && (tableColumns ? <tr><td colSpan={tableColumns}>{footer}</td></tr> : <div>{footer}</div>)}</>
}
