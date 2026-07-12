import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react'
import { Badge, Button, Card, Col, Form, ListGroup, Modal, Row, Spinner } from 'react-bootstrap'
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Eye,
  ImagePlus,
  Info,
  LayoutList,
  PlayCircle,
  RefreshCw,
  Save,
  Terminal,
  User,
  XCircle
} from 'lucide-react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { EvidenceUpload } from '../../EvidenceUpload'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../../shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { getStatusColor, normalizeExecutionHistory } from '../ejecucion/executionUtils'

type ConsolaManualPageProps = {
  selectedTest: any
  activeExecutionTests: any[]
  currentExecutionRun: any
  currentExecutionCase: any
  executionSnapshots: any[]
  snapshotNotes: Record<number, string>
  snapshotAttachments: Record<string, AttachmentMeta[]>
  generalExecutionSnapshot: any
  generalExecutionAttachments: AttachmentMeta[]
  generalExecutionStatus: string
  setGeneralExecutionStatus: Dispatch<SetStateAction<string>>
  generalExecutionNote: string
  setGeneralExecutionNote: Dispatch<SetStateAction<string>>
  attachmentConfig: any
  returnToExecutionList: () => void
  handleSelectTestForExecution: (test: any) => void
  getExecutionReferenceCount: () => number
  getSnapshotStatus: (snapshot: any) => string
  getSnapshotReferences: (snapshot: any, type: 'action' | 'expected') => AttachmentMeta[]
  renderCaseReferences: (title: string, references?: AttachmentMeta[]) => ReactNode
  handleSnapshotStatusChange: (snapshot: any, status: string) => void
  handleSnapshotNoteChange: (stepNumber: number, value: string) => void
  handleSnapshotNoteBlur: (snapshot: any) => void
  handleSnapshotAttachmentUpload: (snapshot: any, attachment: AttachmentMeta) => void
  handleRemoveSnapshotAttachment: (snapshot: any, attachment: AttachmentMeta) => void
  handleGeneralExecutionAttachmentUpload: (attachment: AttachmentMeta) => void
  handleRemoveGeneralExecutionAttachment: (attachment: AttachmentMeta) => void
  getExecutionCompletionPlan: () => any
  handleCompleteCase: () => void
  relatedCaseBugs?: any[]
  relatedCaseBugsLoading?: boolean
  currentComponentName?: string
  onRefreshRelatedBugs?: () => Promise<any> | void
  onLinkExecutionToBug?: (bug: any, comentario?: string) => Promise<any> | void
  onViewRelatedBug?: (bug: any) => void
  onCreateInternalBugFromExecution?: () => Promise<any> | void
  creatingInternalBugContextId?: string | null
  setZoomImage: Dispatch<SetStateAction<string | null>>
}

