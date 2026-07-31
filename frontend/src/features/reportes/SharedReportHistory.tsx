import { Card, Table, Badge, Button } from 'react-bootstrap'
import { RefreshCw, Share2, Copy } from 'lucide-react'

export function SharedReportHistory(options: any) {
  const {
    canViewSharedReports, isSectionVisible, t, sharedReportHistory, setShowFullSharedHistory,
    showFullSharedHistory, loadSharedReportHistory, loadingSharedHistory, isColumnVisible,
    visibleColumnCount, displayedSharedHistory, formatDateTime, projectMetrics,
    openSharedReport, copyLink, canShareReports, revokeSharedBundle,
  } = options
  return (
    <>
{canViewSharedReports && isSectionVisible('sharedHistory') && (
  <Card className="border-0 shadow-sm p-4 rounded-3 bg-white mb-4">
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div>
        <h6 className="fw-bold mb-1 text-secondary d-flex align-items-center gap-2">
          <Share2 size={18} /> {t('reportes.sharedHistoryTab')}
        </h6>
        <div className="small text-muted">{t('reportes.sharedHistoryDescription')}</div>
      </div>
      <div className="d-flex gap-2">
        {sharedReportHistory.length > 5 && (
          <Button variant="outline-secondary" size="sm" onClick={() => setShowFullSharedHistory((value) => !value)}>
            {showFullSharedHistory ? 'Ver ultimos 5' : 'Ver historial completo'}
          </Button>
        )}
        <Button variant="outline-secondary" size="sm" onClick={loadSharedReportHistory} disabled={loadingSharedHistory}>
          <RefreshCw size={14} className="me-1" /> {t('reportes.refresh')}
        </Button>
      </div>
    </div>
    <Table hover responsive className="mb-0 align-middle">
      <thead>
        <tr>
          {isColumnVisible('sharedHistory', 'snapshot') && <th>{t('reportes.snapshot')}</th>}
          {isColumnVisible('sharedHistory', 'typeUser') && <th>{t('reportes.typeUser')}</th>}
          {isColumnVisible('sharedHistory', 'buildComponent') && <th>{t('reportes.buildComponent')}</th>}
          {isColumnVisible('sharedHistory', 'qaDefinition') && <th>{t('reportes.qaDecision')}</th>}
          {isColumnVisible('sharedHistory', 'status') && <th>{t('reportes.status')}</th>}
          {isColumnVisible('sharedHistory', 'links') && <th>{t('reportes.links')}</th>}
          {isColumnVisible('sharedHistory', 'actions') && <th className="text-end">{t('reportes.actions')}</th>}
        </tr>
      </thead>
      <tbody>
        {sharedReportHistory.length === 0 ? (
          <tr>
            <td colSpan={visibleColumnCount('sharedHistory')} className="text-center text-muted py-4">
              {loadingSharedHistory ? t('reportes.sharedHistoryLoading') : t('reportes.noSharedHistory')}
            </td>
          </tr>
        ) : displayedSharedHistory.map((item) => (
          <tr key={item.snapshot_group_id}>
            {isColumnVisible('sharedHistory', 'snapshot') && (
            <td>
              <div className="fw-bold">{formatDateTime(item.created_at)}</div>
              <div className="small text-muted font-monospace">{String(item.metrics_hash || '').slice(0, 12)}</div>
            </td>
            )}
            {isColumnVisible('sharedHistory', 'typeUser') && (
            <td>
              <div className="d-flex flex-wrap gap-1 mb-1">
                {(item.report_types || []).map((type: string) => (
                  <Badge key={type} bg="light" text="dark" className="border">
                    {type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'}
                  </Badge>
                ))}
              </div>
              <div className="x-small text-muted">{item.created_by_display || item.created_by || t('reportes.userUnavailable')}</div>
            </td>
            )}
            {isColumnVisible('sharedHistory', 'buildComponent') && (
            <td>
              <div className="fw-semibold">{item.build || projectMetrics?.build_name || 'Build'}</div>
              <div className="small text-muted">{item.componente || 'Sin componente'}</div>
            </td>
            )}
            {isColumnVisible('sharedHistory', 'qaDefinition') && (
            <td>
              <Badge bg="light" text="dark" className="border">{item.build_definition || t('reportes.noDecision')}</Badge>
              {item.qa_comment && <div className="x-small text-muted mt-1 text-truncate" style={{ maxWidth: 220 }}>{item.qa_comment}</div>}
            </td>
            )}
            {isColumnVisible('sharedHistory', 'status') && (
            <td>
              <div className="d-flex flex-column gap-1">
                <Badge bg={item.activo ? (item.is_latest ? 'success' : 'secondary') : 'dark'}>
                  {!item.activo ? 'Revocado' : item.is_latest ? 'Vigente' : 'Anterior'}
                </Badge>
                {item.has_new_values && <Badge bg="warning" text="dark">{t('reportes.hasChanges')}</Badge>}
              </div>
            </td>
            )}
            {isColumnVisible('sharedHistory', 'links') && (
            <td>
              <div className="d-flex flex-wrap gap-2">
                {(['executive', 'development', 'internal'] as const).map((type) => (
                  item.links?.[type] ? (
                    <Button key={type} variant="outline-primary" size="sm" onClick={() => openSharedReport(item.links[type], type)}>
                      {type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'}
                    </Button>
                  ) : null
                ))}
              </div>
            </td>
            )}
            {isColumnVisible('sharedHistory', 'actions') && (
            <td className="text-end">
              <div className="d-flex justify-content-end gap-2">
                <Button variant="outline-secondary" size="sm" onClick={() => copyLink(item.links?.executive, 'Link Ejecutivo')}>
                  <Copy size={14} />
                </Button>
                {canShareReports && item.activo && (
                  <Button variant="outline-danger" size="sm" onClick={() => revokeSharedBundle(item)}>
                    Revocar
                  </Button>
                )}
              </div>
            </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  </Card>
)}
    </>
  )
}
