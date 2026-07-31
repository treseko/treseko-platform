import { Alert, Badge, Button, Card, Modal, ProgressBar, Spinner } from 'react-bootstrap'
import { Bot, Cpu, Database, DownloadCloud, Monitor, RefreshCw, Server, UploadCloud } from 'lucide-react'

export function UpdatesSettingsView({ options }: { options: any }) {
  const { t, loading, load, checkingCommunity, syncCommunity, checkingPremium, syncPremium, canApplyUpdates, latestUpdate, isPremiumUpdateMode, applyLatestUpdate, applyConfirmation, setApplyConfirmation, confirmApplyUpdate, status, activeTask, updateEvents, isPrepared, restartingPrepared, restartPreparedUpdate, rollingBack, rollbackPendingUpdate, reportingFailure, reportFailure, componentRows, findComponent, workers, primaryWorker, onlineWorkers, systemVersion, frontendVersion, history, statusVariant, channels, premiumUpdatesAllowed, applyingPremium, confirmationChannel, confirmationVersion } = options
  return (
    <div className="animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h5 className="fw-bold text-secondary text-uppercase small m-0">{t('configuracion.updatesTitle')}</h5>
          <p className="text-muted small mb-0">{t('configuracion.updatesDescription')}</p>
        </div>
        <Button variant="outline-secondary" size="sm" className="fw-bold" onClick={load} disabled={loading}>
          {loading ? <Spinner size="sm" className="me-2" /> : <RefreshCw size={14} className="me-2" />}
          {t('configuracion.updateRefresh')}
        </Button>
      </div>

      <Card className="border-0 shadow-sm rounded-4 mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
            <div>
              <div className="fw-bold text-dark">{t('configuracion.currentInstallation')}</div>
              <div className="small text-muted">{t('configuracion.currentInstallationDescription')}</div>
            </div>
            <div className="d-flex flex-wrap gap-2 justify-content-end">
              <Badge bg="primary">{systemVersion?.version || status?.current_version || frontendVersion?.version || t('configuracion.versionNotReported')}</Badge>
              <Badge bg="light" text="dark" className="border">{channels?.active_channel || systemVersion?.release_channel || t('configuracion.channelNotReported')}</Badge>
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
                ? t('configuracion.communityChannelError', { error: latestUpdate.error })
                : t('configuracion.communityChannelDescription')}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {!premiumUpdatesAllowed && (
        <div className="row g-3">
          <div className="col-12 col-xl-5">
            <Card className="border-0 shadow-sm rounded-4 h-100">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">{t('configuracion.communityChannel')}</div>
                <div className="border rounded-3 p-3 bg-light">
                  <div className="d-flex justify-content-between gap-2 align-items-start">
                    <div>
                      <div className="fw-bold text-dark">{latestUpdate?.channel || channels?.active_channel || 'community-stable'}</div>
                      <div className="small text-muted">{t('configuracion.communityChannelDescription')}</div>
                      {latestUpdate?.last_checked_at && <div className="x-small text-muted mt-2">{t('configuracion.lastChecked', { date: latestUpdate.last_checked_at })}</div>}
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
                    <div className="fw-bold text-dark">{t('configuracion.searchCommunityUpdate')}</div>
                    <div className="small text-muted">
                      {t('configuracion.searchCommunityUpdateDescription')}
                    </div>
                  </div>
                  <Button variant="outline-primary" size="sm" className="fw-bold" onClick={syncCommunity} disabled={checkingCommunity}>
                    {checkingCommunity ? <Spinner size="sm" className="me-2" /> : <DownloadCloud size={14} className="me-2" />}
                    {t('configuracion.searchUpdate')}
                  </Button>
                </div>

                <div className="border rounded-3 p-3 bg-light mb-3">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <div className="fw-bold text-dark">
                        {latestUpdate?.available
                          ? t('configuracion.versionAvailable', { version: latestUpdate.latest_version || latestUpdate.version })
                          : t('configuracion.noUpdateAvailable')}
                      </div>
                      <div className="small text-muted">
                        {latestUpdate?.available
                          ? latestUpdate?.changelog || t('configuracion.communityReleaseDetected')
                          : latestUpdate?.reason || t('configuracion.installedVersion', { version: latestUpdate?.current_version || systemVersion?.version || t('configuracion.versionNotReported') })}
                      </div>
                    </div>
                    <Badge bg={latestUpdate?.available ? 'primary' : latestUpdate?.error ? 'warning' : 'success'}>
                      {latestUpdate?.available ? t('configuracion.available') : latestUpdate?.error ? t('configuracion.review') : t('configuracion.current')}
                    </Badge>
                  </div>
                </div>

                {latestUpdate?.available && (
                  <Button
                    variant="primary"
                    className="fw-bold"
                    disabled={!canApplyUpdates || applyingPremium || isPrepared}
                    onClick={() => setApplyConfirmation(true)}
                  >
                    {applyingPremium ? <Spinner size="sm" className="me-2" /> : <UploadCloud size={16} className="me-2" />}
                    {isPrepared ? t('configuracion.updatePrepared') : t('configuracion.prepareUpdate')}
                  </Button>
                )}
                {!canApplyUpdates && <div className="x-small text-muted mt-2">{t('configuracion.updatePermissionRequired')}</div>}
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
                <div className="fw-bold text-dark mb-2">{t('configuracion.updateTaskStatus')}</div>
                <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                  <Badge bg={activeTask ? (status.status === 'failed' ? 'danger' : 'primary') : 'secondary'}>
                    {status?.status || 'idle'}
                  </Badge>
                  <span className="small text-muted">{status?.message || t('configuracion.updateNoActiveTask')}</span>
                </div>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  <Badge bg="light" text="dark" className="border">
                    {t('configuracion.updateCurrentVersion')}: {status?.current_version || t('configuracion.versionNotReported')}
                  </Badge>
                  {status?.pending_version && (
                    <Badge bg="light" text="dark" className="border">
                      {t('configuracion.updatePendingVersion')}: {status.pending_version}
                    </Badge>
                  )}
                </div>
                <ProgressBar now={status?.progress_pct || 0} />
                {status?.error && <Alert variant="warning" className="small mt-3 mb-0">{status.error}</Alert>}
                {status?.status === 'failed' && status?.task_id && (
                  <Button variant="outline-primary" size="sm" className="fw-bold mt-3" onClick={reportFailure} disabled={reportingFailure}>
                    {reportingFailure ? <Spinner size="sm" className="me-2" /> : null}
                    {t('configuracion.updateSendDiagnostic')}
                  </Button>
                )}
                {updateEvents.length > 0 && (
                  <div className="border rounded-3 bg-light p-2 mt-3">
                    <div className="x-small text-muted fw-bold text-uppercase mb-2">{t('configuracion.updateLiveEvents')}</div>
                    <div className="d-grid gap-1">
                      {updateEvents.map((event: any, index: number) => (
                        <div key={`${event.at || index}-${event.event || index}`} className="x-small text-muted d-flex justify-content-between gap-2">
                          <span className="text-truncate" title={event.message || event.event}>{event.message || event.event || t('configuracion.updateEvent')}</span>
                          <span className="text-nowrap">{event.stage || event.status || '-'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {status?.stage === 'prepared' && status?.task_id && (
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
                    <Alert variant="success" className="small mb-0 flex-grow-1">
                      {t('configuracion.updatePreparedRestartRequired')}
                    </Alert>
                    <Button variant="primary" size="sm" className="fw-bold" onClick={restartPreparedUpdate} disabled={restartingPrepared}>
                      {restartingPrepared ? <Spinner size="sm" className="me-2" /> : null}
                      {t('configuracion.updateApplyAndRestart')}
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="fw-bold"
                      onClick={rollbackPendingUpdate}
                      disabled={rollingBack}
                    >
                      {rollingBack ? <Spinner size="sm" className="me-2" /> : null}
                      {t('configuracion.updateCancel')}
                    </Button>
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>

          <div className="col-12">
            <Card className="border-0 shadow-sm rounded-4">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">{t('configuracion.updateRecentHistory')}</div>
                <div className="d-grid gap-2">
                  {history.map((item: any) => (
                    <div key={item.task_id || `${item.version}-${item.started_at}`} className="border rounded-3 p-2 d-flex flex-wrap justify-content-between gap-2 align-items-start">
                      <div className="min-width-0">
                        <div className="fw-bold text-dark text-truncate" title={item.version || item.task_id || t('configuracion.updateLabel')}>
                          {item.version || t('configuracion.versionNotReported')}
                        </div>
                        <div className="x-small text-muted">
                          {item.channel || t('configuracion.channelNotReported')} · {item.stage || item.status} · {item.completed_at || item.started_at || t('configuracion.dateNotReported')}
                        </div>
                        {item.error && <div className="x-small text-danger text-truncate" title={item.error}>{item.error}</div>}
                      </div>
                      <Badge bg={item.status === 'failed' ? 'danger' : item.stage === 'prepared' ? 'success' : item.status === 'done' ? 'primary' : 'secondary'}>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                  {!history.length && <div className="small text-muted text-center py-3">{t('configuracion.updateNoTasks')}</div>}
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
                <div className="fw-bold text-dark mb-2">{t('configuracion.updateEnabledChannel')}</div>
                <div className="border rounded-3 p-3 bg-light">
                  <div className="d-flex justify-content-between gap-2 align-items-start">
                    <div>
                      <div className="fw-bold text-dark">{latestUpdate?.update_channel || channels?.active_channel || 'premium-stable'}</div>
                      <div className="small text-muted">{t('configuracion.updatePremiumChannelDescription')}</div>
                      {latestUpdate?.last_checked_at && <div className="x-small text-muted mt-2">{t('configuracion.lastChecked', { date: latestUpdate.last_checked_at })}</div>}
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
                    <div className="fw-bold text-dark">{t('configuracion.premiumUpdatesTitle')}</div>
                    <div className="small text-muted">
                      {t('configuracion.premiumUpdatesDescription')}
                    </div>
                  </div>
                  <Button variant="outline-primary" size="sm" className="fw-bold" onClick={syncPremium} disabled={checkingPremium}>
                    {checkingPremium ? <Spinner size="sm" className="me-2" /> : <DownloadCloud size={14} className="me-2" />}
                    {t('configuracion.searchUpdate')}
                  </Button>
                </div>

                <div className="border rounded-3 p-3 bg-light mb-3">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <div className="fw-bold text-dark">
                        {latestUpdate?.available
                          ? t('configuracion.versionAvailable', { version: latestUpdate.latest_version || latestUpdate.version })
                          : t('configuracion.noUpdateAvailable')}
                      </div>
                      <div className="small text-muted">
                        {latestUpdate?.available
                          ? latestUpdate?.changelog || t('configuracion.premiumManifestValidated')
                          : latestUpdate?.reason || t('configuracion.installedVersion', { version: latestUpdate?.current_version || systemVersion?.version || t('configuracion.versionNotReported') })}
                      </div>
                    </div>
                    <Badge bg={latestUpdate?.available ? 'primary' : 'success'}>
                      {latestUpdate?.available ? t('configuracion.available') : t('configuracion.current')}
                    </Badge>
                  </div>
                </div>

                {latestUpdate?.available && (
                  <Button
                    variant="primary"
                    className="fw-bold"
                    disabled={!canApplyUpdates || applyingPremium || isPrepared}
                    onClick={() => setApplyConfirmation(true)}
                  >
                    {applyingPremium ? <Spinner size="sm" className="me-2" /> : <UploadCloud size={16} className="me-2" />}
                    {isPrepared ? t('configuracion.updatePrepared') : t('configuracion.prepareUpdate')}
                  </Button>
                )}
                {!canApplyUpdates && <div className="x-small text-muted mt-2">{t('configuracion.updatePermissionRequired')}</div>}
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
                  <span className="small text-muted">{status?.message || t('configuracion.updateNoActiveTask')}</span>
                </div>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  <Badge bg="light" text="dark" className="border">
                    {t('configuracion.updateCurrentVersion')}: {status?.current_version || t('configuracion.versionNotReported')}
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
                      {t('configuracion.updateSendDiagnostic')}
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
                      {t('configuracion.updatePreparedRestartRequired')}
                    </Alert>
                    <Button variant="primary" size="sm" className="fw-bold" onClick={restartPreparedUpdate} disabled={restartingPrepared}>
                      {restartingPrepared ? <Spinner size="sm" className="me-2" /> : null}
                      Aplicar ahora y reiniciar
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="fw-bold"
                      onClick={rollbackPendingUpdate}
                      disabled={rollingBack}
                    >
                      {rollingBack ? <Spinner size="sm" className="me-2" /> : null}
                      {t('configuracion.updateCancel')}
                    </Button>
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>

          <div className="col-12">
            <Card className="border-0 shadow-sm rounded-4">
              <Card.Body>
                <div className="fw-bold text-dark mb-2">{t('configuracion.updateRecentHistory')}</div>
                <div className="d-grid gap-2">
                  {history.map((item: any) => (
                    <div key={item.task_id || `${item.version}-${item.started_at}`} className="border rounded-3 p-2 d-flex flex-wrap justify-content-between gap-2 align-items-start">
                      <div className="min-width-0">
                        <div className="fw-bold text-dark text-truncate" title={item.version || item.task_id || 'Update'}>
                          {item.version || t('configuracion.versionNotReported')}
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
          <Modal.Title className="h5 fw-bold">{t('configuracion.updateConfirmTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning" className="small">
            {t('configuracion.updateConfirmWarning')}
          </Alert>
          <div className="d-grid gap-2 small">
            <div className="d-flex justify-content-between gap-3">
              <span className="text-muted">{t('configuracion.channel')}</span>
              <span className="fw-bold text-dark">{confirmationChannel}</span>
            </div>
            <div className="d-flex justify-content-between gap-3">
              <span className="text-muted">{t('configuracion.targetVersionLabel')}</span>
              <span className="fw-bold text-dark">{confirmationVersion || t('configuracion.versionNotReported')}</span>
            </div>
            <div className="d-flex justify-content-between gap-3">
              <span className="text-muted">{t('configuracion.download')}</span>
              <span className="fw-bold text-dark">{isPremiumUpdateMode ? t('configuracion.signedDownloadGrant') : t('configuracion.publicUpdatesServer')}</span>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" className="fw-bold" onClick={() => setApplyConfirmation(false)}>
            {t('configuracion.cancel')}
          </Button>
          <Button variant="primary" className="fw-bold" onClick={confirmApplyUpdate} disabled={applyingPremium}>
            {applyingPremium && <Spinner size="sm" className="me-2" />}
            {t('configuracion.updateConfirmApply')}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
