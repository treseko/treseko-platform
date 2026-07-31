import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react'
import { Badge, Button, Card, Col, Form, Modal, Row, Spinner } from 'react-bootstrap'
import { useI18n } from '../../i18n'
import {
  ArrowLeft,
  CheckCircle2,
  PlayCircle,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { EvidenceViewerModal, type EvidenceViewerItem } from '../../shared/components/EvidenceViewerModal'
import { isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'
import { getStatusColor, normalizeExecutionHistory } from '../ejecucion/executionUtils'
import { ManualConsoleSidebar } from './ManualConsoleSidebar'
import { ManualConsoleExecutionPanel } from './ManualConsoleExecutionPanel'
import { ManualConsoleTestListSidebar } from './ManualConsoleTestListSidebar'

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
  const { t } = useI18n()
  const [linkingBug, setLinkingBug] = useState<any | null>(null)
  const [linkComment, setLinkComment] = useState('')
  const [linkingBugId, setLinkingBugId] = useState<string | null>(null)
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const [collapsedLeftSections, setCollapsedLeftSections] = useState({
    details: false,
    bugs: false,
    history: false,
  })
  const validationSequenceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // El panel de detalle es la herramienta principal durante la ejecución.
    // Las secciones sin contenido quedan compactas para no reducirlo a un área
    // con scroll de pocas líneas; siguen disponibles desde su encabezado.
    setCollapsedLeftSections({
      details: false,
      bugs: relatedCaseBugs.length === 0,
      history: normalizeExecutionHistory(selectedTest).length === 0,
    })
    const handle = window.setTimeout(() => {
      validationSequenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(handle)
  }, [selectedTest?.id])

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
    ? t('ejecutarPruebas.missingFailureDoc')
      : ''
  const statusBlocksCompletion = executionSnapshots.length === 0
    ? (!generalExecutionStatus || generalExecutionStatus === 'SIN_CORRER')
    : !completionPlan.canComplete
  const finishDisabled = statusBlocksCompletion || Boolean(evidenceBlockMessage)
  const executionHistory = normalizeExecutionHistory(selectedTest)
  const latestHistoryItem = executionHistory[0]
  const latestRelatedBug = relatedCaseBugs[0]
  // Las secciones laterales no comparten altura con la secuencia de pasos. Cada
  // tarjeta conserva su alto natural; sólo su contenido interno hace scroll.
  const leftSectionStyle = (): CSSProperties => ({})
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
              <PlayCircle size={22} className="text-primary"/> {t('ejecutarPruebas.consoleTitle')}
            </h5>
            {currentExecutionRun && (
              <span className="x-small text-muted font-monospace d-flex align-items-center gap-1 mt-1">
                <Terminal size={12}/> {t('ejecutarPruebas.activeRun')} {currentExecutionRun.nombre}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="manual-console-main flex-grow-1 d-flex overflow-hidden">
        <ManualConsoleTestListSidebar context={{ t, activeExecutionTests, selectedTest, currentExecutionCase, handleSelectTestForExecution, getStatusColor, executionSnapshots, getExecutionReferenceCount }} />

        <div className="manual-console-content flex-grow-1 overflow-auto p-4">
          <Row className="g-4">
            <ManualConsoleSidebar context={{
                t,
                leftSectionStyle,
                selectedTest,
                collapsedLeftSections,
                toggleLeftSection,
                selectedTestComponentLabel,
                renderTextBlock,
                renderExecutionDataRows,
                expandedSectionBodyStyle,
                relatedCaseBugs,
                relatedCaseBugsLoading,
                latestRelatedBug,
                closedBugStates,
                isBugLinkedToCurrentExecution,
                getBugDisplayBuild,
                getBugDisplayComponent,
                onViewRelatedBug,
                canLinkCurrentExecution,
                onLinkExecutionToBug,
                creatingInternalBugContextId,
                setLinkingBug,
                setLinkComment,
                onCreateInternalBugFromExecution,
                executionHistory,
                latestHistoryItem,
                getStatusColor,
                openAttachmentEvidence,
                isEvidenceAvailable,
                isImageAsset,
                resolveAssetUrl,
                openLegacyEvidence,
            }} />

            <Col xl={9} lg={8} className="d-flex flex-column">
              <Card ref={validationSequenceRef} className="border-0 shadow-sm rounded-4 overflow-hidden border-top border-4 border-primary flex-grow-1">
                <Card.Header className="bg-white border-bottom p-4 d-flex justify-content-between align-items-center">
                  <div>
                    <h5 className="fw-bold text-dark m-0 d-flex align-items-center gap-2 mb-1">
                      <CheckCircle2 size={22} className="text-success"/> {t('ejecutarPruebas.validationSequence')}
                    </h5>
                    <span className="text-muted small">{t('ejecutarPruebas.stepExecutionHint')}</span>
                  </div>
                  <Badge bg="primary" className="px-3 py-2 rounded-pill shadow-sm fs-6">
                    {executionSnapshots.length} Pasos
                  </Badge>
                </Card.Header>

                <ManualConsoleExecutionPanel context={{
                  t,
                  executionSnapshots,
                  getSnapshotStatus,
                  resolvePlaceholders,
                  hasPlaceholder,
                  getSnapshotReferences,
                  renderCaseReferences,
                  requireFailureDocumentation,
                  isEvidenceRequiredStatus,
                  hasUserDocumentationNote,
                  snapshotNotes,
                  snapshotAttachments,
                  handleSnapshotStatusChange,
                  handleSnapshotNoteChange,
                  handleSnapshotNoteBlur,
                  attachmentConfig,
                  handleSnapshotAttachmentUpload,
                  handleRemoveSnapshotAttachment,
                  generalExecutionStatus,
                  setGeneralExecutionStatus,
                  generalDocumentationMissing,
                  generalExecutionNote,
                  setGeneralExecutionNote,
                  generalExecutionSnapshot,
                  generalExecutionAttachments,
                  handleGeneralExecutionAttachmentUpload,
                  handleRemoveGeneralExecutionAttachment,
                  evidenceBlockMessage,
                  finishDisabled,
                  handleCompleteCase,
                }} />
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    </div>
    <EvidenceViewerModal evidence={viewerEvidence} onHide={() => setViewerEvidence(null)} />
    <Modal show={Boolean(linkingBug)} onHide={() => setLinkingBug(null)} centered>
      <Modal.Header closeButton className="border-0 pb-2">
        <Modal.Title className="fs-6 fw-bold d-flex align-items-center gap-2">
          <RefreshCw size={18} className="text-danger" /> Actualizar seguimiento del bug
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
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
          {t('ejecutarPruebas.linkBugDescription')}
        </div>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="outline-secondary" onClick={() => setLinkingBug(null)} disabled={Boolean(linkingBugId)}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" className="fw-bold" onClick={handleConfirmLinkBug} disabled={!linkingBug || Boolean(linkingBugId)}>
          {linkingBugId ? <Spinner animation="border" size="sm" /> : <RefreshCw size={16} />} Actualizar seguimiento
        </Button>
      </Modal.Footer>
    </Modal>
    </>
  )
}
