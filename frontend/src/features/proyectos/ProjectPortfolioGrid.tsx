import { Badge, Button, Card, Col, Form, ProgressBar, Row } from 'react-bootstrap'
import { Bug, Building2, Folders, History, Layers, Link, Server, Settings, Terminal, Users } from 'lucide-react'
import { PremiumGate } from '../premium/PremiumGate'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { formatDateTime } from '../../shared/utils/dateTime'

export function ProjectPortfolioGrid({ context }: { context: any }) {
  const {
    t,
    activeOrganizations,
    canEditProjectPortfolio,
    canReadProjectComponents,
    canReadProjectBuilds,
    canReadProjectBuildScope,
    handleCreateProject,
    projectsLoading,
    projectsList,
    currentOrgId,
    organizations,
    currentProjectId,
    componentsList,
    sortBuildsNewestFirst,
    buildsList,
    buildWindowState,
    reportCacheKey,
    latestBuildReports,
    latestReportStatus,
    projectBuildMetrics,
    calculateQaHealth,
    environments,
    projectMembers,
    handleProjectChange,
    setManagingProjectId,
    setProjectInnerTab,
    reportSnapshotsEnabled,
    canViewSharedReports,
    formatDateTime,
    openProjectReportLink,
    goToReports,
    hasSystemFeature,
    projectAdminTabs,
    projectStatusVariant,
    projectInitials,
  } = context
  return (
<div className="d-flex flex-column h-100 overflow-hidden">
              {activeOrganizations.length > 0 && (
                <div className="responsive-page-toolbar d-flex justify-content-between align-items-center mb-4 flex-shrink-0">
                  <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
                    <Folders size={28} /> {t('proyectos.portfolioTitle')}
                  </h4>

                  {canEditProjectPortfolio && (
                    <Form className="project-create-form d-flex align-items-center bg-white p-1 rounded-pill shadow-sm border border-light-subtle" onSubmit={handleCreateProject}>
                      <Form.Control name="projName" size="sm" type="text" placeholder={t('proyectos.newProjectPlaceholder')} className="border-0 shadow-none bg-transparent text-dark px-3" required />
                      <Button type="submit" variant="primary" size="sm" className="fw-bold text-nowrap rounded-pill px-4 shadow-sm" disabled={projectsLoading}>
                        {projectsLoading ? t('proyectos.syncing') : t('proyectos.create')}
                      </Button>
                    </Form>
                  )}
                </div>
              )}

              {activeOrganizations.length === 0 ? (
                <WorkspaceContextEmptyState
                  message={t('proyectos.selectSolution')}
                  detail={t('proyectos.selectSolutionDetail')}
                />
              ) : <Row className="g-4 text-start overflow-auto pb-4 flex-grow-1">
                {projectsList.filter(p => p.orgId === currentOrgId).map(p => {
                  const orgName = organizations.find(o => o.id === p.orgId)?.name || t('proyectos.defaultOrganization');
                  const isSelected = currentProjectId === p.id;
                  const projectComponents = componentsList.filter(c => c.projectId === p.id);
                  const projectBuilds = sortBuildsNewestFirst(buildsList.filter(b => b.projectId === p.id));
                  const activeBuild = projectBuilds.find(b => b.active && !b.hidden) || projectBuilds.find(b => b.active) || projectBuilds[0];
                  const activeBuildWindow = activeBuild ? buildWindowState(activeBuild) : null;
                  const activeBuildReportKey = reportCacheKey(p.id, activeBuild?.id);
                  const activeBuildReport = activeBuildReportKey ? latestBuildReports[activeBuildReportKey] : null;
                  const latestReport = activeBuildReport?.item;
                  const latestReportStatusInfo = latestReportStatus(latestReport);
                  const activeBuildMetrics = activeBuildReportKey ? projectBuildMetrics[activeBuildReportKey] : null;
                  const healthInfo = activeBuildMetrics?.loading
                    ? { measured: false, score: 0, reason: t('proyectos.healthCalculating'), variant: 'secondary', loading: true }
                    : calculateQaHealth(activeBuildMetrics?.item, Number(p.health || 0));
                  const projectEnvs = environments.filter((env: any) => env.projectId === p.id);
                  const memberCount = projectMembers.filter((member: any) => member.projectId === p.id).length || p.team || 0;
                  const hiddenBuilds = projectBuilds.filter(b => b.hidden).length;
                  const openProjectSection = (tabId: string) => {
                    handleProjectChange(p.id);
                    setManagingProjectId(p.id);
                    setProjectInnerTab(tabId);
                  };

                  return (
                    <Col xl={4} lg={6} key={p.id}>
                      <Card className={`project-portfolio-card border-0 shadow-sm rounded-4 h-100 d-flex flex-column transition-all ${isSelected ? 'is-selected ring-2 ring-primary shadow-lg' : ''}`}>
                        <div className="p-4 bg-white border-bottom rounded-top-4 flex-shrink-0">
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <span className="badge bg-light text-secondary border fw-bold small"><Building2 size={10} className="me-1 mb-0.5" /> {orgName}</span>
                            <Badge bg={projectStatusVariant(p.status)} text={projectStatusVariant(p.status) === 'light' ? 'secondary' : undefined} className="shadow-sm">{p.status}</Badge>
                          </div>
                          <div className="d-flex align-items-center gap-3 min-w-0">
                            <div className="project-avatar flex-shrink-0">
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} onError={(event) => { event.currentTarget.style.display = 'none' }} />
                              ) : (
                                <span>{projectInitials(p.name)}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <h5 className="fw-bold text-dark mb-1 text-truncate" title={p.name}>{p.name}</h5>
                              <span className="text-muted x-small font-monospace">ID: {p.id.toUpperCase()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 bg-light flex-grow-1 d-flex flex-column gap-3">
                          <div className="project-portfolio-health bg-white p-3 rounded-3 shadow-sm border border-light-subtle">
                            {healthInfo.measured ? (
                              <>
                                <div className="d-flex justify-content-between align-items-end mb-2">
                                  <span className="text-secondary fw-bold x-small text-uppercase">{t('proyectos.projectHealth')}</span>
                                  <span className={`text-${healthInfo.variant} fw-bolder fs-6 lh-1`}>{healthInfo.score}%</span>
                                </div>
                                <ProgressBar now={healthInfo.score} variant={healthInfo.variant as any} style={{ height: '7px' }} className="rounded-pill bg-secondary bg-opacity-10" />
                                <div className="text-muted x-small mt-2">{healthInfo.reason}</div>
                              </>
                            ) : (
                              <div>
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                  <span className="text-secondary fw-bold x-small text-uppercase">{t('proyectos.projectHealth')}</span>
                                  <Badge bg="light" text="secondary" className="border">{(healthInfo as any).loading ? t('proyectos.calculating') : t('proyectos.noMeasurement')}</Badge>
                                </div>
                                <div className="text-muted x-small">{activeBuild ? healthInfo.reason : t('proyectos.createBuildForHealth')}</div>
                              </div>
                            )}
                          </div>

                          <div className="project-portfolio-kpis">
                            <div className="project-portfolio-kpi">
                              <Layers size={16} className="text-primary" />
                              <span className="fw-bold text-dark">{projectComponents.length}</span>
                              <span>{t('proyectos.components')}</span>
                            </div>
                            <div className="project-portfolio-kpi">
                              <Terminal size={16} className="text-success" />
                              <span className="fw-bold text-dark">{projectBuilds.length}</span>
                              <span>{t('proyectos.builds')}</span>
                            </div>
                            <div className="project-portfolio-kpi">
                              <Server size={16} className="text-info" />
                              <span className="fw-bold text-dark">{projectEnvs.length}</span>
                              <span>{t('proyectos.environments')}</span>
                            </div>
                            <div className="project-portfolio-kpi">
                              <Users size={16} className="text-secondary" />
                              <span className="fw-bold text-dark">{memberCount}</span>
                              <span>{t('proyectos.qas')}</span>
                            </div>
                          </div>

                          <div className="project-portfolio-build bg-white rounded-3 border border-light-subtle p-3">
                            <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                              <div className="min-w-0">
                                <div className="x-small fw-bold text-secondary text-uppercase mb-1">{t('proyectos.activeBuild')}</div>
                                <div className="fw-bold text-dark text-truncate font-monospace" title={activeBuild?.name || t('proyectos.noActiveBuild')}>{activeBuild?.name || t('proyectos.noActiveBuild')}</div>
                              </div>
                              {activeBuild ? (
                                <Badge bg={activeBuild.active ? 'success' : 'light'} text={activeBuild.active ? undefined : 'secondary'} className={activeBuild.active ? '' : 'border'}>
                                  {activeBuild.active ? t('proyectos.active') : t('proyectos.historic')}
                                </Badge>
                              ) : (
                                <Badge bg="light" text="secondary" className="border">{t('proyectos.pending')}</Badge>
                              )}
                            </div>
                            {activeBuildWindow ? (
                              <>
                                <div className="d-flex justify-content-between align-items-center x-small text-muted">
                                  <span>{activeBuildWindow.detail}</span>
                                  <Badge bg={activeBuildWindow.variant as any}>{activeBuildWindow.label}</Badge>
                                </div>
                                {activeBuildWindow.progress !== null && <ProgressBar now={activeBuildWindow.progress} variant={activeBuildWindow.variant as any} className="project-portfolio-build-progress mt-2" />}
                              </>
                            ) : (
                              <div className="x-small text-muted">{t('proyectos.createBuildToOrder')}</div>
                            )}
                            <div className="border-top pt-2 mt-3">
                              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                                <span className="x-small fw-bold text-secondary text-uppercase d-flex align-items-center gap-1">
                                  <Link size={13} /> {t('proyectos.lastSharedReport')}
                                </span>
                                {reportSnapshotsEnabled && canViewSharedReports && latestReport && (
                                  <Badge bg={latestReportStatusInfo.variant as any}>{latestReportStatusInfo.label}</Badge>
                                )}
                              </div>
                              {reportSnapshotsEnabled && canViewSharedReports ? (
                                activeBuild ? (
                                  activeBuildReport?.loading ? (
                                    <div className="x-small text-muted">{t('proyectos.loadingLatestReport')}</div>
                                  ) : latestReport ? (
                                    <div className="d-flex flex-column gap-2">
                                      <div className="x-small text-muted">
                                        Snapshot {formatDateTime(latestReport.created_at)}
                                      </div>
                                      <div className="d-flex flex-wrap gap-1">
                                        {(['executive', 'development', 'internal'] as const).map(type => (
                                          latestReport.links?.[type] ? (
                                            <Button key={type} type="button" variant="outline-primary" size="sm" className="px-2 py-0 x-small" onClick={() => openProjectReportLink(latestReport.links[type], type)}>
                                              {type === 'executive' ? 'Ejecutivo' : type === 'development' ? 'Desarrollo' : 'Interno'}
                                            </Button>
                                          ) : null
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="d-flex align-items-center justify-content-between gap-2">
                                      <span className="x-small text-muted">{t('proyectos.noSharedReport')}</span>
                                      <Button type="button" variant="link" size="sm" className="p-0 x-small fw-bold" onClick={() => goToReports(p.id)}>
                                        {t('proyectos.goToReports')}
                                      </Button>
                                    </div>
                                  )
                                ) : (
                                  <div className="x-small text-muted">{t('proyectos.createBuildForReports')}</div>
                                )
                              ) : (
                                <PremiumGate
                                  feature="reports.snapshots"
                                  hasFeature={hasSystemFeature}
                                  title={t('proyectos.premiumReportsTitle')}
                                  description={t('proyectos.premiumReportsDesc')}
                                  mode="inline"
                                  className="py-2"
                                />
                              )}
                            </div>
                          </div>

                          <div className="project-portfolio-activity">
                            <div className="d-flex align-items-center justify-content-between gap-2">
                              <span className="d-flex align-items-center gap-2 text-muted x-small"><History size={14} /> {t('proyectos.operationalStatus')}</span>
                              <span className="fw-bold x-small text-dark">{hiddenBuilds > 0 ? t('proyectos.hiddenBuilds', { count: hiddenBuilds }) : t('proyectos.noHiddenBuilds')}</span>
                            </div>
                            <div className="d-flex align-items-center justify-content-between gap-2">
                              <span className="d-flex align-items-center gap-2 text-muted x-small"><Bug size={14} /> {t('proyectos.incidents')}</span>
                              <span className="fw-bold x-small text-dark">{t('proyectos.viewInManagement')}</span>
                            </div>
                          </div>
                        </div>

                        <div className="project-portfolio-actions p-3 bg-white border-top rounded-bottom-4 d-flex gap-2">
                          <Button variant={isSelected ? "primary" : "outline-secondary"} size="sm" onClick={() => handleProjectChange(p.id)} className={`fw-bold rounded-pill flex-grow-1 ${isSelected ? 'pointer-events-none' : ''}`}>
                            {isSelected ? t('proyectos.activeStatus') : t('proyectos.activate')}
                          </Button>
                          {(canReadProjectComponents || canReadProjectBuilds || canReadProjectBuildScope) && (
                            <Button variant="outline-primary" size="sm" onClick={() => openProjectSection('components')} className="fw-bold rounded-pill px-3 d-flex align-items-center gap-1 shadow-sm">
                              <Terminal size={14} /> {t('proyectos.build')}
                            </Button>
                          )}
                          {projectAdminTabs.length > 0 && (
                            <Button variant="dark" size="sm" onClick={() => openProjectSection(projectAdminTabs[0]?.id || 'config')} className="fw-bold rounded-pill px-3 d-flex align-items-center gap-1 shadow-sm">
                              <Settings size={14} /> {t('proyectos.manage')}
                            </Button>
                          )}
                        </div>
                      </Card>
                    </Col>
                  );
                })}
              </Row>}
            </div>
  )
}
