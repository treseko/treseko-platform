import { useEffect, useRef, useState } from 'react'

import { API_BASE } from '../../app/constants'
import { type AttachmentMeta } from '../../EvidenceUpload'
import { type EvidenceViewerItem } from '../../shared/components/EvidenceViewerModal'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { BugTrackerView } from './BugTrackerView'
import { useI18n } from '../../i18n'
import { BUG_PRIORITY_OPTIONS } from './bugPresentation'
import { apiErrorMessage, EXTERNAL_ISSUE_PROVIDERS, bugBuildOriginLabel, bugComponentLabel, compactUnique } from './bugTrackerHelpers'
import { BugTransitionModal } from './BugTransitionModal'
import { useBugTransitions } from './useBugTransitions'

type BugTrackerPageProps = {
  currentProjectId?: string
  currentBuildId?: string
  currentCompId?: string
  buildsList?: any[]
  componentsList?: any[]
  appUsers?: any[]
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: string) => void
  canAccessCapability?: (capabilityId: string, level?: string) => boolean
  onOpenManualBugDrawer?: () => void
  refreshToken?: number
  onBugsChanged?: () => void
  deepLinkBugId?: string
  onDeepLinkConsumed?: () => void
  modalOnly?: boolean
  onDetailClosed?: () => void
}

