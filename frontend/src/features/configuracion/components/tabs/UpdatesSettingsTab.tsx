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
  rollbackSystemUpdate,
  syncPremiumSystemUpdate,
  type FetchWithAuth,
} from '../../api/configuracionApi'
import { announceUpdateMaintenance, clearUpdateMaintenanceSignal } from '../../updateMaintenance'

type UpdatesSettingsTabProps = {
  fetchWithAuth: FetchWithAuth
  showFeedback: (title: string, message: string, variant?: string) => void
  canApplyUpdates: boolean
}

export function UpdatesSettingsTab({ fetchWithAuth, showFeedback, canApplyUpdates }: UpdatesSettingsTabProps) {
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
      showFeedback('Actualizaciones', error?.message || 'No se pudo cargar el estado de actualizaciones.', 'danger')
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
        showFeedback('Actualización disponible', `Versión ${payload.latest_version || payload.version} disponible.`, 'info')
      } else {
        showFeedback('Treseko actualizado', 'El canal Premium no tiene una versión más reciente.', 'success')
      }
    } catch (error: any) {
      showFeedback('Actualizaciones Premium', error?.message || 'No se pudo consultar el canal Premium.', 'danger')
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
        reason: payload.error || (payload.available ? 'community_synced' : 'No hay una versión Community más reciente.'),
      })
      if (payload.available) {
        showFeedback('Actualización disponible', `Versión ${payload.latest_version || payload.version} disponible para Community.`, 'info')
      } else if (payload.error) {
        showFeedback('Actualizaciones Community', payload.error, 'warning')
      } else {
        showFeedback('Treseko actualizado', 'El canal Community no tiene una versión más reciente.', 'success')
      }
    } catch (error: any) {
      showFeedback('Actualizaciones Community', error?.message || 'No se pudo consultar el canal Community.', 'danger')
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
        'Update encolado',
        edition === 'premium'
          ? 'Treseko usó el manifest sincronizado y solicitó el DownloadGrant.'
          : 'Treseko preparará el paquete Community descargado desde el update server.',
        'info',
      )
    } catch (error: any) {
      showFeedback('Actualizaciones', error?.message || 'No se pudo iniciar el update.', 'danger')
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
      showFeedback('Update cancelado', 'El update preparado no se aplicará en el próximo reinicio.', 'success')
    } catch (error: any) {
      showFeedback('Actualizaciones', error?.message || 'No se pudo cancelar el update preparado.', 'danger')
    } finally {
      setRollingBack(false)
    }
  }

  const reportFailure = async () => {
    if (!status?.task_id || status.status !== 'failed') return
    setReportingFailure(true)
    try {
      await reportSystemUpdateFailure(fetchWithAuth, status.task_id)
      showFeedback('Diagnóstico enviado', 'Treseko envió los logs técnicos sanitizados al servidor de updates.', 'success')
    } catch (error: any) {
      showFeedback('Diagnóstico de update', error?.message || 'No se pudo enviar el diagnóstico.', 'danger')
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
        }
      } catch {
        if (status.status === 'restarting') {
          setStatus((prev: any) => prev ? { ...prev, message: 'Servicio reiniciando. Reintentando conexión...' } : prev)
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
      name: 'Web / Frontend',
      description: 'Interfaz que usan los usuarios.',
      version: frontendVersion?.version || systemVersion?.version || status?.current_version || 'sin versión',
      status: findComponent('frontend')?.status || 'ONLINE',
      detail: findComponent('frontend')?.detail || 'Bundle web instalado',
      icon: Monitor,
    },
    {
      id: 'backend',
      name: 'Backend / API',
      description: 'API, seguridad, datos y reglas de negocio.',
      version: systemVersion?.version || status?.current_version || 'sin versión',
      status: findComponent('backend')?.status || 'ONLINE',
      detail: findComponent('backend')?.detail || systemVersion?.release_channel || 'Servicio API',
      icon: Server,
    },
    {
      id: 'ai_engine',
      name: 'Motor IA',
      description: 'Ejecución asistida y automatizada.',
      version: findComponent('ai_engine')?.detail?.match(/v[0-9][\w.-]*/i)?.[0] || 'según health',
      status: findComponent('ai_engine')?.status || 'OFFLINE',
      detail: findComponent('ai_engine')?.detail || 'Sin health reportado',
      icon: Cpu,
    },
    {
      id: 'worker',
      name: 'Worker automatización',
      description: 'Ejecución Playwright/local y jobs automatizados.',
      version: primaryWorker?.capabilities?.playwright_version
        ? `Playwright ${primaryWorker.capabilities.playwright_version}`
        : primaryWorker?.capabilities?.node_version
          ? `Node ${primaryWorker.capabilities.node_version}`
          : 'sin worker activo',
      status: onlineWorkers.length ? 'ONLINE' : 'OFFLINE',
      detail: workers.length ? `${onlineWorkers.length}/${workers.length} worker(s) online` : 'No hay workers registrados',
      icon: Bot,
    },
    {
      id: 'database',
      name: 'Base de datos',
      description: 'PostgreSQL y migraciones Alembic.',
      version: systemVersion?.version || status?.current_version || 'sin versión',
      status: findComponent('database')?.status || findComponent('postgres')?.status || 'ONLINE',
      detail: systemVersion?.database_revision
        ? `Revisión Alembic ${systemVersion.database_revision}`
        : findComponent('database')?.detail || findComponent('postgres')?.detail || 'Revisión Alembic no informada',
      icon: Database,
    },
  ]
  const statusVariant = (value?: string) => {
    if (value === 'ONLINE') return 'success'
    if (value === 'DEGRADED' || value === 'NOT_CONFIGURED') return 'warning'
    if (value === 'OFFLINE' || value === 'DISABLED') return 'danger'
    return 'secondary'
  }

  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h5 className="fw-bold text-secondary text-uppercase small m-0">Actualizaciones</h5>
          <p className="text-muted small mb-0">Versión instalada, componentes y estado de la instalación.</p>
        </div>
        <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={load} disabled={loading}>
          {loading ? <Spinner size="sm" className="me-2" /> : <RefreshCw size={14} className="me-2" />}
          Actualizar estado
        </Button>
      </div>

      <Card className="border-0 shadow-sm rounded-4 mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
            <div>
              <div className="fw-bold text-dark">Instalación actual</div>
              <div className="small text-muted">Versión instalada y componentes activos de esta instancia.</div>
            </div>
            <div className="d-flex flex-wrap gap-2 justify-content-end">
              <Badge bg="primary">{systemVersion?.version || status?.current_version || frontendVersion?.version || 'sin versión'}</Badge>
              <Badge bg="light" text="dark" className="border">{channels?.active_channel || systemVersion?.release_channel || 'canal no informado'}</Badge>
            </div>
          </div>
          <div className="row g-2">
            {componentRows.map(item => {
              const Icon = item.icon
              return (
                <div className="col-12 col-md-6 col-xl-3" key={item.id}>
                  <div className="border rounded-3 p-3 h-100 bg-light">
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                      <div className="d-flex align-items-center gap-2 min-width-0">
                        <Icon size={17} className="text-primary flex-shrink-0" />
                        <div className="fw-bold text-dark text-truncate" title={item.name}>{item.name}</div>
                      </div>
                      <Badge bg={statusVariant(item.status)}>{item.status}</Badge>
                    </div>
                    <div className="h6 fw-bold mb-1">{item.version}</div>
                    <div className="x-small text-muted mb-2">{item.description}</div>
                    <div className="x-small text-muted text-truncate" title={item.detail}>{item.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
          {!premiumUpdatesAllowed && (
            <Alert variant={latestUpdate?.error ? 'warning' : 'light'} className="border small mt-3 mb-0">
              {latestUpdate?.error
                ? `No se pudo consultar el canal Community: ${latestUpdate.error}`
                : 'Community puede consultar releases públicos. Premium agrega canales privados y descarga autorizada con DownloadGrant.'}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {!premiumUpdatesAllowed && (
        <div className="row g-3">
          <div className="col-12 col-xl-5">
            <Card className="border-0 shadow-sm rounded-4 h-100">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">Canal Community</div>
                <div className="border rounded-3 p-3 bg-light">
                  <div className="d-flex justify-content-between gap-2 align-items-start">
                    <div>
                      <div className="fw-bold text-dark">{latestUpdate?.channel || channels?.active_channel || 'community-stable'}</div>
                      <div className="small text-muted">Consulta releases públicos firmados o publicados para instalaciones Community.</div>
                      {latestUpdate?.last_checked_at && <div className="x-small text-muted mt-2">Última consulta: {latestUpdate.last_checked_at}</div>}
                    </div>
                    <Badge bg="secondary">Community</Badge>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </div>

          <div className="col-12 col-xl-7">
            <Card className="border-0 shadow-sm rounded-4 h-100">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                  <div>
                    <div className="fw-bold text-dark">Buscar actualización Community</div>
                    <div className="small text-muted">
                      Treseko consulta `updates.treseko.com` y compara la versión publicada con esta instalación.
                    </div>
                  </div>
                  <Button variant="outline-primary" size="sm" className="fw-bold" onClick={syncCommunity} disabled={checkingCommunity}>
                    {checkingCommunity ? <Spinner size="sm" className="me-2" /> : <DownloadCloud size={14} className="me-2" />}
                    Buscar actualización
                  </Button>
                </div>

                <div className="border rounded-3 p-3 bg-light mb-3">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <div className="fw-bold text-dark">
                        {latestUpdate?.available
                          ? `Versión ${latestUpdate.latest_version || latestUpdate.version}`
                          : 'Sin actualización disponible'}
                      </div>
                      <div className="small text-muted">
                        {latestUpdate?.available
                          ? latestUpdate?.changelog || 'Release Community detectado. Se descargará desde el servidor público de updates.'
                          : latestUpdate?.reason || `Instalada: ${latestUpdate?.current_version || systemVersion?.version || 'sin versión'}.`}
                      </div>
                    </div>
                    <Badge bg={latestUpdate?.available ? 'primary' : latestUpdate?.error ? 'warning' : 'success'}>
                      {latestUpdate?.available ? 'Disponible' : latestUpdate?.error ? 'Revisar' : 'Actual'}
                    </Badge>
                  </div>
                </div>

                <Button
                  variant="primary"
                  className="fw-bold"
                  disabled={!canApplyUpdates || !latestUpdate?.available || applyingPremium}
                  onClick={() => setApplyConfirmation(true)}
                >
                  {applyingPremium ? <Spinner size="sm" className="me-2" /> : <UploadCloud size={16} className="me-2" />}
                  Preparar actualización
                </Button>
                {!canApplyUpdates && <div className="x-small text-muted mt-2">Necesitas permiso para gestionar actualizaciones.</div>}
              </Card.Body>
            </Card>
          </div>
        </div>
      )}

      {!premiumUpdatesAllowed && (
        <div className="row g-3 mt-1">
          <div className="col-12">
            <Card className="border-0 shadow-sm rounded-4">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">Estado de tarea</div>
                <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                  <Badge bg={activeTask ? (status.status === 'failed' ? 'danger' : 'primary') : 'secondary'}>
                    {status?.status || 'idle'}
                  </Badge>
                  <span className="small text-muted">{status?.message || 'Sin actualización en curso.'}</span>
                </div>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  <Badge bg="light" text="dark" className="border">
                    Actual: {status?.current_version || 'sin versión'}
                  </Badge>
                  {status?.pending_version && (
                    <Badge bg="light" text="dark" className="border">
                      Pendiente: {status.pending_version}
                    </Badge>
                  )}
                </div>
                <ProgressBar now={status?.progress_pct || 0} />
                {status?.error && <Alert variant="warning" className="small mt-3 mb-0">{status.error}</Alert>}
                {status?.status === 'failed' && status?.task_id && (
                  <Button variant="outline-primary" size="sm" className="fw-bold mt-3" onClick={reportFailure} disabled={reportingFailure}>
                    {reportingFailure ? <Spinner size="sm" className="me-2" /> : null}
                    Enviar diagnóstico
                  </Button>
                )}
                {updateEvents.length > 0 && (
                  <div className="border rounded-3 bg-light p-2 mt-3">
                    <div className="x-small text-muted fw-bold text-uppercase mb-2">Eventos en vivo</div>
                    <div className="d-grid gap-1">
                      {updateEvents.map((event: any, index: number) => (
                        <div key={`${event.at || index}-${event.event || index}`} className="x-small text-muted d-flex justify-content-between gap-2">
                          <span className="text-truncate" title={event.message || event.event}>{event.message || event.event || 'Evento'}</span>
                          <span className="text-nowrap">{event.stage || event.status || '-'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {status?.stage === 'prepared' && status?.task_id && (
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
                    <Alert variant="success" className="small mb-0 flex-grow-1">
                      El paquete quedó preparado. Reinicia los servicios para aplicar el update con backup y migraciones desde el entrypoint.
                    </Alert>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="fw-bold"
                      onClick={rollbackPendingUpdate}
                      disabled={rollingBack}
                    >
                      {rollingBack ? <Spinner size="sm" className="me-2" /> : null}
                      Cancelar update
                    </Button>
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>

          <div className="col-12">
            <Card className="border-0 shadow-sm rounded-4">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">Historial reciente</div>
                <div className="d-grid gap-2">
                  {history.map((item: any) => (
                    <div key={item.task_id || `${item.version}-${item.started_at}`} className="border rounded-3 p-2 d-flex flex-wrap justify-content-between gap-2 align-items-start">
                      <div className="min-width-0">
                        <div className="fw-bold text-dark text-truncate" title={item.version || item.task_id || 'Update'}>
                          {item.version || 'Versión no informada'}
                        </div>
                        <div className="x-small text-muted">
                          {item.channel || 'sin canal'} · {item.stage || item.status} · {item.completed_at || item.started_at || 'sin fecha'}
                        </div>
                        {item.error && <div className="x-small text-danger text-truncate" title={item.error}>{item.error}</div>}
                      </div>
                      <Badge bg={item.status === 'failed' ? 'danger' : item.stage === 'prepared' ? 'success' : item.status === 'done' ? 'primary' : 'secondary'}>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                  {!history.length && <div className="small text-muted text-center py-3">Sin tareas registradas.</div>}
                </div>
              </Card.Body>
            </Card>
          </div>
        </div>
      )}

      {premiumUpdatesAllowed && (
        <div className="row g-3">
          <div className="col-12 col-xl-5">
            <Card className="border-0 shadow-sm rounded-4 h-100">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">Canal habilitado</div>
                <div className="border rounded-3 p-3 bg-light">
                  <div className="d-flex justify-content-between gap-2 align-items-start">
                    <div>
                      <div className="fw-bold text-dark">{latestUpdate?.update_channel || channels?.active_channel || 'premium-stable'}</div>
                      <div className="small text-muted">El canal se define por la licencia Premium instalada.</div>
                      {latestUpdate?.last_checked_at && <div className="x-small text-muted mt-2">Última consulta: {latestUpdate.last_checked_at}</div>}
                    </div>
                    <Badge bg="success">Premium</Badge>
                  </div>
                </div>
                {latestUpdate?.error && <Alert variant="warning" className="small mt-3 mb-0">{latestUpdate.error}</Alert>}
              </Card.Body>
            </Card>
          </div>

          <div className="col-12 col-xl-7">
            <Card className="border-0 shadow-sm rounded-4 h-100">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                  <div>
                    <div className="fw-bold text-dark">Buscar actualización Premium</div>
                    <div className="small text-muted">
                      Treseko consulta el canal firmado de updates y guarda internamente el último manifest válido.
                    </div>
                  </div>
                  <Button variant="outline-primary" size="sm" className="fw-bold" onClick={syncPremium} disabled={checkingPremium}>
                    {checkingPremium ? <Spinner size="sm" className="me-2" /> : <DownloadCloud size={14} className="me-2" />}
                    Buscar actualización
                  </Button>
                </div>

                <div className="border rounded-3 p-3 bg-light mb-3">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <div className="fw-bold text-dark">
                        {latestUpdate?.available
                          ? `Versión ${latestUpdate.latest_version || latestUpdate.version}`
                          : 'Sin actualización disponible'}
                      </div>
                      <div className="small text-muted">
                        {latestUpdate?.available
                          ? latestUpdate?.changelog || 'Actualización Premium validada. La descarga se autorizará con DownloadGrant al aplicar.'
                          : latestUpdate?.reason || `Instalada: ${latestUpdate?.current_version || systemVersion?.version || 'sin versión'}.`}
                      </div>
                    </div>
                    <Badge bg={latestUpdate?.available ? 'primary' : 'success'}>
                      {latestUpdate?.available ? 'Disponible' : 'Actual'}
                    </Badge>
                  </div>
                </div>

                <Button
                  variant="primary"
                  className="fw-bold"
                  disabled={!canApplyUpdates || !latestUpdate?.available || applyingPremium}
                  onClick={() => setApplyConfirmation(true)}
                >
                  {applyingPremium ? <Spinner size="sm" className="me-2" /> : <UploadCloud size={16} className="me-2" />}
                  Aplicar actualización
                </Button>
                {!canApplyUpdates && <div className="x-small text-muted mt-2">Necesitas permiso para gestionar actualizaciones.</div>}
              </Card.Body>
            </Card>
          </div>

          <div className="col-12">
            <Card className="border-0 shadow-sm rounded-4">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">Estado de tarea</div>
                <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                  <Badge bg={activeTask ? (status.status === 'failed' ? 'danger' : 'primary') : 'secondary'}>
                    {status?.status || 'idle'}
                  </Badge>
                  <span className="small text-muted">{status?.message || 'Sin actualización en curso.'}</span>
                </div>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  <Badge bg="light" text="dark" className="border">
                    Actual: {status?.current_version || 'sin versión'}
                  </Badge>
                  {status?.pending_version && (
                    <Badge bg="light" text="dark" className="border">
                      Pendiente: {status.pending_version}
                    </Badge>
                  )}
                </div>
                <ProgressBar now={status?.progress_pct || 0} />
                {status?.error && <Alert variant="warning" className="small mt-3 mb-0">{status.error}</Alert>}
                {status?.status === 'failed' && status?.task_id && (
                  <Button variant="outline-primary" size="sm" className="fw-bold mt-3" onClick={reportFailure} disabled={reportingFailure}>
                    {reportingFailure ? <Spinner size="sm" className="me-2" /> : null}
                    Enviar diagnóstico
                  </Button>
                )}
                {updateEvents.length > 0 && (
                  <div className="border rounded-3 bg-light p-2 mt-3">
                    <div className="x-small text-muted fw-bold text-uppercase mb-2">Eventos en vivo</div>
                    <div className="d-grid gap-1">
                      {updateEvents.map((event: any, index: number) => (
                        <div key={`${event.at || index}-${event.event || index}`} className="x-small text-muted d-flex justify-content-between gap-2">
                          <span className="text-truncate" title={event.message || event.event}>{event.message || event.event || 'Evento'}</span>
                          <span className="text-nowrap">{event.stage || event.status || '-'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {status?.stage === 'prepared' && status?.task_id && (
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
                    <Alert variant="success" className="small mb-0 flex-grow-1">
                      El paquete quedó preparado. Reinicia los servicios para aplicar el update con backup y migraciones desde el entrypoint.
                    </Alert>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="fw-bold"
                      onClick={rollbackPendingUpdate}
                      disabled={rollingBack}
                    >
                      {rollingBack ? <Spinner size="sm" className="me-2" /> : null}
                      Cancelar update
                    </Button>
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>

          <div className="col-12">
            <Card className="border-0 shadow-sm rounded-4">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">Historial reciente</div>
                <div className="d-grid gap-2">
                  {history.map((item: any) => (
                    <div key={item.task_id || `${item.version}-${item.started_at}`} className="border rounded-3 p-2 d-flex flex-wrap justify-content-between gap-2 align-items-start">
                      <div className="min-width-0">
                        <div className="fw-bold text-dark text-truncate" title={item.version || item.task_id || 'Update'}>
                          {item.version || 'Versión no informada'}
                        </div>
                        <div className="x-small text-muted">
                          {item.channel || 'sin canal'} · {item.stage || item.status} · {item.completed_at || item.started_at || 'sin fecha'}
                        </div>
                        {item.error && <div className="x-small text-danger text-truncate" title={item.error}>{item.error}</div>}
                      </div>
                      <Badge bg={item.status === 'failed' ? 'danger' : item.stage === 'prepared' ? 'success' : item.status === 'done' ? 'primary' : 'secondary'}>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                  {!history.length && <div className="small text-muted text-center py-3">Sin tareas registradas.</div>}
                </div>
              </Card.Body>
            </Card>
          </div>
        </div>
      )}

      <Modal show={applyConfirmation} onHide={() => setApplyConfirmation(false)} centered backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title className="h5 fw-bold">Confirmar actualización</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="small">
            Treseko realizará un backup antes de preparar el paquete. Al aplicar la actualización, los servicios pueden reiniciarse y la aplicación mostrará modo mantenimiento durante unos segundos.
          </Alert>
          <div className="d-grid gap-2 small">
            <div className="d-flex justify-content-between gap-3">
              <span className="text-muted">Canal</span>
              <span className="fw-bold text-dark">{confirmationChannel}</span>
            </div>
            <div className="d-flex justify-content-between gap-3">
              <span className="text-muted">Versión destino</span>
              <span className="fw-bold text-dark">{confirmationVersion || 'sin informar'}</span>
            </div>
            <div className="d-flex justify-content-between gap-3">
              <span className="text-muted">Descarga</span>
              <span className="fw-bold text-dark">{isPremiumUpdateMode ? 'DownloadGrant firmado' : 'Servidor público de updates'}</span>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="fw-bold" onClick={() => setApplyConfirmation(false)}>
            Cancelar
          </Button>
          <Button variant="primary" className="fw-bold" onClick={confirmApplyUpdate} disabled={applyingPremium}>
            {applyingPremium && <Spinner size="sm" className="me-2" />}
            Confirmar y aplicar
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
