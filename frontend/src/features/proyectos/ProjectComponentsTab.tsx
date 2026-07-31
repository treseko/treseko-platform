import { Badge, Button, Card, Col, Dropdown, Form, ProgressBar, Row } from 'react-bootstrap'
import { CheckCircle2, Edit, FileText, Layers, Link, MoreHorizontal, Plus, Search, Sliders, Terminal, Trash2 } from 'lucide-react'
import { PremiumGate } from '../premium/PremiumGate'
import { formatDateTime, toDateTimeLocalInput } from '../../shared/utils/dateTime'
import { firstUrlFromText } from '../../app/mappers'

export function ProjectComponentsTab({ context }: { context: any }) {
  const { t,
    canReadProjectComponents,
    canReadProjectBuilds,
    canReadProjectBuildScope,
    canEditProjectComponentsEffective,
    setComponentForm,
    handleDeleteComponent,
    setShowComponentModal,
    componentSearchQuery,
    setComponentSearchQuery,
    handleComponentChange,
    componentsList,
    managingProjectId,
    currentCompId,
    buildsList,
    canEditProjectBuildsEffective,
    handleCreateBuild,
    showBuildCreateOptions,
    setShowBuildCreateOptions,
    defaultBuildStartDate,
    sortBuildsNewestFirst,
    buildWindowState,
    expandedBuildDetails,
    setExpandedBuildDetails,
    latestBuildReports,
    reportCacheKey,
    latestReportStatus,
    firstUrlFromText,
    formatDateTime,
    reportSnapshotsEnabled,
    canViewSharedReports,
    openBuildCasesModal,
    buildCaseIds,
    openProjectReportLink,
    reportButtonLabel,
    goToReports,
    hasSystemFeature,
    handleToggleBuildHidden,
    handleSetInactiveBuild,
    handleSetActiveBuild,
    handleDeleteBuild,
    handleUpdateBuildContext,
    toDateTimeLocalInput } = context
  return (
<div className="animate__animated animate__fadeIn h-100 d-flex flex-column project-components-panel project-components-shell">
                          <div className="responsive-page-toolbar d-flex justify-content-between align-items-center mb-4 flex-shrink-0">
                            <div>
                              <h5 className="fw-bold text-dark m-0">{t('proyectos.architectureTitle')}</h5>
                              <span className="text-muted small">{t('proyectos.architectureSubtitle')}</span>
                            </div>
                            {canEditProjectComponentsEffective && (
                              <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1" onClick={() => {
                                setComponentForm({ id: '', name: '', description: '', techStack: '', variablesText: '' });
                                setShowComponentModal(true);
                              }}>
                                <Plus size={16} /> {t('proyectos.newComponent')}
                              </Button>
                            )}
                          </div>

                          <Row className="g-0 flex-grow-1 overflow-hidden project-component-layout">

                            {/* PANEL MAESTRO: Lista de Componentes */}
                            <Col md={4} className="h-100 d-flex flex-column">
                              <Card className="border-0 shadow-sm bg-light h-100 d-flex flex-column project-component-list component-list-panel">
                                <div className="p-3 border-bottom bg-white rounded-top-3">
                                  <div className="input-group input-group-sm">
                                    <span className="input-group-text bg-light border-end-0 text-muted"><Search size={14} /></span>
                                    <Form.Control
                                      type="text"
                                      placeholder={t('proyectos.searchComponent')}
                                      className="bg-light border-start-0 shadow-none ps-0"
                                      value={componentSearchQuery}
                                      onChange={(e) => setComponentSearchQuery(e.target.value)}
                                    />
                                  </div>
                                </div>
                                <div className="flex-grow-1 overflow-auto p-2">
                                  <div className="d-flex flex-column gap-2">
                                    {componentsList
                                      .filter(c => c.projectId === managingProjectId && c.name.toLowerCase().includes(componentSearchQuery.toLowerCase()))
                                      .map(comp => (
                                      <div
                                        key={comp.id}
                                        onClick={() => handleComponentChange(comp.id)}
                                        className={`p-3 rounded-3 cursor-pointer transition-all border ${comp.id === currentCompId ? 'bg-white border-primary shadow-sm' : 'bg-transparent border-transparent hover-bg-white'}`}
                                      >
                                        <div className="d-flex justify-content-between align-items-start mb-1">
                                          <div className="d-flex align-items-center gap-2">
                                            <Layers size={16} className={comp.id === currentCompId ? 'text-primary' : 'text-muted'} />
                                            <span className={`fw-bold ${comp.id === currentCompId ? 'text-primary' : 'text-dark'}`}>{comp.name}</span>
                                          </div>
                                          <span className="badge bg-secondary bg-opacity-10 text-secondary border">
                                            {buildsList.filter(b => b.projectId === managingProjectId && b.componentId === comp.id).length} builds
                                          </span>
                                        </div>
                                        {comp.techStack && (
                                          <div className="x-small text-muted text-truncate mt-2 d-flex align-items-center gap-1">
                                            <Terminal size={10}/> {comp.techStack}
                                          </div>
                                        )}
                                        {Object.keys(comp.variables || {}).length > 0 && (
                                          <div className="x-small text-muted mt-2">
                                            {t('proyectos.varsCount', { count: Object.keys(comp.variables || {}).length })}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {componentsList.filter(c => c.projectId === managingProjectId).length === 0 && (
                                      <div className="text-center p-4 text-muted small">
                                        <Layers size={24} className="mb-2 opacity-50"/>
                                        <p>{t('proyectos.noComponents')}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </Card>
                            </Col>

                            {/* PANEL DETALLE: Info del Componente y sus Builds */}
                            <Col md={8} className="h-100">
                              {currentCompId && componentsList.find(c => c.id === currentCompId) ? (
                                <Card className="border-0 shadow-sm h-100 d-flex flex-column bg-white project-build-card">
                                  {/* Cabecera del Detalle */}
                                  <Card.Header className="bg-white border-bottom p-4 flex-shrink-0 component-detail-header">
                                    <div className="d-flex justify-content-between align-items-start mb-3 project-build-header">
                                      <div>
                                        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                                          <Badge bg="primary" className="bg-opacity-10 text-primary border border-primary-subtle fw-bold">{t('proyectos.activeComponent')}</Badge>
                                        </div>
                                        <h4 className="fw-bold text-dark m-0">{componentsList.find(c => c.id === currentCompId)?.name}</h4>
                                        <span className="font-monospace text-muted x-small">ID: {currentCompId}</span>
                                      </div>
                                      {canEditProjectComponentsEffective && (
                                      <div className="d-flex gap-2">
                                        <Button variant="light" size="sm" className="border shadow-sm text-secondary hover-text-primary" onClick={() => {
                                          const current = componentsList.find(c => c.id === currentCompId);
                                          if (current) {
                                            setComponentForm({
                                              id: current.id,
                                              name: current.name,
                                              description: current.description || '',
                                              techStack: current.techStack || '',
                                              variablesText: Object.entries(current.variables || {}).map(([key, value]) => `${key}=${String(value)}`).join('\n')
                                            });
                                            setShowComponentModal(true);
                                          }
                                        }}>
                                          <Edit size={14} className="me-1"/> {t('proyectos.edit')}
                                        </Button>
                                        <Button variant="light" size="sm" className="border shadow-sm text-danger hover-bg-danger hover-text-white" onClick={() => handleDeleteComponent(currentCompId)}>
                                          <Trash2 size={14} className="me-1"/> {t('proyectos.delete')}
                                        </Button>
                                      </div>
                                      )}
                                    </div>
                                    <p className="text-muted small mb-2">{componentsList.find(c => c.id === currentCompId)?.description || t('proyectos.noDescription')}</p>
                                    {Object.keys(componentsList.find(c => c.id === currentCompId)?.variables || {}).length > 0 && (
                                      <div className="d-flex flex-wrap gap-1">
                                        {Object.entries(componentsList.find(c => c.id === currentCompId)?.variables || {}).map(([key, value]) => (
                                          <Badge key={key} bg="light" text="dark" className="border font-monospace">
                                            {key}={String(value)}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                  </Card.Header>

                                  {/* Lista de Builds del Componente Seleccionado */}
                                  <Card.Body className="p-4 bg-light flex-grow-1 overflow-auto">
                                      <div className="d-flex justify-content-between align-items-center mb-3 project-build-toolbar">
                                      <h6 className="fw-bold text-secondary m-0 d-flex align-items-center gap-2">
                                        <Terminal size={18} /> {t('proyectos.buildHistory')}
                                      </h6>
                                      {canEditProjectBuildsEffective && (
                                        <Form className="build-create-form build-create-compact bg-white p-2 rounded-3 shadow-sm border border-light-subtle w-100" onSubmit={handleCreateBuild}>
                                          <div className="d-flex align-items-center gap-2 build-create-main">
                                            <Form.Control name="buildName" size="sm" placeholder={t('proyectos.buildPlaceholder')} className="shadow-none bg-white px-3 fw-bold" required />
                                            <Button type="button" variant="outline-secondary" size="sm" className="fw-bold px-3 rounded-pill text-nowrap d-flex align-items-center gap-1" onClick={() => setShowBuildCreateOptions(prev => !prev)}>
                                              <Sliders size={14} /> {t('proyectos.options')}
                                            </Button>
                                            <Button type="submit" variant="dark" size="sm" className="fw-bold px-3 border-0 rounded-pill text-nowrap d-flex align-items-center gap-1">
                                            <Plus size={14} /> {t('proyectos.create')}
                                          </Button>
                                        </div>
                                        {showBuildCreateOptions && (
                                        <div className="d-flex align-items-center gap-2 build-create-meta mt-2">
                                          <Form.Group className="build-context-field">
                                            <Form.Label className="x-small fw-bold text-muted mb-1">{t('proyectos.contextNotes')}</Form.Label>
                                            <Form.Control name="buildContext" size="sm" placeholder={t('proyectos.contextPlaceholder')} className="shadow-none bg-white px-3" />
                                          </Form.Group>
                                          <Form.Group className="build-date-field">
                                            <Form.Label className="x-small fw-bold text-muted mb-1">{t('proyectos.evalStart')}</Form.Label>
                                            <Form.Control name="buildStartDate" type="datetime-local" size="sm" defaultValue={defaultBuildStartDate} title={t('proyectos.evalStart')} />
                                          </Form.Group>
                                          <Form.Group className="build-date-field">
                                            <Form.Label className="x-small fw-bold text-muted mb-1">{t('proyectos.evalEnd')}</Form.Label>
                                            <Form.Control name="buildEndDate" type="datetime-local" size="sm" title={t('proyectos.evalEnd')} />
                                            </Form.Group>
                                          </div>
                                          )}
                                        </Form>
                                      )}
                                    </div>

                                    <div className="d-flex flex-column gap-2">
                                      {sortBuildsNewestFirst(buildsList.filter(b => b.projectId === managingProjectId && b.componentId === currentCompId)).map(build => {
                                        const buildLink = firstUrlFromText(build.changeContext)
                                        const windowState = buildWindowState(build)
                                        const isBuildExpanded = Boolean(expandedBuildDetails[build.id])
                                        const buildReportKey = reportCacheKey(managingProjectId, build.id)
                                        const buildReport = buildReportKey ? latestBuildReports[buildReportKey] : null
                                        const latestReport = buildReport?.item || null
                                        const reportItems = buildReport?.items || []
                                        const previousReportCount = Math.max(0, reportItems.length - (latestReport ? 1 : 0))
                                        const latestReportStatusInfo = latestReportStatus(latestReport)
                                        const buildDisplayEndDate = build.endDate
                                        const buildEndLabel = build.active ? t('proyectos.end') : t('proyectos.close')
                                        const buildStatusLabel = build.state === 'PREPARACION'
                                          ? t('proyectos.buildInPreparation')
                                          : build.state === 'ACTIVA' || build.active
                                            ? t('proyectos.buildActive')
                                            : t('proyectos.buildHistoric')
                                        const showWindowStatusBadge = windowState.label !== buildStatusLabel
                                        return (
                                        <div key={build.id} className={`p-3 border rounded-3 shadow-sm transition-all project-build-item build-row-card ${build.active ? 'is-active' : ''} ${build.hidden ? 'opacity-75' : ''}`}>
                                          <div className="d-flex justify-content-between align-items-start gap-3 project-build-item-main">
                                            <div className="d-flex align-items-start gap-3 flex-grow-1">
                                              <div className="bg-white border rounded-circle d-flex align-items-center justify-content-center shadow-sm flex-shrink-0" style={{ width: '32px', height: '32px' }}>
                                                {build.active ? <CheckCircle2 size={18} className="text-success" /> : <Terminal size={16} className="text-muted" />}
                                              </div>
                                              <div className="flex-grow-1">
                                                <div className="d-flex align-items-center gap-2 flex-wrap">
                                                  <div className="fw-bold text-dark font-monospace app-small">{build.name}</div>
                                                  <Badge bg={build.state === 'ACTIVA' || build.active ? 'success' : build.state === 'PREPARACION' ? 'warning' : 'light'} text={build.state === 'ACTIVA' || build.active || build.state === 'PREPARACION' ? undefined : 'secondary'} className={build.state === 'HISTORICA' || (!build.state && !build.active) ? 'border' : ''}>
                                                    {buildStatusLabel}
                                                  </Badge>
                                                  {build.hidden && <Badge bg="light" text="secondary" className="border">{t('proyectos.hidden')}</Badge>}
                                                  {showWindowStatusBadge && <Badge bg={windowState.variant as any}>{windowState.label}</Badge>}
                                                </div>
                                                <div className="build-row-dates mt-1" title={`${t('proyectos.start')}: ${build.startDate ? formatDateTime(build.startDate) : t('proyectos.withoutStart')} · ${buildEndLabel}: ${buildDisplayEndDate ? formatDateTime(buildDisplayEndDate) : t('proyectos.withoutEnd')}`}>
                                                  <span><strong>{t('proyectos.start')}</strong> {build.startDate ? formatDateTime(build.startDate) : t('proyectos.withoutStart')}</span>
                                                  <span><strong>{buildEndLabel}</strong> {buildDisplayEndDate ? formatDateTime(buildDisplayEndDate) : t('proyectos.withoutEnd')}</span>
                                                  <span className="build-row-window-detail">{windowState.detail}</span>
                                                </div>
                                                {windowState.progress !== null && <ProgressBar now={windowState.progress} variant={windowState.variant as any} className="mt-2 build-row-progress" />}
                                                {isBuildExpanded && build.changeContext && (
                                                  <div className="small text-muted mt-2 bg-white bg-opacity-75 border rounded-3 p-2" style={{ whiteSpace: 'pre-wrap' }}>{build.changeContext}</div>
                                                )}
                                                {isBuildExpanded && buildLink && (
                                                  <a href={buildLink} target="_blank" rel="noreferrer" className="x-small fw-bold text-primary text-decoration-none d-inline-flex align-items-center gap-1 mt-2">
                                                    <Link size={12} /> {t('proyectos.openReference')}
                                                  </a>
                                                )}
                                              </div>
                                            </div>
                                            <div className="d-flex gap-2 align-items-center flex-wrap justify-content-end build-row-actions">
                                              {canReadProjectBuildScope && (
                                                <Button variant="outline-primary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none" onClick={() => openBuildCasesModal(build.id)}>
                                                  {t('proyectos.cases', { count: (buildCaseIds[build.id] || []).length })}
                                                </Button>
                                              )}
                                              {reportSnapshotsEnabled && canViewSharedReports ? (
                                                <Dropdown align="end">
                                                  <Dropdown.Toggle variant="outline-secondary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none d-flex align-items-center gap-1">
                                                    <FileText size={13} /> {t('proyectos.reportsDropdown')}
                                                  </Dropdown.Toggle>
                                                  <Dropdown.Menu className="shadow-sm border-0">
                                                    {buildReport?.loading ? (
                                                      <Dropdown.Item disabled>{t('proyectos.loadingReports')}</Dropdown.Item>
                                                    ) : latestReport ? (
                                                      <>
                                                        <Dropdown.Header>
                                                          <span className="d-block text-dark fw-bold">{t('proyectos.lastSnapshot')}</span>
                                                          <span className="d-block x-small text-muted">
                                                            {formatDateTime(latestReport.created_at)} · {latestReportStatusInfo.label}
                                                            {previousReportCount > 0 ? ` · ${t('proyectos.previousCount', { count: previousReportCount })}` : ''}
                                                          </span>
                                                        </Dropdown.Header>
                                                        {(['executive', 'development', 'internal'] as const).map(type => (
                                                          latestReport.links?.[type] ? (
                                                            <Dropdown.Item key={type} onClick={() => openProjectReportLink(latestReport.links[type], type)}>
                                                              {reportButtonLabel(type)}
                                                            </Dropdown.Item>
                                                          ) : null
                                                        ))}
                                                        <Dropdown.Divider />
                                                        <Dropdown.Item onClick={() => goToReports(managingProjectId)}>
                                                          {t('proyectos.viewReportHistory')}
                                                        </Dropdown.Item>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Dropdown.Item disabled>{t('proyectos.noReportForBuild')}</Dropdown.Item>
                                                        <Dropdown.Divider />
                                                        <Dropdown.Item onClick={() => goToReports(managingProjectId)}>
                                                          {t('proyectos.goToReports')}
                                                        </Dropdown.Item>
                                                      </>
                                                    )}
                                                  </Dropdown.Menu>
                                                </Dropdown>
                                              ) : (
                                                <PremiumGate
                                                  feature="reports.snapshots"
                                                  hasFeature={hasSystemFeature}
                                                  title={t('proyectos.premiumReportsTitle')}
                                                  description={t('proyectos.premiumReportsDesc')}
                                                  mode="disabled"
                                                  className="build-row-premium-report"
                                                >
                                                  <Button variant="outline-secondary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none d-flex align-items-center gap-1">
                                                    <FileText size={13} /> {t('proyectos.reportsDropdown')}
                                                  </Button>
                                                </PremiumGate>
                                              )}
                                              <Dropdown align="end">
                                                <Dropdown.Toggle variant="outline-secondary" size="sm" className="rounded-pill px-3 fw-bold x-small shadow-none d-flex align-items-center gap-1">
                                                  <MoreHorizontal size={14} /> {t('proyectos.actions')}
                                                </Dropdown.Toggle>
                                                <Dropdown.Menu className="shadow-sm border-0">
                                                  <Dropdown.Item onClick={() => setExpandedBuildDetails(prev => ({ ...prev, [build.id]: !prev[build.id] }))}>
                                                    {isBuildExpanded ? t('proyectos.hideDetails') : t('proyectos.showDetails')}
                                                  </Dropdown.Item>
                                                  {canEditProjectBuildsEffective && (
                                                    <Dropdown.Item onClick={() => handleToggleBuildHidden(build.id)}>
                                                      {build.hidden ? t('proyectos.showBuild') : t('proyectos.hideBuild')}
                                                    </Dropdown.Item>
                                                  )}
                                                  {canEditProjectBuildsEffective && (
                                                    build.active ? (
                                                      <Dropdown.Item onClick={() => handleSetInactiveBuild(build.id)}>
                                                        {t('proyectos.deactivateBuild')}
                                                      </Dropdown.Item>
                                                    ) : (
                                                      <Dropdown.Item onClick={() => handleSetActiveBuild(build.id)}>
                                                        {t('proyectos.activateBuild')}
                                                      </Dropdown.Item>
                                                    )
                                                  )}
                                                  {canEditProjectBuildsEffective && (
                                                    <>
                                                      <Dropdown.Divider />
                                                      <Dropdown.Item className="text-danger" onClick={() => handleDeleteBuild(build.id)}>
                                                        {t('proyectos.deleteBuild')}
                                                      </Dropdown.Item>
                                                    </>
                                                  )}
                                                </Dropdown.Menu>
                                              </Dropdown>
                                            </div>
                                          </div>
                                          {isBuildExpanded && canEditProjectBuildsEffective && (
                                            <Form
                                              key={`${build.id}:${build.startDate || ''}:${build.endDate || ''}:${build.changeContext || ''}`}
                                              className="mt-3 border-top pt-3 build-row-detail"
                                              onSubmit={(e) => handleUpdateBuildContext(e, build.id)}
                                            >
                                              <Form.Label className="x-small fw-bold text-muted text-uppercase">{t('proyectos.changeControl')}</Form.Label>
                                              <div className="d-flex gap-2 align-items-start build-context-form">
                                                <Form.Control as="textarea" rows={2} name="buildContext" defaultValue={build.changeContext || ''} placeholder={t('proyectos.contextTextareaPlaceholder')} className="small bg-white" />
                                                <div className="d-flex flex-column gap-2 build-context-dates" style={{ minWidth: 220 }}>
                                                  <Form.Control type="datetime-local" name="buildStartDate" size="sm" defaultValue={toDateTimeLocalInput(build.startDate)} title={t('proyectos.evalWindowStart')} />
                                                  <Form.Control type="datetime-local" name="buildEndDate" size="sm" defaultValue={toDateTimeLocalInput(build.endDate)} title={t('proyectos.evalWindowEnd')} />
                                                  <Button type="submit" variant="outline-primary" size="sm" className="fw-bold text-nowrap px-3">{t('proyectos.save')}</Button>
                                                </div>
                                              </div>
                                            </Form>
                                          )}
                                        </div>
                                      )})}
                                      {buildsList.filter(b => b.projectId === managingProjectId && b.componentId === currentCompId).length === 0 && (
                                        <div className="text-center py-5 text-muted bg-white rounded-3 border border-dashed">
                                          <Terminal size={24} className="mb-2 opacity-50"/>
                                          <p className="small mb-0">{t('proyectos.noBuilds')}</p>
                                          <span className="x-small">{t('proyectos.createFirstBuild')}</span>
                                        </div>
                                      )}
                                    </div>
                                  </Card.Body>
                                </Card>
                              ) : (
                                <div className="h-100 d-flex flex-column align-items-center justify-content-center bg-white border rounded-4 shadow-sm text-muted p-5">
                                  <Layers size={48} className="mb-3 opacity-25" />
                                  <h5>{t('proyectos.noComponentSelected')}</h5>
                                  <p className="small text-center">{t('proyectos.noComponentSelectedHint')}</p>
                                </div>
                              )}
                            </Col>
                          </Row>
                        </div>
  )
}
