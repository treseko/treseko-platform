import type { ReactNode } from 'react'
import { Badge, Button } from 'react-bootstrap'
import { Activity, Bug, ChevronDown, ChevronRight, Clock, FileText, Image as ImageIcon, User } from 'lucide-react'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { formatDateTime } from '../../shared/utils/dateTime'
import { getBugPriorityPresentation } from '../bugs/bugPresentation'

export function ReportSuiteRows({ nodes, options, depth = 0 }: { nodes: any[]; options: any; depth?: number }): ReactNode[] {
  const { onOpenEvidence, t, isColumnVisible, visibleColumnCount, expandedMetricSuites, setExpandedMetricSuites, formatPercent, formatInt, riskVariant, formatHours, snapshotBugLinks, bugStatusIsOpen, canCreateBugs, creatingSnapshotBugId, createBugFromReportSnapshot } = options
const renderEvidenceList = (caso: any) => {
  const evidencias = Array.isArray(caso.evidencias) ? caso.evidencias : []
  if (evidencias.length === 0 && !caso.evidencia_url) return null

  return (
    <div className="d-flex flex-wrap gap-2 mt-2">
      {evidencias.length > 0 ? evidencias.map((attachment: any) => (
        isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
          <button
            key={attachment.id}
            type="button"
            className="border rounded-2 bg-white p-0"
            title={attachment.filename_original}
            onClick={() => onOpenEvidence(attachment)}
          >
            <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 42, height: 42, objectFit: 'cover' }} />
          </button>
        ) : (
          <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'outline-secondary' : 'outline-warning'} size="sm" className="x-small py-1 d-flex align-items-center gap-1" onClick={() => onOpenEvidence(attachment)}>
            <FileText size={13} /> {attachment.filename_original || 'Ver evidencia'}
            {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">{t('reportes.evidenceFileUnavailable')}</Badge>}
          </Button>
        )
      )) : (
        <Button variant="outline-secondary" size="sm" className="x-small py-1 d-flex align-items-center gap-1" onClick={() => onOpenEvidence(caso.evidencia_url)}>
          <ImageIcon size={13} /> Ver evidencia legacy
        </Button>
      )}
    </div>
  )
}