export function BugTrackerPage({
  currentProjectId,
  currentBuildId = '',
  currentCompId = '',
  buildsList = [],
  componentsList = [],
  appUsers = [],
  fetchWithAuth,
  showFeedback,
  canAccessCapability,
  onOpenManualBugDrawer,
  refreshToken = 0,
  onBugsChanged,
  deepLinkBugId = '',
  onDeepLinkConsumed,
  modalOnly = false,
  onDetailClosed,
}: BugTrackerPageProps) {
  const { t } = useI18n()
  const canUse = canAccessCapability || (() => true)
  const canView = canUse('bugs.ver', 'read')
  const canCreate = canView && canUse('bugs.crear', 'edit')
  const canEdit = canUse('bugs.editar', 'edit')
  const canTriage = canUse('bugs.triage', 'edit')
  const canComment = canUse('bugs.comentar', 'edit')
  const canAttachBugEvidence = canUse('bugs.adjuntos', 'edit')
  const canLinkExternal = canUse('bugs.vincular_externo', 'edit')
  const canExport = canUse('bugs.exportar', 'read')
  const currentBuild = buildsList.find((item: any) => String(item.id) === String(currentBuildId || ''))
  const currentComponent = componentsList.find((item: any) => String(item.id) === String(currentCompId || ''))
  const currentBuildLabel = currentBuild?.name || currentBuild?.nombre || ''
  const currentComponentLabel = currentComponent?.name || currentComponent?.nombre || ''

  const [bugs, setBugs] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [selectedBug, setSelectedBug] = useState<any | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [filters, setFilters] = useState({ q: '', estado: '', severidad: '', prioridad: '' })
  const [comment, setComment] = useState('')
  const [commentAttachments, setCommentAttachments] = useState<AttachmentMeta[]>([])
  const [externalForm, setExternalForm] = useState({ provider_id: 'redmine', external_issue_id: '', external_issue_url: '' })
  const [markdown, setMarkdown] = useState('')
  const [detailForm, setDetailForm] = useState<any>({})
  const [additionalContextRows, setAdditionalContextRows] = useState<{ id: string; key: string; value: string }[]>([])
  const [viewerEvidence, setViewerEvidence] = useState<EvidenceViewerItem | null>(null)
  const [savingDetail, setSavingDetail] = useState(false)
  const [showStatusHelp, setShowStatusHelp] = useState(false)
  const hasLoadedBugsRef = useRef(false)
  const loadedProjectIdRef = useRef<string | undefined>(undefined)
  const consumedDeepLinkBugRef = useRef('')

  const loadBugs = async (options?: { silent?: boolean }) => {
    if (!currentProjectId || !canView) {
      setBugs([])
      setSummary({})
      setLoading(false)
      return
    }
    const silent = Boolean(options?.silent)
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => value && params.set(key, value))
      params.set('limit', '100')
      const [listResponse, summaryResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/?${params.toString()}`),
        fetchWithAuth(`${API_BASE}/proyectos/${currentProjectId}/bugs/summary/`),
      ])
      if (!listResponse.ok) throw new Error(await listResponse.text())
      const listPayload = await listResponse.json()
      setBugs(Array.isArray(listPayload) ? listPayload : (listPayload.items || []))
      if (summaryResponse.ok) setSummary(await summaryResponse.json())
      hasLoadedBugsRef.current = true
      loadedProjectIdRef.current = currentProjectId
    } catch (error: any) {
      showFeedback(t('bugs.pageTitle'), error?.message || t('bugs.errorLoading'), 'danger')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    const sameProject = loadedProjectIdRef.current === currentProjectId
    void loadBugs({ silent: hasLoadedBugsRef.current && sameProject })
  }, [currentProjectId, refreshToken, canView])

  const hydrateDetailEditState = (bug: any) => {
    setDetailForm({
      titulo: bug.titulo || '',
      descripcion: bug.descripcion || '',
      resultado_esperado: bug.resultado_esperado || '',
      resultado_obtenido: bug.resultado_obtenido || bug.comportamiento_actual || '',
      pasos_reproduccion: bug.pasos_reproduccion || '',
      precondiciones: bug.precondiciones || '',
      datos_prueba: bug.datos_prueba || '',
      logs_relevantes: bug.logs_relevantes || '',
      error_tecnico: bug.error_tecnico || '',
      stack_trace: bug.stack_trace || '',
      notas_qa: bug.notas_qa || '',
      severidad: bug.severidad || 'MEDIA',
      prioridad: bug.prioridad || 'P2',
      criticidad: bug.criticidad || 'MEDIA',
      reproducibilidad: bug.reproducibilidad || 'no_reproducido',
      frecuencia: bug.frecuencia || '',
      impacto_negocio: bug.impacto_negocio || '',
      ambiente_nombre: bug.ambiente_nombre || bug.metadata_json?.environment_name || '',
      ambiente_url: bug.ambiente_url || bug.metadata_json?.environment_url || '',
      version_app: bug.version_app || bug.metadata_json?.build_name || '',
      modulo_funcional: bug.modulo_funcional || bug.metadata_json?.component_name || '',
      url_afectada: bug.url_afectada || '',
      navegador: bug.navegador || '',
      dispositivo: bug.dispositivo || '',
      resolucion: bug.resolucion || '',
      sistema_operativo: bug.sistema_operativo || '',
      asignado_a: bug.asignado_a || '',
    })
    const context = bug.metadata_json?.additional_context
    const rows = Array.isArray(context)
      ? context.map((item: any, index: number) => ({ id: `context-${index}-${Date.now()}`, key: item?.key || '', value: item?.value || '' }))
      : context && typeof context === 'object'
        ? Object.entries(context).map(([key, value], index) => ({ id: `context-${index}-${Date.now()}`, key, value: String(value ?? '') }))
        : []
    setAdditionalContextRows(rows)
  }

  const openDetail = async (bug: any) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/`)
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      const payload = await response.json()
      setSelectedBug(payload)
      hydrateDetailEditState(payload)
      setMarkdown('')
      setComment('')
      setCommentAttachments([])
      setExternalForm({ provider_id: 'redmine', external_issue_id: '', external_issue_url: '' })
      setDetailOpen(true)
    } catch (error: any) {
      showFeedback(t('bugs.pageTitle'), error?.message || t('bugs.errorOpenDetail'), 'danger')
    }
  }

  useEffect(() => {
    if (!deepLinkBugId || consumedDeepLinkBugRef.current === deepLinkBugId) return
    consumedDeepLinkBugRef.current = deepLinkBugId
    if (!canView) {
      showFeedback(t('bugs.permissionDenied'), t('bugs.noPermissionToView'), 'warning')
      onDeepLinkConsumed?.()
      return
    }
    void openDetail({ id: deepLinkBugId }).finally(() => onDeepLinkConsumed?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBugId, canView])

  const { quickTransitioningBugId, transitionTarget, transitionForm, setTransitionForm, setTransitionTarget,
    compatibleBuilds, requestTransition, confirmTransition, isCorrected } = useBugTransitions({ buildsList,
    currentBuildId, selectedBug, fetchWithAuth, showFeedback, setBugs, setSelectedBug,
    hydrateDetailEditState, loadBugs, onBugsChanged, t })

  const linkingBug = null
  const setLinkingBug = (_value: any) => undefined
  const linkComment = ''
  const setLinkComment = (_value: string) => undefined
  const linkingBugId = null
  const onViewRelatedBug = undefined
  const canLinkCurrentExecution = false
  const onLinkExecutionToBug = undefined
  const creatingInternalBugContextId = null
  const relatedCaseBugs: any[] = []
  const relatedCaseBugsLoading = false
  const onCreateInternalBugFromExecution = undefined
  const getBugDisplayBuild = bugBuildOriginLabel
  const getBugDisplayComponent = bugComponentLabel

  const transitionBug = async (estado: string) => {
    if (selectedBug) requestTransition(selectedBug, estado)
  }

  const transitionBugInline = async (bug: any, estado: string) => {
    if (!bug?.id || !canTriage || estado === bug.estado) return
    requestTransition(bug, estado)
  }

  const updateSelectedBug = async (changes: Record<string, any>) => {
    if (!selectedBug) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    if (!response.ok) throw new Error(await apiErrorMessage(response))
    const updated = await response.json()
    setSelectedBug(updated)
    hydrateDetailEditState(updated)
    await loadBugs()
    onBugsChanged?.()
  }

  const saveSelectedBugDetails = async () => {
    if (!selectedBug || !canEdit) return false
    const additionalContext = additionalContextRows
      .map(row => ({ key: row.key.trim(), value: row.value.trim() }))
      .filter(row => row.key || row.value)
    setSavingDetail(true)
    try {
      await updateSelectedBug({
        ...detailForm,
        asignado_a: detailForm.asignado_a || null,
        metadata_json: {
          ...(selectedBug.metadata_json || {}),
          additional_context: additionalContext,
        },
      })
      showFeedback(t('bugs.bugUpdatedTitle'), t('bugs.bugUpdated'), 'success')
      return true
    } catch (error: any) {
      showFeedback(t('bugs.pageTitle'), error?.message || t('bugs.errorUpdate'), 'danger')
      return false
    } finally {
      setSavingDetail(false)
    }
  }

  const updateDetailField = (field: string, value: any) => {
    setDetailForm((prev: any) => ({ ...prev, [field]: value }))
  }

  const updateAdditionalContextRow = (index: number, field: 'key' | 'value', value: string) => {
    setAdditionalContextRows(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  }

  const addComment = async () => {
    if (!selectedBug || (!comment.trim() && commentAttachments.length === 0)) return
    const validAttachmentIds = compactUnique(commentAttachments.map(item => item?.id))
    if (!comment.trim() && validAttachmentIds.length === 0) {
      showFeedback(t('bugs.pageTitle'), t('bugs.commentOrEvidenceRequired'), 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/comments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comentario: comment.trim() || t('bugs.commentEvidenceFallback'),
          attachment_ids: validAttachmentIds,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      setComment('')
      setCommentAttachments([])
      await openDetail(selectedBug)
    } catch (error: any) {
      showFeedback(t('bugs.pageTitle'), error?.message || t('bugs.errorAddComment'), 'danger')
    }
  }

  const generatePreview = async () => {
    if (!selectedBug) return ''
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/external-preview/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: externalForm.provider_id }),
    })
    if (!response.ok) throw new Error(await response.text())
    const payload = await response.json()
    const nextMarkdown = payload.markdown || ''
    setMarkdown(nextMarkdown)
    return nextMarkdown
  }

  const createExternalLink = async () => {
    const externalIssueId = externalForm.external_issue_id.trim()
    if (!selectedBug || !externalIssueId) {
      showFeedback(t('bugs.externalLink'), t('bugs.externalTicketIdRequired'), 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/external-links/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...externalForm,
          external_issue_id: externalIssueId,
          // La URL es opcional; una cadena vacía no es válida para la API.
          external_issue_url: externalForm.external_issue_url.trim() || null,
        }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      const createdLink = await response.json()
      setExternalForm({ provider_id: 'redmine', external_issue_id: '', external_issue_url: '' })
      await openDetail(selectedBug)
      await loadBugs({ silent: true })
      const provider = EXTERNAL_ISSUE_PROVIDERS.find(item => item.id === createdLink.provider_id)?.label || createdLink.provider_id
      showFeedback(t('bugs.externalLink'), t('bugs.externalLinkSuccess', { provider, issue: createdLink.external_issue_id, bug: selectedBug.codigo }), 'success')
    } catch (error: any) {
      showFeedback(t('bugs.externalLink'), error?.message || t('bugs.externalLinkError'), 'danger')
    }
  }

  const addBugEvidence = async (attachment: AttachmentMeta) => {
    if (!selectedBug || !attachment?.id) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/attachments/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachment_id: attachment.id, tipo: 'BUG_EVIDENCE' }),
    })
    if (response.ok) await openDetail(selectedBug)
  }

  const removeBugEvidence = async (attachment: AttachmentMeta) => {
    if (!selectedBug || !attachment?.id) return
    const response = await fetchWithAuth(`${API_BASE}/bugs/${selectedBug.id}/attachments/${attachment.id}/`, { method: 'DELETE' })
    if (response.ok) await openDetail(selectedBug)
  }

  const bugGeneralAttachments = (selectedBug?.attachments || [])
    .filter((item: any) => !item.comment_id)
    .map((item: any) => item.attachment)
    .filter(Boolean)

  const openEvidenceViewer = (attachment: AttachmentMeta) => {
    setViewerEvidence({
      url: attachment.public_url,
      filename: attachment.filename_original,
      contentType: attachment.content_type,
      available: attachment.available,
      missing_reason: attachment.missing_reason,
    })
  }

  const copyMarkdown = async () => {
    try {
      const text = markdown || await generatePreview()
      if (text) {
        await navigator.clipboard?.writeText(text)
        showFeedback(t('bugs.pageTitle'), t('bugs.markdownCopied'), 'success')
      }
    } catch (error: any) {
      showFeedback(t('bugs.pageTitle'), error?.message || t('bugs.externalPreviewError'), 'danger')
    }
  }

  if (!currentProjectId && !deepLinkBugId && !detailOpen) {
    return (
      <WorkspaceContextEmptyState
        message={t('bugs.noProjectSelected')}
        detail={t('bugs.noProjectDetail')}
      />
    )
  }

  if (!canView) {
    if (modalOnly) return null
    return (
      <WorkspaceContextEmptyState
        message={t('bugs.permissionDenied')}
        detail={t('bugs.noPermissionToView')}
      />
    )
  }

  const viewContext = {
    t,
    canUse,
    canCreate,
    canEdit,
    canTriage,
    canComment,
    canAttachBugEvidence,
    canLinkExternal,
    canExport,
    currentBuildLabel,
    currentComponentLabel,
    appUsers,
    bugs,
    summary,
    loading,
    selectedBug,
    detailOpen,
    filters,
    comment,
    commentAttachments,
    externalForm,
    markdown,
    detailForm,
    additionalContextRows,
    viewerEvidence,
    savingDetail,
    showStatusHelp,
    loadBugs,
    onOpenManualBugDrawer,
    openDetail,
    transitionTarget,
    transitionForm,
    compatibleBuilds,
    quickTransitioningBugId,
    isCorrected,
    setTransitionForm,
    setTransitionTarget,
    confirmTransition,
    setShowStatusHelp,
    setDetailOpen,
    onDetailClosed,
    updateDetailField,
    openEvidenceViewer,
    setComment,
    setCommentAttachments,
    addComment,
    createExternalLink,
    generatePreview,
    copyMarkdown,
    bugGeneralAttachments,
    addBugEvidence,
    removeBugEvidence,
    saveSelectedBugDetails,
    setAdditionalContextRows,
    updateAdditionalContextRow,
    transitionBug,
    transitionBugInline,
    modalOnly,
    linkingBug,
    setLinkingBug,
    linkComment,
    setLinkComment,
    linkingBugId,
    onViewRelatedBug,
    canLinkCurrentExecution,
    onLinkExecutionToBug,
    creatingInternalBugContextId,
    relatedCaseBugs,
    relatedCaseBugsLoading,
    onCreateInternalBugFromExecution,
    getBugDisplayBuild,
    getBugDisplayComponent,
    setViewerEvidence,
    setExternalForm,
    setFilters,
  }

  return <BugTrackerView context={viewContext} />
}
