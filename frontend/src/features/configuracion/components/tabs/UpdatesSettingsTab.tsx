import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Modal, ProgressBar, Spinner } from 'react-bootstrap'
import { Bot, Cpu, Database, DownloadCloud, Monitor, RefreshCw, Server, UploadCloud } from 'lucide-react'
import {
  applySystemUpdate,
  checkCommunityUpdate,
  fetchLatestSystemUpdate,
  fetchSystemMonitorSummary,
  fetchSystemUpdateChannels,
  fetchSystemUpdateHistory,
  fetchSystemUpdateStatus,
  fetchSystemVersion,
  reportSystemUpdateFailure,
  restartPreparedSystemUpdate,
  rollbackSystemUpdate,
  syncPremiumSystemUpdate,
  type FetchWithAuth,
} from '../../api/configuracionApi'
import { announceUpdateMaintenance, clearUpdateMaintenanceSignal } from '../../updateMaintenance'
import { useI18n } from '../../../../i18n'
import { UpdatesSettingsView } from './UpdatesSettingsView'

type UpdatesSettingsTabProps = {
  fetchWithAuth: FetchWithAuth
  showFeedback: (title: string, message: string, variant?: string) => void
  canApplyUpdates: boolean
}

export function UpdatesSettingsTab({ fetchWithAuth, showFeedback, canApplyUpdates }: UpdatesSettingsTabProps) {
  const { t } = useI18n()
  const [channels, setChannels] = useState<any>(null)
  const [latestUpdate, setLatestUpdate] = useState<any>(null)
  const [status, setStatus] = useState<any>(null)
  const [systemVersion, setSystemVersion] = useState<any>(null)
  const [frontendVersion, setFrontendVersion] = useState<any>(null)
  const [platformSummary, setPlatformSummary] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [checkingCommunity, setCheckingCommunity] = useState(false)
  const [checkingPremium, setCheckingPremium] = useState(false)
  const [applyingPremium, setApplyingPremium] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [restartingPrepared, setRestartingPrepared] = useState(false)
  const [reportingFailure, setReportingFailure] = useState(false)
  const [applyConfirmation, setApplyConfirmation] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [channelsPayload, latestPayload, statusPayload, versionPayload, monitorPayload, frontendPayload] = await Promise.all([
        fetchSystemUpdateChannels(fetchWithAuth),
        fetchLatestSystemUpdate(fetchWithAuth).catch(() => null),
        fetchSystemUpdateStatus(fetchWithAuth),
        fetchSystemVersion(fetchWithAuth).catch(() => null),
        fetchSystemMonitorSummary(fetchWithAuth).catch(() => null),
        fetch('/version.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).catch(() => null),
      ])
      const historyPayload = await fetchSystemUpdateHistory(fetchWithAuth, 8).catch(() => ({ tasks: [] }))
      setChannels(channelsPayload)
      setLatestUpdate(latestPayload)
      setStatus(statusPayload)
      setSystemVersion(versionPayload)
      setPlatformSummary(monitorPayload)
      setFrontendVersion(frontendPayload)
      setHistory(historyPayload.tasks || [])
    } catch (error: any) {
      showFeedback(t('configuracion.updatesTitle'), error?.message || t('configuracion.updatesLoadError'), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const syncPremium = async () => {
    setCheckingPremium(true)
    try {
      const payload = await syncPremiumSystemUpdate(fetchWithAuth)
      setLatestUpdate(payload)
      if (payload.available) {
        showFeedback(t('configuracion.updateAvailable'), t('configuracion.updateAvailableVersion', { version: payload.latest_version || payload.version }), 'info')
      } else {
        showFeedback(t('configuracion.tresekoUpdated'), t('configuracion.premiumNoNewVersion'), 'success')
      }
    } catch (error: any) {
      showFeedback(t('configuracion.premiumUpdatesTitle'), error?.message || t('configuracion.premiumUpdatesError'), 'danger')
    } finally {
      setCheckingPremium(false)
    }
  }

  const syncCommunity = async () => {
    setCheckingCommunity(true)
    try {
      const payload = await checkCommunityUpdate(fetchWithAuth)
      setLatestUpdate({
        ...payload,
        edition: 'community',
        state: channels?.state || 'community',
        update_channel: payload.channel || channels?.active_channel || 'community-stable',
        updates_enabled: true,
        reason: payload.error || (payload.available ? 'community_synced' : t('configuracion.communityNoNewVersion')),
      })
      if (payload.available) {
        showFeedback(t('configuracion.updateAvailable'), t('configuracion.communityUpdateAvailableVersion', { version: payload.latest_version || payload.version }), 'info')
      } else if (payload.error) {
        showFeedback(t('configuracion.communityUpdatesTitle'), payload.error, 'warning')
      } else {
        showFeedback(t('configuracion.tresekoUpdated'), t('configuracion.communityNoNewVersion'), 'success')
      }
    } catch (error: any) {
      showFeedback(t('configuracion.communityUpdatesTitle'), error?.message || t('configuracion.communityUpdatesError'), 'danger')
    } finally {
      setCheckingCommunity(false)
    }
  }

  const applyLatestUpdate = async () => {
    if (!latestUpdate?.available) return
    setApplyingPremium(true)
    try {
      const edition = latestUpdate.edition || (premiumUpdatesAllowed ? 'premium' : 'community')
      const payload = await applySystemUpdate(fetchWithAuth, {
        channel: latestUpdate.channel || latestUpdate.update_channel || (edition === 'premium' ? 'premium-stable' : 'community-stable'),
        manifest: edition === 'community' ? latestUpdate.manifest : undefined,
        confirmation: 'APPLY_UPDATE',
      })
      const nextStatus = await fetchSystemUpdateStatus(fetchWithAuth, payload.task_id)
      setStatus(nextStatus)
      if (nextStatus.status === 'restarting') announceUpdateMaintenance(undefined, nextStatus.pending_version)
      const historyPayload = await fetchSystemUpdateHistory(fetchWithAuth, 8).catch(() => ({ tasks: [] }))
      setHistory(historyPayload.tasks || [])
      showFeedback(
        t('configuracion.updateQueued'),
        edition === 'premium'
          ? t('configuracion.premiumManifestQueued')
          : t('configuracion.communityPackageQueued'),
        'info',
      )
    } catch (error: any) {
      showFeedback(t('configuracion.updatesTitle'), error?.message || t('configuracion.updateStartError'), 'danger')
    } finally {
      setApplyingPremium(false)
    }
  }

  const confirmApplyUpdate = async () => {
    setApplyConfirmation(false)
    await applyLatestUpdate()
  }

  const rollbackPendingUpdate = async () => {
    if (!status?.task_id) return
    setRollingBack(true)
    try {
      const payload = await rollbackSystemUpdate(fetchWithAuth, status.task_id)
      setStatus(payload)
      clearUpdateMaintenanceSignal()
      const historyPayload = await fetchSystemUpdateHistory(fetchWithAuth, 8).catch(() => ({ tasks: [] }))
      setHistory(historyPayload.tasks || [])
      showFeedback(t('configuracion.updateCancelled'), t('configuracion.updateCancelledMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.updatesTitle'), error?.message || t('configuracion.updateCancelError'), 'danger')
    } finally {
      setRollingBack(false)
    }
  }

  const restartPreparedUpdate = async () => {
    if (!status?.task_id) return
    setRestartingPrepared(true)
    try {
      const payload = await restartPreparedSystemUpdate(fetchWithAuth, status.task_id)
      setStatus(payload)
      announceUpdateMaintenance(undefined, payload.pending_version)
      showFeedback(t('configuracion.restartConfirmed'), t('configuracion.restartConfirmedMessage'), 'info')
    } catch (error: any) {
      showFeedback(t('configuracion.updatesTitle'), error?.message || t('configuracion.restartError'), 'danger')
    } finally {
      setRestartingPrepared(false)
    }
  }

  const reportFailure = async () => {
    if (!status?.task_id || status.status !== 'failed') return
    setReportingFailure(true)
    try {
      await reportSystemUpdateFailure(fetchWithAuth, status.task_id)
      showFeedback(t('configuracion.diagnosticSent'), t('configuracion.diagnosticSentMessage'), 'success')
    } catch (error: any) {
      showFeedback(t('configuracion.updateDiagnosticTitle'), error?.message || t('configuracion.diagnosticError'), 'danger')
    } finally {
      setReportingFailure(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!status?.task_id || !['queued', 'in_progress', 'restarting'].includes(status.status)) return undefined
    const timer = window.setInterval(async () => {
      try {
        const payload = await fetchSystemUpdateStatus(fetchWithAuth, status.task_id)
        setStatus(payload)
        if (payload.status === 'restarting') announceUpdateMaintenance(undefined, payload.pending_version)
        if (!['queued', 'in_progress', 'restarting'].includes(payload.status)) {
          clearUpdateMaintenanceSignal()
          const historyPayload = await fetchSystemUpdateHistory(fetchWithAuth, 8).catch(() => ({ tasks: [] }))
          setHistory(historyPayload.tasks || [])
          void load()
        }
      } catch {
        if (status.status === 'restarting') {
          setStatus((prev: any) => prev ? { ...prev, message: t('configuracion.updateRestartingRetrying') } : prev)
        }
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [fetchWithAuth, status?.task_id, status?.status])

  const channelRows = channels?.channels || []
  const premiumUpdatesAllowed = Boolean(
    channelRows.some((channel: any) => channel.edition === 'premium' && channel.allowed)
    || (latestUpdate?.edition === 'premium' && latestUpdate?.updates_enabled)
  )
  const isPremiumUpdateMode = premiumUpdatesAllowed && (latestUpdate?.edition !== 'community')
  const activeTask = status && status.status !== 'idle'
  const isPrepared = status?.stage === 'prepared'
  const confirmationVersion = latestUpdate?.latest_version || latestUpdate?.version
  const confirmationChannel = latestUpdate?.channel || latestUpdate?.update_channel || 'premium-stable'
  const updateEvents = Array.isArray(status?.events) ? status.events.slice(-8).reverse() : []
  const monitorComponents = platformSummary?.components || []
  const findComponent = (id: string) => monitorComponents.find((component: any) => component.id === id)
  const workers = platformSummary?.workers || []
  const onlineWorkers = workers.filter((worker: any) => ['ONLINE', 'BUSY'].includes(worker.status))
  const primaryWorker = onlineWorkers[0] || workers[0]
  const componentRows = [
    {
      id: 'frontend',
      name: t('configuracion.updateComponentFrontend'),
      description: t('configuracion.updateComponentFrontendDescription'),
      version: frontendVersion?.version || systemVersion?.version || status?.current_version || t('configuracion.versionNotReported'),
      status: findComponent('frontend')?.status || 'ONLINE',
      detail: findComponent('frontend')?.detail || t('configuracion.updateFrontendBundleInstalled'),
      icon: Monitor,
    },
    {
      id: 'backend',
      name: t('configuracion.updateComponentBackend'),
      description: t('configuracion.updateComponentBackendDescription'),
      version: systemVersion?.version || status?.current_version || t('configuracion.versionNotReported'),
      status: findComponent('backend')?.status || 'ONLINE',
      detail: findComponent('backend')?.detail || systemVersion?.release_channel || t('configuracion.updateApiService'),
      icon: Server,
    },
    {
      id: 'ai_engine',
      name: t('configuracion.updateComponentAiEngine'),
      description: t('configuracion.updateComponentAiEngineDescription'),
      version: findComponent('ai_engine')?.version || t('configuracion.versionNotReported'),
      status: findComponent('ai_engine')?.status || 'OFFLINE',
      detail: findComponent('ai_engine')?.detail || t('configuracion.updateHealthNotReported'),
      icon: Cpu,
    },
    {
      id: 'worker',
      name: t('configuracion.updateComponentWorker'),
      description: t('configuracion.updateComponentWorkerDescription'),
      version: primaryWorker?.version
        || primaryWorker?.capabilities?.component_version
        || primaryWorker?.capabilities?.worker_version
        || t('configuracion.updateWorkerNotActive'),
      status: onlineWorkers.length ? 'ONLINE' : 'OFFLINE',
      detail: workers.length ? t('configuracion.updateWorkersOnline', { online: onlineWorkers.length, total: workers.length }) : t('configuracion.updateNoWorkersRegistered'),
      icon: Bot,
    },
    {
      id: 'database',
      name: t('configuracion.updateComponentDatabase'),
      description: t('configuracion.updateComponentDatabaseDescription'),
      version: systemVersion?.version || status?.current_version || t('configuracion.versionNotReported'),
      status: findComponent('database')?.status || findComponent('postgres')?.status || 'ONLINE',
      detail: systemVersion?.database_revision
        ? t('configuracion.updateAlembicRevision', { revision: systemVersion.database_revision })
        : findComponent('database')?.detail || findComponent('postgres')?.detail || t('configuracion.updateAlembicRevisionNotReported'),
      icon: Database,
    },
  ]
  const statusVariant = (value?: string) => {
    if (value === 'ONLINE') return 'success'
    if (value === 'DEGRADED' || value === 'NOT_CONFIGURED') return 'warning'
    if (value === 'OFFLINE' || value === 'DISABLED') return 'danger'
    return 'secondary'
  }

  return <UpdatesSettingsView options={{
    t,
    loading,
    load,
    checkingCommunity,
    syncCommunity,
    checkingPremium,
    syncPremium,
    canApplyUpdates,
    latestUpdate,
    isPremiumUpdateMode,
    applyLatestUpdate,
    applyConfirmation,
    setApplyConfirmation,
    confirmApplyUpdate,
    status,
    activeTask,
    updateEvents,
    isPrepared,
    restartingPrepared,
    restartPreparedUpdate,
    rollingBack,
    rollbackPendingUpdate,
    reportingFailure,
    reportFailure,
    componentRows,
    findComponent,
    workers,
    primaryWorker,
    onlineWorkers,
    systemVersion,
    frontendVersion,
    history,
    statusVariant,
    channels,
    premiumUpdatesAllowed,
    applyingPremium,
    confirmationChannel,
    confirmationVersion,
  }} />
}