const renderSuiteRows = (nodes: any[], depth = 0): any[] => nodes.flatMap((data: any) => {
  const suiteId = data.id
  const ejecutadas = Number(data.pasados || 0) + Number(data.fallados || 0) + Number(data.bloqueados || 0)
  const tasaExito = Number(data.exito_sobre_ejecutados_porcentaje ?? (ejecutadas > 0 ? ((Number(data.pasados || 0) / ejecutadas) * 100) : 0)).toFixed(1)
  const isExpanded = expandedMetricSuites.has(suiteId)
  const hasDetails = (data.casos && data.casos.length > 0) || (data.children && data.children.length > 0)
  const rows = [
    <tr key={suiteId} style={{ cursor: hasDetails ? 'pointer' : 'default' }} onClick={() => {
      if (!hasDetails) return
      const newExpanded = new Set(expandedMetricSuites)
      if (isExpanded) newExpanded.delete(suiteId)
      else newExpanded.add(suiteId)
      setExpandedMetricSuites(newExpanded)
    }}>
      {isColumnVisible('suites', 'suite') && (
      <td className="text-center">
        {hasDetails && (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
      </td>
      )}
      {isColumnVisible('suites', 'suite') && (
      <td className="fw-bold" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
        {data.nombre}
        {data.breadcrumb && data.breadcrumb !== data.nombre && (
          <div className="x-small text-muted fw-normal">{data.breadcrumb}</div>
        )}
      </td>
      )}
      {isColumnVisible('suites', 'total') && <td className="text-center">{data.total}</td>}
      {isColumnVisible('suites', 'passed') && <td className="text-center text-success fw-bold">{data.pasados}</td>}
      {isColumnVisible('suites', 'failed') && <td className="text-center text-danger fw-bold">{data.fallados}</td>}
      {isColumnVisible('suites', 'blocked') && <td className="text-center text-primary fw-bold">{data.bloqueados}</td>}
      {isColumnVisible('suites', 'pending') && <td className="text-center text-secondary fw-bold">{data.pendientes || 0}</td>}
      {isColumnVisible('suites', 'successExecuted') && (
      <td className="text-center">
        <Badge bg={parseFloat(tasaExito) >= 80 ? 'success' : parseFloat(tasaExito) >= 50 ? 'warning' : 'danger'}>
          {tasaExito}%
        </Badge>
      </td>
      )}
      {isColumnVisible('suites', 'coverage') && <td className="text-center">{formatPercent(data.cobertura_porcentaje)}</td>}
      {isColumnVisible('suites', 'successTotal') && <td className="text-center">{formatPercent(data.exito_sobre_total_porcentaje)}</td>}
      {isColumnVisible('suites', 'bugs') && <td className="text-center">{formatInt(data.bugs_abiertos)}</td>}
      {isColumnVisible('suites', 'risk') && <td className="text-center"><Badge bg={riskVariant(data.riesgo)}>{data.riesgo || 'BAJO'}</Badge></td>}
      {isColumnVisible('suites', 'lastExecution') && <td className="text-center small">{data.ultima_ejecucion ? formatDateTime(data.ultima_ejecucion) : 'N/D'}</td>}
      {isColumnVisible('suites', 'time') && <td className="text-center small">{formatHours(data.duracion_horas)}</td>}
    </tr>
  ]

  if (isExpanded) {
    rows.push(...(data.casos || []).map((caso: any) => {
      const failedSnapshot = (caso.snapshots || []).find((snapshot: any) => ['FALLO', 'BLOQUEADO'].includes(String(snapshot.estado_paso || '').toUpperCase()))
      const linkedCaseBugs = Array.isArray(caso.bugs) ? caso.bugs : []
      const snapshotBug = failedSnapshot ? snapshotBugLinks[failedSnapshot.id] : null
      const visibleCaseBugs = snapshotBug && !linkedCaseBugs.some((bug: any) => String(bug.id) === String(snapshotBug.id))
        ? [...linkedCaseBugs, snapshotBug]
        : linkedCaseBugs
      const hasLinkedBugForFailure = visibleCaseBugs.length > 0
      return (
      <tr key={`${suiteId}-${caso.id}`} className="bg-light">
        {isColumnVisible('suites', 'suite') && <td></td>}
        <td colSpan={visibleColumnCount('suites')}>
          <div className="d-flex align-items-start gap-3 py-2 px-3" style={{ paddingLeft: `${depth * 24 + 16}px` }}>
            <Badge bg={caso.estado === 'PASO' ? 'success' : caso.estado === 'FALLO' ? 'danger' : caso.estado === 'BLOQUEADO' ? 'primary' : 'secondary'} className="mt-1">
              {caso.estado}
            </Badge>
            <div className="flex-grow-1">
              <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <span className="font-monospace fw-bold text-primary x-small">{caso.codigo}</span>
                <span className="fw-bold text-dark">{caso.titulo}</span>
                {(() => {
                  const priority = getBugPriorityPresentation(caso.prioridad)
                  return (
                    <Badge bg={priority?.bg || 'light'} text={priority?.text || 'dark'} title={priority?.title || String(caso.prioridad || '')} className={`x-small ${priority?.bg === 'light' || !priority ? 'border' : ''}`}>
                      {priority?.shortLabel || caso.prioridad}
                    </Badge>
                  )
                })()}
                <Badge bg="light" text="dark" className="border x-small">{caso.tipo_prueba === 'AUTOMATIZADA_AI' ? 'IA' : caso.tipo_prueba === 'AUTOMATIZADA' ? 'AUTO' : 'MANUAL'}</Badge>
                <Badge bg={caso.execution_mode === 'IA' ? 'primary' : caso.execution_mode === 'AUTOMATIZADA' ? 'info' : caso.execution_mode === 'EXTERNA' ? 'success' : 'secondary'} className="x-small">
                  Ejec. {caso.execution_mode === 'IA' ? 'IA' : caso.execution_mode === 'AUTOMATIZADA' ? 'Auto' : caso.execution_mode === 'EXTERNA' ? 'Externa' : 'Manual'}
                </Badge>
                {caso.review_status === 'REQUIERE_REVISION' && <Badge bg="warning" text="dark" className="x-small">{t('reportes.revisionIaPending')}</Badge>}
                {caso.review_status === 'REVISADA' && <Badge bg="success" className="x-small">{t('reportes.iaReviewed')}</Badge>}
                {caso.ai?.error_code && <Badge bg="danger" className="x-small">{caso.ai.error_code}</Badge>}
              </div>
              <div className="x-small text-muted mb-1">{caso.suite_breadcrumb || data.breadcrumb || data.nombre}</div>
              {caso.descripcion && <p className="x-small text-muted mb-1">{caso.descripcion}</p>}
              <div className="d-flex gap-3 x-small text-muted flex-wrap">
                {caso.fecha_ejecucion && (
                  <span>
                    <Clock size={12} className="me-1" />
                    {formatDateTime(caso.fecha_ejecucion, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {caso.ejecutado_por && (
                  <span>
                    <User size={12} className="me-1" />
                    {caso.ejecutado_por}
                  </span>
                )}
                {caso.duracion_segundos > 0 && (
                  <span>
                    <Activity size={12} className="me-1" />
                    {caso.duracion_segundos}s
                  </span>
                )}
                <span>v{caso.version_ejecutada}</span>
              </div>
              {caso.observaciones && (
                <div className="mt-1 x-small text-secondary fst-italic">"{caso.observaciones}"</div>
              )}
              {renderEvidenceList(caso)}
              {visibleCaseBugs.length > 0 && (
                <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                  {visibleCaseBugs.map((bug: any) => (
                    <Badge
                      key={bug.id || bug.codigo}
                      bg={bugStatusIsOpen(bug.estado) || bug.is_open ? 'danger' : 'secondary'}
                      className="px-3 py-2"
                      title={bug.titulo || bug.estado || ''}
                    >
                      <Bug size={13} className="me-1" />
                      {bug.codigo}
                      {bug.estado && <span className="ms-1">· {bug.estado}</span>}
                    </Badge>
                  ))}
                  <span className="x-small text-muted">{t('reportes.bugLink')}</span>
                </div>
              )}
              {failedSnapshot && canCreateBugs && !hasLinkedBugForFailure && (
                <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                  <Button
                    size="sm"
                    variant="outline-danger"
                    disabled={creatingSnapshotBugId === failedSnapshot.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      createBugFromReportSnapshot(failedSnapshot)
                    }}
                  >
                    <Bug size={14} className="me-1" />
                    {creatingSnapshotBugId === failedSnapshot.id ? t('reportes.creatingBug') : t('reportes.createBug')}
                  </Button>
                  <span className="x-small text-muted">{t('reportes.bugFromSnapshot')}</span>
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>
      )
    }))
    rows.push(...renderSuiteRows(data.children || [], depth + 1))
  }

  return rows
})


  return renderSuiteRows(nodes, depth)
}
