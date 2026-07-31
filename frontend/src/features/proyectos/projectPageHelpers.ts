import { dateTimeMs } from '../../shared/utils/dateTime'

export function createProjectPageHelpers(context: any) {
  const { t,
    datasetDrafts,
    savedDatasetId,
    setDatasetDrafts,
    setSavedDatasetId,
    savingDatasetId,
    setSavingDatasetId,
    handleUpdateEnvironmentDataset,
    editingEnvironment,
    setEditingEnvironment,
    setShowEnvironmentModal,
    handleEditProjectEnvironment,
    handleSaveProjectEnvironment } = context
  const environmentVariablesText = (env?: any) =>
      Object.entries(env?.variables || {})
        .map(([key, value]) => `${key}=${String(value)}`)
        .join('\n')
    const formatBuildDuration = (durationMin: number | null) => {
      if (durationMin === null || durationMin < 0) return null
      const hours = Math.floor(durationMin / 60)
      const days = Math.floor(hours / 24)
      const months = Math.floor(days / 30)
      const years = Math.floor(days / 365)
      if (durationMin < 60) return `${durationMin} min`
      if (hours < 24) return `${hours}h ${durationMin % 60}min`
      if (days < 30) return `${days}d ${hours % 24}h`
      if (months < 12) return `${months}m ${days % 30}d`
      return `${years}a ${months % 12}m`
    }
    const buildWindowState = (build: any) => {
      const now = Date.now()
      const start = dateTimeMs(build.startDate)
      const end = dateTimeMs(build.endDate)
      if (build.state === 'PREPARACION') {
        return { label: t('proyectos.buildWindowPreparing'), variant: 'warning', progress: null, detail: t('proyectos.buildWindowPendingActivation') }
      }
      if (build.state === 'HISTORICA' || (!build.state && !build.active)) {
        if (!build.startDate && !build.endDate) return { label: t('proyectos.buildWindowHistoric'), variant: 'primary', progress: null, detail: t('proyectos.buildWindowNoWindow') }
        const durationMin = start && end && end > start ? Math.round((end - start) / 60000) : null
        const durStr = formatBuildDuration(durationMin)
        return {
          label: t('proyectos.buildWindowCompleted'),
          variant: 'primary',
          progress: start && end && end > start ? 100 : null,
          detail: durStr ? t('proyectos.buildWindowDuration', { duration: durStr }) : t('proyectos.buildWindowPartial')
        }
      }
      if (!build.startDate && !build.endDate) return { label: t('proyectos.buildWindowNoWindow'), variant: 'secondary', progress: null, detail: t('proyectos.buildWindowNoWindowDefined') }
      if (start && now < start) return { label: t('proyectos.buildWindowNotStarted'), variant: 'info', progress: 0, detail: t('proyectos.buildWindowPendingStart') }
      if (end && now > end) return { label: t('proyectos.buildWindowExpired'), variant: 'danger', progress: 100, detail: t('proyectos.buildWindowOutOfWindow') }
      if (start && end && end > start) {
        const progress = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)))
        const remainingDays = Math.max(0, Math.ceil((end - now) / 86400000))
        return { label: t('proyectos.buildWindowInProgress'), variant: 'success', progress, detail: t('proyectos.buildWindowDaysRemaining', { days: remainingDays }) }
      }
      return { label: t('proyectos.buildWindowInProgress'), variant: 'success', progress: null, detail: t('proyectos.buildWindowPartial') }
    }
    const projectInitials = (name: string) => String(name || 'PR')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('') || 'PR'
    const projectStatusVariant = (status?: string) => {
      const normalized = String(status || '').toLowerCase()
      if (normalized === 'activo') return 'success'
      if (normalized === 'en qa') return 'primary'
      if (normalized === 'planificacion') return 'secondary'
      if (normalized === 'bloqueado') return 'danger'
      if (normalized === 'mantenimiento') return 'info'
      if (normalized === 'cerrado') return 'dark'
      if (normalized === 'archivado') return 'light'
      return 'warning'
    }
    const projectStatusHelpItems = [
      { status: t('proyectos.planning'), summary: t('proyectos.statusPlanningSummary'), restriction: t('proyectos.statusPlanningRestriction') },
      { status: t('proyectos.activeStatus'), summary: t('proyectos.statusActiveSummary'), restriction: t('proyectos.statusActiveRestriction') },
      { status: t('proyectos.inQa'), summary: t('proyectos.statusInQaSummary'), restriction: t('proyectos.statusInQaRestriction') },
      { status: t('proyectos.blocked'), summary: t('proyectos.statusBlockedSummary'), restriction: t('proyectos.statusBlockedRestriction') },
      { status: t('proyectos.maintenance'), summary: t('proyectos.statusMaintenanceSummary'), restriction: t('proyectos.statusMaintenanceRestriction') },
      { status: t('proyectos.onHold'), summary: t('proyectos.statusOnHoldSummary'), restriction: t('proyectos.statusOnHoldRestriction') },
      { status: t('proyectos.closed'), summary: t('proyectos.statusClosedSummary'), restriction: t('proyectos.statusClosedRestriction') },
      { status: t('proyectos.archived'), summary: t('proyectos.statusArchivedSummary'), restriction: t('proyectos.statusArchivedRestriction') },
    ]
    const datasetToDraft = (dataset: any) => ({
      name: dataset.name || '',
      description: dataset.description || '',
      variablesText: Object.entries(dataset.variables || {}).map(([key, value]) => `${key}=${String(value)}`).join('\n'),
      isDefault: Boolean(dataset.isDefault)
    })
    const serializeDatasetDraft = (draft: any) => JSON.stringify({
      name: String(draft?.name || '').trim(),
      description: String(draft?.description || '').trim(),
      variablesText: String(draft?.variablesText || '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n'),
      isDefault: Boolean(draft?.isDefault)
    })
    const getDatasetDraft = (dataset: any) => datasetDrafts[dataset.id] || datasetToDraft(dataset)
    const isDatasetDraftDirty = (dataset: any) => serializeDatasetDraft(getDatasetDraft(dataset)) !== serializeDatasetDraft(datasetToDraft(dataset))
    const updateDatasetDraft = (dataset: any, changes: any) => {
      setDatasetDrafts(prev => ({
        ...prev,
        [dataset.id]: {
          ...getDatasetDraft(dataset),
          ...changes
        }
      }))
      if (savedDatasetId === dataset.id) setSavedDatasetId(null)
    }
    const handleDatasetSubmit = async (event: any, envId: string, dataset: any) => {
      event.preventDefault()
      if (!isDatasetDraftDirty(dataset) || savingDatasetId) return
      setSavingDatasetId(dataset.id)
      const ok = await handleUpdateEnvironmentDataset(event, envId, dataset.id)
      setSavingDatasetId(null)
      if (!ok) return
      setDatasetDrafts(prev => {
        const next = { ...prev }
        delete next[dataset.id]
        return next
      })
      setSavedDatasetId(dataset.id)
      window.setTimeout(() => {
        setSavedDatasetId(current => current === dataset.id ? null : current)
      }, 2200)
    }
    const openEnvironmentModal = (env: any | null = null) => {
      setEditingEnvironment(env)
      setShowEnvironmentModal(true)
    }
    const closeEnvironmentModal = () => {
      setShowEnvironmentModal(false)
      setEditingEnvironment(null)
    }
    const submitEnvironmentModal = async (event: any) => {
      if (editingEnvironment) {
        await handleEditProjectEnvironment(editingEnvironment.id, event)
      } else {
        await handleSaveProjectEnvironment(event)
      }
      closeEnvironmentModal()
    }

  return {
    environmentVariablesText,
    buildWindowState,
    projectInitials,
    projectStatusVariant,
    projectStatusHelpItems,
    getDatasetDraft,
    isDatasetDraftDirty,
    updateDatasetDraft,
    handleDatasetSubmit,
    openEnvironmentModal,
    closeEnvironmentModal,
    submitEnvironmentModal,
  }
}