export function ConsolaManualPage({
  selectedTest,
  activeExecutionTests,
  currentExecutionRun,
  currentExecutionCase,
  executionSnapshots,
  snapshotNotes,
  snapshotAttachments,
  generalExecutionSnapshot,
  generalExecutionAttachments,
  generalExecutionStatus,
  setGeneralExecutionStatus,
  generalExecutionNote,
  setGeneralExecutionNote,
  attachmentConfig,
  returnToExecutionList,
  handleSelectTestForExecution,
  getExecutionReferenceCount,
  getSnapshotStatus,
  getSnapshotReferences,
  renderCaseReferences,
  handleSnapshotStatusChange,
  handleSnapshotNoteChange,
  handleSnapshotNoteBlur,
  handleSnapshotAttachmentUpload,
  handleRemoveSnapshotAttachment,
  handleGeneralExecutionAttachmentUpload,
  handleRemoveGeneralExecutionAttachment,
  getExecutionCompletionPlan,
  handleCompleteCase,
  relatedCaseBugs = [],
  relatedCaseBugsLoading = false,
  currentComponentName = '',
  onRefreshRelatedBugs,
  onLinkExecutionToBug,
  onViewRelatedBug,
  onCreateInternalBugFromExecution,
  creatingInternalBugContextId,
  setZoomImage
}: ConsolaManualPageProps) {
  const [linkingBug, setLinkingBug] = useState<any | null>(null)
  const [linkComment, setLinkComment] = useState('')
  const [linkingBugId, setLinkingBugId] = useState<string | null>(null)
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const [validationSequenceHeight, setValidationSequenceHeight] = useState<number | null>(null)
  const [collapsedLeftSections, setCollapsedLeftSections] = useState({
    details: false,
    bugs: false,
    history: false,
  })
  const validationSequenceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setCollapsedLeftSections({ details: false, bugs: false, history: false })
    const handle = window.setTimeout(() => {
      validationSequenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(handle)
  }, [selectedTest?.id])

  useEffect(() => {
    const element = validationSequenceRef.current
    if (!element) return
    const updateHeight = () => setValidationSequenceHeight(Math.ceil(element.getBoundingClientRect().height))
    updateHeight()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight)
      return () => window.removeEventListener('resize', updateHeight)
    }
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    window.addEventListener('resize', updateHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [selectedTest?.id, executionSnapshots.length])

  const resolvedDataset = currentExecutionRun?.datasets_resueltos?.[selectedTest?.id] || []
  const runVariables = currentExecutionRun?.variables_resueltas || {}
  const hasPlaceholder = (value: string) => /\{\{[^}]+\}\}/.test(value || '')
  const resolvePlaceholders = (value: string) => String(value || '').replace(/\{\{([^}]+)\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim()
    return runVariables[key] ?? match
  })
  const executionDataRows = (() => {
    const rows = new Map<string, string>()
    resolvedDataset.forEach((item: any) => {
      const key = String(item?.key || '').trim()
      const value = String(item?.value ?? '').trim()
      if (!key) return
      const current = rows.get(key)
      if (!current) {
        rows.set(key, value)
        return
      }
      if (hasPlaceholder(current) && !hasPlaceholder(value)) {
        rows.set(key, value)
        return
      }
      if (!hasPlaceholder(value)) rows.set(key, value)
    })
    return Array.from(rows.entries())
      .filter(([, value]) => value && !hasPlaceholder(value))
      .map(([key, value]) => ({ key, value }))
  })()
  const renderTextBlock = (label: string, value: string, fallback: string) => (
    <div className="mb-3">
      <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>{label}</div>
      <div className={`small ${value ? 'text-dark' : 'text-muted'}`}>{value || fallback}</div>
    </div>
  )
  const renderExecutionDataRows = () => (
    <div className="bg-light rounded border shadow-sm overflow-hidden">
      <div className="px-2 py-1 border-bottom bg-white text-dark x-small">
        Ambiente: <span className="text-primary fw-semibold">{currentExecutionRun?.entorno || 'Sin ambiente'}</span>
      </div>
      {executionDataRows.length > 0 ? (
        <div className="table-responsive">
          <table className="table table-sm mb-0 align-middle x-small">
            <tbody>
              {executionDataRows.map(item => (
                <tr key={item.key}>
                  <td className="text-secondary fw-semibold font-monospace border-0 py-1 ps-2" style={{ width: '42%' }}>{item.key}</td>
                  <td className="text-primary font-monospace border-0 py-1 pe-2 text-break">{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-2 x-small text-muted">Sin datos resueltos para esta ejecucion.</div>
      )}
    </div>
  )
  const openAttachmentEvidence = (attachment: AttachmentMeta) => {
    setViewerEvidence({
      url: attachment.public_url,
      filename: attachment.filename_original,
      contentType: attachment.content_type,
      available: attachment.available,
      missing_reason: attachment.missing_reason,
    })
  }
  const openLegacyEvidence = (url?: string | null) => {
    if (!url) return
    setViewerEvidence({ url, filename: 'Evidencia adjunta', contentType: null })
  }
  const requireFailureDocumentation = attachmentConfig?.require_evidence_on_failure === true
  const isEvidenceRequiredStatus = (status?: string) => status === 'FALLO' || status === 'BLOQUEADO'
  const isAutoBlockNote = (value?: string) =>
    String(value || '').trim().toLowerCase().startsWith('bloqueado autom')
  const hasUserDocumentationNote = (value?: string) => {
    const note = String(value || '').trim()
    return Boolean(note && !isAutoBlockNote(note))
  }
  const completionPlan = getExecutionCompletionPlan()
  const closedBugStates = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])
  const conclusiveSnapshot = completionPlan.firstConclusive?.snapshot
  const conclusiveStatus = completionPlan.firstConclusive?.status
  const executionBugStatus = completionPlan.finalStatus || currentExecutionCase?.estado_resultado || generalExecutionStatus
  const canLinkCurrentExecution = Boolean(
    currentExecutionCase?.id &&
    (executionBugStatus === 'FALLO' || executionBugStatus === 'BLOQUEADO')
  )
  const isBugLinkedToCurrentExecution = (bug: any) => {
    const executionId = String(currentExecutionCase?.id || '')
    const snapshotId = String((conclusiveSnapshot || generalExecutionSnapshot)?.id || '')
    if (!executionId) return false
    if (String(bug?.ejecucion_id || '') === executionId) return true
    if (snapshotId && String(bug?.snapshot_id || '') === snapshotId) return true
    const occurrences = bug?.metadata_json?.linked_execution_occurrences || []
    return Array.isArray(occurrences) && occurrences.some((item: any) => (
      String(item?.ejecucion_id || '') === executionId ||
      (snapshotId && String(item?.snapshot_id || '') === snapshotId)
    ))
  }
  const getBugDisplayBuild = (bug: any) => (
    bug?._display_build_name ||
    bug?.version_app ||
    bug?.metadata_json?.build_name ||
    bug?.build_name ||
    bug?.build_code ||
    bug?.metadata_json?.build_code ||
    'Build origen no registrada'
  )
  const getBugDisplayComponent = (bug: any) => (
    bug?._display_component_name ||
    bug?.modulo_funcional ||
    bug?.metadata_json?.component_name ||
    ''
  )
  const handleConfirmLinkBug = async () => {
    if (!linkingBug || !onLinkExecutionToBug) return
    setLinkingBugId(linkingBug.id)
    try {
      const updated = await onLinkExecutionToBug(linkingBug, linkComment)
      if (updated) {
        setLinkingBug(null)
        setLinkComment('')
        await onRefreshRelatedBugs?.()
      }
    } finally {
      setLinkingBugId(null)
    }
  }
  const conclusiveStepNote = conclusiveSnapshot ? snapshotNotes[conclusiveSnapshot.numero_paso] : ''
  const selectedTestComponentLabel = (() => {
    const rawComponent = String(selectedTest?.component || '').trim()
    if (rawComponent && rawComponent !== 'Componente no encontrado') return rawComponent
    const rawCurrentComponent = String(currentComponentName || '').trim()
    if (rawCurrentComponent) return rawCurrentComponent
    return rawComponent || 'Sin componente asignado'
  })()
  const hasConclusiveStepDocumentation = Boolean(
    hasUserDocumentationNote(conclusiveStepNote) ||
    (conclusiveSnapshot?.id && (snapshotAttachments[conclusiveSnapshot.id] || []).length > 0) ||
    conclusiveSnapshot?.evidencia_url
  )
  const hasGeneralDocumentation = Boolean(
    generalExecutionNote.trim() ||
    generalExecutionAttachments.length > 0 ||
    generalExecutionSnapshot?.evidencia_url
  )
  const stepDocumentationMissing = Boolean(
    requireFailureDocumentation &&
    executionSnapshots.length > 0 &&
    conclusiveSnapshot?.id &&
    isEvidenceRequiredStatus(conclusiveStatus) &&
    !hasConclusiveStepDocumentation
  )
  const generalDocumentationMissing = Boolean(
    requireFailureDocumentation &&
    executionSnapshots.length === 0 &&
    isEvidenceRequiredStatus(generalExecutionStatus) &&
    !hasGeneralDocumentation
  )
  const evidenceBlockMessage = generalDocumentationMissing || stepDocumentationMissing
    ? 'Falta documentar la falla o bloqueo: agrega un comentario o adjunta evidencia.'
      : ''
  const statusBlocksCompletion = executionSnapshots.length === 0
    ? (!generalExecutionStatus || generalExecutionStatus === 'SIN_CORRER')
    : !completionPlan.canComplete
  const finishDisabled = statusBlocksCompletion || Boolean(evidenceBlockMessage)
  const executionHistory = normalizeExecutionHistory(selectedTest)
  const latestHistoryItem = executionHistory[0]
  const latestRelatedBug = relatedCaseBugs[0]
  const leftColumnStyle: CSSProperties = {
    maxHeight: validationSequenceHeight ? `${validationSequenceHeight}px` : undefined,
    overflow: validationSequenceHeight ? 'hidden' : undefined,
    minHeight: 0,
  }
  const leftSectionStyle = (collapsed: boolean, flexValue = '1 1 0px'): CSSProperties => ({
    flex: collapsed ? '0 0 auto' : flexValue,
    minHeight: collapsed ? undefined : 0,
  })
  const expandedSectionBodyStyle: CSSProperties = {
    overflow: 'auto',
    minHeight: 0,
  }
  const toggleLeftSection = (section: keyof typeof collapsedLeftSections) => {
    setCollapsedLeftSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  return (
    <>
    <div className="manual-console-shell h-100 d-flex flex-column animate__animated animate__fadeIn text-start bg-light">
      <div className="manual-console-header p-3 bg-white border-bottom d-flex justify-content-between align-items-center shadow-sm flex-shrink-0 z-1">
        <div className="d-flex align-items-center gap-3 text-dark">
          <Button variant="light" size="sm" onClick={returnToExecutionList} className="border shadow-sm rounded-circle p-1 hover-bg-dark hover-text-white transition-all">
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h5 className="m-0 fw-bold text-dark d-flex align-items-center gap-2">
              <PlayCircle size={22} className="text-primary"/> Consola de Ejecución Manual
            </h5>
            {currentExecutionRun && (
              <span className="x-small text-muted font-monospace d-flex align-items-center gap-1 mt-1">
                <Terminal size={12}/> Run Activo: {currentExecutionRun.nombre}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="manual-console-main flex-grow-1 d-flex overflow-hidden">
        <div className="manual-console-sidebar bg-white border-end d-flex flex-column flex-shrink-0 z-0" style={{ width: '290px' }}>
          <div className="p-3 bg-light border-bottom">
            <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
              <LayoutList size={16} className="text-primary"/> Lote de Ejecución
            </h6>
            <div className="text-muted x-small mt-1">{activeExecutionTests.length} casos seleccionados para este ciclo</div>
          </div>
          <ListGroup variant="flush" className="overflow-auto flex-grow-1 pb-4">
            {activeExecutionTests.map(test => {
              const isActive = selectedTest.id === test.id
              const currentStatus = test.id === selectedTest.id && currentExecutionCase ? (currentExecutionCase.estado_resultado || 'EN CURSO') : (test.lastResult || 'PENDIENTE')
              return (
                <ListGroup.Item
                  key={test.id}
                  action
                  active={isActive}
                  onClick={() => handleSelectTestForExecution(test)}
                  className={`border-bottom p-3 cursor-pointer ${isActive ? 'bg-primary bg-opacity-10 border-start border-4 border-primary' : 'hover-bg-light'}`}
                >
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className={`font-monospace fw-bold x-small ${isActive ? 'text-primary' : 'text-secondary'}`}>
                      {test.code || test.id.slice(0, 8).toUpperCase()}
                    </span>
                    <Badge bg={currentStatus === 'EN CURSO' ? 'info' : getStatusColor(currentStatus)} className="x-small" style={{ fontSize: '9px' }}>
                      {currentStatus}
                    </Badge>
                  </div>
                  <div className={`small fw-semibold text-truncate ${isActive ? 'text-dark' : 'text-muted'}`} title={test.title}>
                    {test.title}
                  </div>
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <Badge bg="light" text="dark" className="border x-small">{isActive ? executionSnapshots.length : (test.stepsCount || 0)} pasos</Badge>
                    {isActive && getExecutionReferenceCount() > 0 && (
                      <Badge bg="light" text="primary" className="border x-small">
                        {getExecutionReferenceCount()} refs.
                      </Badge>
                    )}
                  </div>
                </ListGroup.Item>
              )
            })}
          </ListGroup>
        </div>

        <div className="manual-console-content flex-grow-1 overflow-auto p-4">
          <Row className="g-4">
            <Col xl={3} lg={4} className="d-flex flex-column gap-3" style={leftColumnStyle}>
              <Card className="border-0 shadow-sm rounded-4 bg-white d-flex flex-column overflow-hidden" style={leftSectionStyle(collapsedLeftSections.details, '1 1 0px')}>
                <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center gap-2">
                  <div className="min-w-0">
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><Info size={18} className="text-primary"/> Detalles del Caso</h6>
                    {collapsedLeftSections.details && (
                      <div className="x-small text-muted text-truncate mt-1" title={`${selectedTest.code || selectedTest.id} · ${selectedTest.title} · ${selectedTestComponentLabel}`}>
                        {selectedTest.code || selectedTest.id} · {selectedTest.title} · {selectedTestComponentLabel}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="light"
                    size="sm"
                    className="border p-1 flex-shrink-0"
                    aria-label={collapsedLeftSections.details ? 'Expandir detalles del caso' : 'Compactar detalles del caso'}
                    title={collapsedLeftSections.details ? 'Expandir' : 'Compactar'}
                    onClick={() => toggleLeftSection('details')}
                  >
                    {collapsedLeftSections.details ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </Button>
                </Card.Header>
                {!collapsedLeftSections.details && (
                  <Card.Body className="p-3 flex-grow-1" style={expandedSectionBodyStyle}>
                    {renderTextBlock('Objetivo / descripcion', selectedTest.description || '', 'Sin objetivo documentado.')}
                    {renderTextBlock('Precondiciones', selectedTest.pre || '', 'Ninguna precondicion especificada.')}
                    {renderTextBlock('Postcondiciones', selectedTest.post || '', 'Ninguna postcondicion especificada.')}
                    <div className="mb-3">
                      <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>Datos usados en esta ejecucion</div>
                      {renderExecutionDataRows()}
                    </div>
                    <div>
                      <div className="x-small fw-bold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.5px' }}>Componente Afectado</div>
                      <Badge bg="light" text="dark" className="border shadow-sm">{selectedTestComponentLabel}</Badge>
                    </div>
                  </Card.Body>
                )}
              </Card>

              <Card className="border-0 shadow-sm rounded-4 bg-white d-flex flex-column overflow-hidden" style={leftSectionStyle(collapsedLeftSections.bugs, '1 1 0px')}>
                <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center gap-2">
                  <div className="min-w-0">
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                      <Bug size={18} className="text-danger"/> Bugs relacionados
                    </h6>
                    {collapsedLeftSections.bugs && (
                      <div className="x-small text-muted text-truncate mt-1" title={latestRelatedBug ? `${latestRelatedBug.codigo} · ${latestRelatedBug.estado}` : 'Sin bugs relacionados'}>
                        {latestRelatedBug ? `${latestRelatedBug.codigo} · ${latestRelatedBug.estado}` : 'Sin bugs relacionados'}
                      </div>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    <Badge bg="light" text="danger" className="border shadow-sm">
                      {relatedCaseBugs.length || (relatedCaseBugsLoading ? '...' : 0)}
                    </Badge>
                    <Button
                      variant="light"
                      size="sm"
                      className="border p-1"
                      aria-label={collapsedLeftSections.bugs ? 'Expandir bugs relacionados' : 'Compactar bugs relacionados'}
                      title={collapsedLeftSections.bugs ? 'Expandir' : 'Compactar'}
                      onClick={() => toggleLeftSection('bugs')}
                    >
                      {collapsedLeftSections.bugs ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </Button>
                  </div>
                </Card.Header>
                {!collapsedLeftSections.bugs && (
                  <Card.Body className="p-3 flex-grow-1" style={expandedSectionBodyStyle}>
                    {relatedCaseBugsLoading && relatedCaseBugs.length > 0 && (
                      <div className="d-flex align-items-center gap-2 text-muted x-small mb-2">
                        <Spinner animation="border" size="sm" /> Actualizando...
                      </div>
                    )}
                    {relatedCaseBugsLoading && relatedCaseBugs.length === 0 && (
                      <div className="d-flex align-items-center gap-2 text-muted x-small">
                        <Spinner animation="border" size="sm" /> Cargando bugs...
                      </div>
                    )}
                    {!relatedCaseBugsLoading && relatedCaseBugs.length === 0 && (
                      <div className="text-muted x-small">Sin bugs relacionados.</div>
                    )}
                    {relatedCaseBugs.length > 0 && (
                      <div className="d-flex flex-column gap-2">
                        {relatedCaseBugs.slice(0, 4).map((bugItem: any) => {
                          const closed = closedBugStates.has(String(bugItem.estado || '').toUpperCase())
                          const linked = isBugLinkedToCurrentExecution(bugItem)
                          return (
                            <div key={bugItem.id || bugItem.codigo} className="border rounded-3 p-2 bg-light">
                              <div className="d-flex justify-content-between align-items-start gap-2">
                                <div className="min-w-0">
                                  <div className="d-flex align-items-center gap-2 flex-wrap">
                                    <span className="fw-bold text-dark x-small">{bugItem.codigo}</span>
                                    <Badge bg={closed ? 'secondary' : 'danger'} className="x-small">
                                      {closed ? 'CERRADO' : bugItem.estado}
                                    </Badge>
                                  </div>
                                  <div className="x-small text-dark text-truncate mt-1" title={bugItem.titulo}>{bugItem.titulo}</div>
                                  <div className="x-small text-muted mt-1">
                                    {getBugDisplayBuild(bugItem)}
                                    {getBugDisplayComponent(bugItem) ? ` · ${getBugDisplayComponent(bugItem)}` : ''}
                                  </div>
                                </div>
                                <div className="d-flex align-items-center justify-content-end gap-1 flex-wrap flex-shrink-0">
                                  <Button
                                    variant="outline-secondary"
                                    size="sm"
                                    className="x-small fw-bold py-1 px-2"
                                    disabled={!onViewRelatedBug}
                                    title="Ver detalle del bug"
                                    onClick={() => onViewRelatedBug?.(bugItem)}
                                  >
                                    <Eye size={12} /> Ver
                                  </Button>
                                  {linked ? (
                                    <Badge bg="success" className="x-small">Actualizado</Badge>
                                  ) : (
                                    <Button
                                      variant="outline-danger"
                                      size="sm"
                                      className="x-small fw-bold py-1 px-2"
                                      disabled={!canLinkCurrentExecution || !onLinkExecutionToBug || Boolean(creatingInternalBugContextId)}
                                      title={canLinkCurrentExecution ? 'Registrar que este bug sigue ocurriendo en esta build' : 'Guarda primero una ejecución fallida o bloqueada'}
                                      onClick={() => {
                                        setLinkingBug(bugItem)
                                        setLinkComment('')
                                      }}
                                    >
                                      <RefreshCw size={12} /> Actualizar
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {canLinkCurrentExecution && (
                      <div className="d-flex gap-2 flex-wrap mt-3">
                        {relatedCaseBugs.length > 0 && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            className="fw-bold x-small"
                            onClick={() => {
                              setLinkingBug(relatedCaseBugs[0])
                              setLinkComment('')
                            }}
                            disabled={!onLinkExecutionToBug || Boolean(creatingInternalBugContextId) || relatedCaseBugs.every(isBugLinkedToCurrentExecution)}
                          >
                            <RefreshCw size={13} /> Actualizar seguimiento
                          </Button>
                        )}
                        {onCreateInternalBugFromExecution && (
                          <Button
                            variant="danger"
                            size="sm"
                            className="fw-bold x-small"
                            onClick={() => onCreateInternalBugFromExecution()}
                            disabled={Boolean(creatingInternalBugContextId)}
                          >
                            <Bug size={13} /> Crear bug nuevo
                          </Button>
                        )}
                      </div>
                    )}
                  </Card.Body>
                )}
              </Card>

              <Card className="border-0 shadow-sm rounded-4 bg-white d-flex flex-column overflow-hidden" style={leftSectionStyle(collapsedLeftSections.history, '2 1 0px')}>
                <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center gap-2">
                  <div className="min-w-0">
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2"><History size={18} className="text-secondary"/> Historial Detallado</h6>
                    {collapsedLeftSections.history && (
                      <div className="x-small text-muted text-truncate mt-1" title={latestHistoryItem ? `${latestHistoryItem.status} · ${latestHistoryItem.date}` : 'Sin ejecuciones previas'}>
                        {latestHistoryItem ? `Último: ${latestHistoryItem.status} · ${latestHistoryItem.date}` : 'Sin ejecuciones previas'}
                      </div>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    <Badge bg="light" text="secondary" className="border shadow-sm">{executionHistory.length}</Badge>
                    <Button
                      variant="light"
                      size="sm"
                      className="border p-1"
                      aria-label={collapsedLeftSections.history ? 'Expandir historial detallado' : 'Compactar historial detallado'}
                      title={collapsedLeftSections.history ? 'Expandir' : 'Compactar'}
                      onClick={() => toggleLeftSection('history')}
                    >
                      {collapsedLeftSections.history ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </Button>
                  </div>
                </Card.Header>
                {!collapsedLeftSections.history && (
                  <Card.Body className="p-0 flex-grow-1" style={expandedSectionBodyStyle}>
                    <ListGroup variant="flush">
                      {executionHistory.map((historyItem: any, index: number) => (
                      <ListGroup.Item key={index} className="p-3 bg-transparent border-light-subtle">
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <Badge bg={getStatusColor(historyItem.status)} className="x-small shadow-sm">{historyItem.status?.toUpperCase()}</Badge>
                          <span className="x-small text-muted font-monospace">{historyItem.date}</span>
                        </div>

                        <div className="bg-light p-2 rounded-2 border border-light-subtle x-small mb-2">
                          {(historyItem.status === 'FALLO' || historyItem.status === 'FALLIDO') && (
                            <div className="text-danger fw-bold mb-1 d-flex align-items-center gap-1">
                              <XCircle size={12}/> {historyItem.failedStep ? `Falló en el paso ${historyItem.failedStep}` : 'Fallo de validación'}
                            </div>
                          )}

                          <div className="text-dark mb-1">
                            {historyItem.observation || (historyItem.status === 'FALLO' || historyItem.status === 'FALLIDO'
                              ? (relatedCaseBugs.length > 0 ? 'Este caso tiene bugs relacionados; puedes actualizar el seguimiento de esta build.' : 'Incidencia detectada. Sin bug interno asociado a esta ejecución.')
                              : 'Ejecución completada sin incidencias estructurales.')}
                          </div>

                          {(historyItem.evidenceUrl || historyItem.evidencias?.length > 0) && (
                            <div className="mt-2 pt-2 border-top border-light-subtle">
                              {historyItem.evidencias?.length > 0 ? (
                                <div className="d-flex flex-wrap gap-2">
                                  {historyItem.evidencias.map((attachment: AttachmentMeta) => (
                                    isEvidenceAvailable(attachment) && isImageAsset(attachment) ? (
                                      <button
                                        type="button"
                                        key={attachment.id}
                                        className="border rounded-2 bg-white p-0"
                                        title={attachment.filename_original}
                                        onClick={() => openAttachmentEvidence(attachment)}
                                      >
                                        <img src={resolveAssetUrl(attachment.public_url)} alt={attachment.filename_original} className="rounded-2" style={{ width: 40, height: 40, objectFit: 'cover' }} />
                                      </button>
                                    ) : (
                                      <Button key={attachment.id} variant={isEvidenceAvailable(attachment) ? 'link' : 'outline-warning'} size="sm" className={`${isEvidenceAvailable(attachment) ? 'p-0' : 'py-0 px-1'} x-small text-decoration-none d-flex align-items-center gap-1 fw-bold`} onClick={() => openAttachmentEvidence(attachment)}>
                                        <FileText size={14}/> {attachment.filename_original || 'Ver evidencia'}
                                        {!isEvidenceAvailable(attachment) && <Badge bg="warning" text="dark">Archivo no disponible</Badge>}
                                      </Button>
                                    )
                                  ))}
                                </div>
                              ) : (
                                <Button variant="link" size="sm" className="p-0 x-small text-decoration-none d-flex align-items-center gap-1 fw-bold" onClick={() => openLegacyEvidence(historyItem.evidenceUrl)}>
                                  <ImagePlus size={14}/> Ver evidencia adjunta
                                </Button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="d-flex justify-content-between align-items-center mt-2">
                          {historyItem.executedBy ? (
                            <div className="x-small text-dark d-flex align-items-center gap-1">
                              <User size={12} className="text-primary"/> <span className="fw-semibold">{historyItem.executedBy}</span>
                            </div>
                          ) : <span className="x-small text-muted">Auto</span>}
                          {historyItem.duration && (
                            <div className="x-small text-muted d-flex align-items-center gap-1">
                              <Clock size={12}/> {historyItem.duration}
                            </div>
                          )}
                        </div>
                      </ListGroup.Item>
                    ))}
                    {executionHistory.length === 0 && (
                      <div className="p-4 text-center text-muted x-small d-flex flex-column align-items-center gap-2">
                        <History size={24} className="opacity-25" />
                        <span>No hay ejecuciones previas registradas.</span>
                      </div>
                    )}
                  </ListGroup>
                </Card.Body>
                )}
              </Card>
            </Col>

            <Col xl={9} lg={8} className="d-flex flex-column">
              <Card ref={validationSequenceRef} className="border-0 shadow-sm rounded-4 overflow-hidden border-top border-4 border-primary flex-grow-1">
                <Card.Header className="bg-white border-bottom p-4 d-flex justify-content-between align-items-center">
                  <div>
                    <h5 className="fw-bold text-dark m-0 d-flex align-items-center gap-2 mb-1">
                      <CheckCircle2 size={22} className="text-success"/> Secuencia de Validación
                    </h5>
                    <span className="text-muted small">Ejecuta y documenta cada paso. Si un paso falla, el resto se bloqueará automáticamente.</span>
                  </div>
                  <Badge bg="primary" className="px-3 py-2 rounded-pill shadow-sm fs-6">
                    {executionSnapshots.length} Pasos
                  </Badge>
                </Card.Header>

                <Card.Body className="p-0 bg-light">
                  {executionSnapshots.map((snapshot, index) => {
                    const hasBlockingPreviousStep = executionSnapshots.slice(0, index).some(previous => {
                      const previousStatus = getSnapshotStatus(previous)
                      return !previousStatus || previousStatus === 'SIN_CORRER' || previousStatus === 'FALLO' || previousStatus === 'BLOQUEADO'
                    })
                    const isBlocked = index > 0 && hasBlockingPreviousStep
                    const currentResult = getSnapshotStatus(snapshot)
                    const hasFailed = currentResult === 'FALLO' || currentResult === 'BLOQUEADO'
                    const actionText = snapshot.accion_congelada || 'Sin acción definida'
                    const stepDataText = String(snapshot.datos_congelados || '').trim()
                    const rawResolvedStepData = String(snapshot.datos_resueltos || (stepDataText ? resolvePlaceholders(stepDataText) : '')).trim()
                    const resolvedStepDataText = rawResolvedStepData && rawResolvedStepData !== stepDataText && !hasPlaceholder(rawResolvedStepData)
                      ? rawResolvedStepData
                      : ''
                    const visibleStepDataText = resolvedStepDataText || stepDataText
                    const expectedText = snapshot.resultado_esperado_congelado || 'Sin resultado esperado definido'
                    const actionReferences = getSnapshotReferences(snapshot, 'action')
                    const expectedReferences = getSnapshotReferences(snapshot, 'expected')
                    const snapshotDocumentationMissing = Boolean(
                      requireFailureDocumentation &&
                      isEvidenceRequiredStatus(currentResult) &&
                      !hasUserDocumentationNote(snapshotNotes[snapshot.numero_paso]) &&
                      (snapshotAttachments[snapshot.id] || []).length === 0 &&
                      !snapshot.evidencia_url
                    )

                    return (
                      <div key={snapshot.id} className={`manual-console-step p-4 border-bottom bg-white transition-all ${isBlocked ? 'opacity-50' : ''}`}>
                        <div className="manual-console-step-main d-flex gap-3">
                          <div className="flex-shrink-0 mt-1">
                            <Badge bg={currentResult === 'PASO' ? 'success' : currentResult === 'FALLO' ? 'danger' : 'secondary'} className="rounded-circle p-2 fs-5 d-flex align-items-center justify-content-center shadow-sm" style={{width: '36px', height: '36px'}}>
                              {snapshot.numero_paso}
                            </Badge>
                          </div>

                          <div className="flex-grow-1">
                            <Row className="g-3">
                              <Col lg={stepDataText ? 5 : 6} md={stepDataText ? 5 : 6}>
                                <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Acción a ejecutar</div>
                                <div className={`small fw-bold bg-light p-3 rounded-3 border border-light-subtle ${snapshot.accion_congelada ? 'text-dark' : 'text-muted'}`}>
                                  {actionText}
                                </div>
                                {renderCaseReferences('Referencia del caso', actionReferences)}
                              </Col>
                              {visibleStepDataText && (
                                <Col lg={3} md={3}>
                                  <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Datos</div>
                                  <div
                                    className="small bg-white px-3 py-2 rounded-3 border border-success border-opacity-25 font-monospace text-primary text-break shadow-sm"
                                    style={{ minHeight: '44px', maxHeight: '96px', overflow: 'auto', whiteSpace: 'pre-wrap' }}
                                  >
                                    {visibleStepDataText}
                                  </div>
                                </Col>
                              )}
                              <Col lg={stepDataText ? 4 : 6} md={stepDataText ? 4 : 6}>
                                <div className="x-small fw-bold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.5px' }}>Resultado esperado</div>
                                <div className={`small p-3 rounded-3 border border-light-subtle bg-white ${snapshot.resultado_esperado_congelado ? 'text-secondary' : 'text-muted'}`}>
                                  {expectedText}
                                </div>
                                {renderCaseReferences('Referencia esperada', expectedReferences)}
                              </Col>
                            </Row>

                            <div className={`mt-4 p-3 rounded-4 border shadow-sm transition-all ${snapshotDocumentationMissing ? 'bg-danger bg-opacity-10 border-danger border-opacity-50' : 'bg-light border-light-subtle'}`}>
                              <Row className="g-3 align-items-start">
                                <Col md={3}>
                                  <Form.Label className="x-small fw-bold text-dark text-uppercase">Veredicto</Form.Label>
                                  <Form.Select
                                    size="sm"
                                    className={`fw-bold shadow-sm cursor-pointer border-2 p-2 ${currentResult === 'PASO' ? 'text-success border-success' : currentResult === 'FALLO' ? 'text-danger border-danger' : 'text-secondary border-secondary'}`}
                                    disabled={isBlocked}
                                    value={currentResult}
                                    onChange={(event) => handleSnapshotStatusChange(snapshot, event.target.value)}
                                  >
                                    <option value="SIN_CORRER">PENDIENTE</option>
                                    <option value="PASO">PASÓ</option>
                                    <option value="FALLO">FALLÓ</option>
                                    <option value="BLOQUEADO">BLOQUEADO</option>
                                  </Form.Select>
                                </Col>
                                <Col md={9}>
                                  <Form.Label className="x-small fw-bold text-dark text-uppercase d-flex justify-content-between w-100">
                                    <span>Observaciones / Evidencia de ejecución</span>
                                  </Form.Label>
                                  <Form.Control
                                    as="textarea"
                                    rows={2}
                                    size="sm"
                                    placeholder={hasFailed ? 'Detalla la falla encontrada y adjunta evidencia para Redmine...' : 'Notas opcionales del comportamiento...'}
                                    className={`shadow-sm text-dark ${snapshotDocumentationMissing ? 'bg-white border-danger' : 'bg-white border-light-subtle'}`}
                                    disabled={isBlocked}
                                    value={snapshotNotes[snapshot.numero_paso] || ''}
                                    onChange={(event) => handleSnapshotNoteChange(snapshot.numero_paso, event.target.value)}
                                    onBlur={() => handleSnapshotNoteBlur(snapshot)}
                                  />
                                  <div className="mt-2">
                                    <EvidenceUpload
                                      compact
                                      label="Adjuntar evidencia"
                                      uploadScope="EXECUTION_EVIDENCE"
                                      maxFileSize={attachmentConfig.max_file_size_mb}
                                      enablePaste={attachmentConfig.enable_clipboard_paste}
                                      disabled={isBlocked}
                                      currentEvidence={snapshot.evidencia_url}
                                      currentAttachments={snapshotAttachments[snapshot.id] || []}
                                      onUploadComplete={(attachment) => handleSnapshotAttachmentUpload(snapshot, attachment)}
                                      onRemoveAttachment={(attachment) => handleRemoveSnapshotAttachment(snapshot, attachment)}
                                    />
                                  </div>
                                  {snapshotDocumentationMissing && (
                                    <div className="text-danger fw-semibold x-small mt-2 d-flex align-items-center gap-1">
                                      <AlertCircle size={14} />
                                      Falta documentar la falla o bloqueo: agrega un comentario o adjunta evidencia.
                                    </div>
                                  )}
                                </Col>
                              </Row>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {executionSnapshots.length === 0 && (
                    <div className="p-5 bg-white">
                      <div className="d-flex align-items-start gap-3 mb-4">
                        <div className="bg-warning bg-opacity-10 p-3 rounded-circle border border-warning border-opacity-25">
                          <AlertCircle size={28} className="text-warning"/>
                        </div>
                        <div>
                          <h5 className="fw-bold text-dark mb-1">Ejecución sin pasos definidos</h5>
                          <p className="small text-muted mb-0">
                            Este caso no tiene pasos congelados. Puedes ejecutarlo como veredicto general del caso y completar los pasos más adelante desde "Añadir Pruebas".
                          </p>
                        </div>
                      </div>
                      <Row className="g-3">
                        <Col md={4}>
                          <Form.Label className="x-small fw-bold text-dark text-uppercase">Veredicto general</Form.Label>
                          <Form.Select
                            size="sm"
                            className="fw-bold shadow-sm border-2 p-2 text-dark"
                            value={generalExecutionStatus}
                            onChange={(event) => setGeneralExecutionStatus(event.target.value)}
                          >
                            <option value="SIN_CORRER">PENDIENTE</option>
                            <option value="PASO">PASO</option>
                            <option value="FALLO">FALLO</option>
                            <option value="BLOQUEADO">BLOQUEADO</option>
                          </Form.Select>
                        </Col>
                        <Col md={8}>
                          <Form.Label className="x-small fw-bold text-dark text-uppercase">Observación general</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={3}
                            size="sm"
                            className={`shadow-sm text-dark bg-white ${generalDocumentationMissing ? 'border-danger' : 'border-light-subtle'}`}
                            value={generalExecutionNote}
                            onChange={(event) => setGeneralExecutionNote(event.target.value)}
                            placeholder={generalExecutionStatus === 'FALLO' || generalExecutionStatus === 'BLOQUEADO' ? 'Describe la falla o bloqueo para mantener trazabilidad...' : 'Notas opcionales de la ejecución general...'}
                          />
                          {(requireFailureDocumentation && isEvidenceRequiredStatus(generalExecutionStatus)) && (
                            <div className={`mt-2 rounded-3 ${generalDocumentationMissing ? 'p-2 bg-danger bg-opacity-10 border border-danger border-opacity-25' : ''}`}>
                              <EvidenceUpload
                                compact
                                label="Adjuntar evidencia general"
                                uploadScope="EXECUTION_EVIDENCE"
                                maxFileSize={attachmentConfig.max_file_size_mb}
                                enablePaste={attachmentConfig.enable_clipboard_paste}
                                currentEvidence={generalExecutionSnapshot?.evidencia_url}
                                currentAttachments={generalExecutionAttachments}
                                onUploadComplete={handleGeneralExecutionAttachmentUpload}
                                onRemoveAttachment={handleRemoveGeneralExecutionAttachment}
                              />
                            </div>
                          )}
                          {generalDocumentationMissing && (
                            <div className="text-danger fw-semibold x-small mt-2 d-flex align-items-center gap-1">
                              <AlertCircle size={14} />
                              Falta documentar la falla o bloqueo: agrega un comentario o adjunta evidencia.
                            </div>
                          )}
                        </Col>
                      </Row>
                    </div>
                  )}
                </Card.Body>

                <Card.Footer className="manual-console-footer bg-white p-4 text-end border-top d-flex justify-content-between align-items-center gap-3">
                  <span className={`small fw-bold text-start ${evidenceBlockMessage ? 'text-danger' : 'text-muted'}`} style={{ minHeight: '20px' }}>
                    {evidenceBlockMessage || (requireFailureDocumentation
                      ? 'Si marcas FALLO o BLOQUEADO, agrega un comentario o adjunta evidencia.'
                      : 'Asegúrate de documentar evidencias si reportarás un Bug.')}
                  </span>
                  <Button
                    variant="success"
                    className="px-5 fw-bold shadow py-3 rounded-pill d-flex align-items-center gap-2 fs-6"
                    onClick={handleCompleteCase}
                    disabled={finishDisabled}
                    title={evidenceBlockMessage ? 'Falta comentario o evidencia' : undefined}
                  >
                    <Save size={20}/> FINALIZAR Y GUARDAR RESULTADO
                  </Button>
                </Card.Footer>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    </div>
    <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    <Modal show={Boolean(linkingBug)} onHide={() => setLinkingBug(null)} centered>
      <Modal.Header closeButton>
        <Modal.Title className="fs-6 fw-bold d-flex align-items-center gap-2">
          <RefreshCw size={18} className="text-danger" /> Actualizar seguimiento del bug
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {linkingBug && (
          <div className="border rounded-3 p-3 bg-light mb-3">
            <div className="fw-bold text-dark">{linkingBug.codigo} · {linkingBug.estado}</div>
            <div className="small text-muted mt-1">{linkingBug.titulo}</div>
          </div>
        )}
        <Form.Label className="x-small fw-bold text-dark text-uppercase">Comentario de seguimiento</Form.Label>
        <Form.Control
          as="textarea"
          rows={3}
          value={linkComment}
          onChange={(event) => setLinkComment(event.target.value)}
          placeholder="Ej: El defecto se reproduce nuevamente en esta build con la evidencia adjunta."
        />
        <div className="text-muted x-small mt-2">
          Se adjuntará la evidencia de la ejecución fallida actual si existe. Si el bug estaba cerrado, se reabrirá.
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={() => setLinkingBug(null)} disabled={Boolean(linkingBugId)}>
          Cancelar
        </Button>
        <Button variant="danger" className="fw-bold" onClick={handleConfirmLinkBug} disabled={!linkingBug || Boolean(linkingBugId)}>
          {linkingBugId ? <Spinner animation="border" size="sm" /> : <RefreshCw size={16} />} Actualizar seguimiento
        </Button>
      </Modal.Footer>
    </Modal>
    </>
  )
}
