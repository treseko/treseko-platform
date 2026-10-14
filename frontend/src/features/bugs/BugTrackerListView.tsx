import { useState } from 'react'
import { Badge, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap'
import { Bug, ExternalLink, Info, RefreshCw, X } from 'lucide-react'
import { bugDisplayType, closedStates, externalIssueLabel, priorityOptions, severityOptions, severityVariant, statusOptions } from './bugTrackerHelpers'
import { bugPriorityStyle, createBugLocalizedLabels } from './bugPresentation'

export function BugTrackerListView({ context }: { context: any }) {
  const { t, canCreate, canTransitionTo, buildsList, appUsers, bugs, summary, loading, filters, loadBugs, onOpenManualBugDrawer, openDetail, quickTransitioningBugId, setShowStatusHelp, transitionBugInline, modalOnly, setFilters, list } = context
  const { status: statusLabel, severity: severityLabel, priority: priorityLabel } = createBugLocalizedLabels(t)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const assigneeName = (id: string) => {
    const user = appUsers.find((item: any) => String(item.id) === String(id))
    return user?.name || user?.nombre_completo || user?.email || t('bugs.assigned')
  }
  const filterLabel = (key: string, value: string) => {
    if (key === 'estado') return statusLabel(value)
    if (key === 'severidad') return severityLabel(value)
    if (key === 'prioridad') return priorityLabel(value)
    if (key === 'build_id') return buildsList.find((build: any) => String(build.id) === value)?.name || buildsList.find((build: any) => String(build.id) === value)?.nombre || t('bugs.buildLabel')
    if (key === 'scope') return t(value === 'mine' ? 'bugs.myIncidents' : 'bugs.unassignedIncidents')
    if (key === 'attention') return t(`bugs.attention_${value}`)
    return value
  }
  return (
    <div className="p-4 bug-tracker-page" style={modalOnly ? { display: 'none' } : undefined}>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 className="h4 fw-bold text-dark mb-1">{t('bugs.pageTitle')}</h2>
          <div className="small text-muted">{t('bugs.pageDescription')}</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => setShowStatusHelp(true)}>
            <Info size={15} className="me-1" /> {t('bugs.statusHelp')}
          </Button>
          {canCreate && onOpenManualBugDrawer && (
            <Button variant="danger" size="sm" onClick={onOpenManualBugDrawer}>
              <Bug size={15} className="me-1" /> {t('bugs.addBug')}
            </Button>
          )}
          <Button variant="outline-primary" size="sm" onClick={() => loadBugs()} disabled={loading}><RefreshCw size={15} className="me-1" />{t('bugs.refresh')}</Button>
        </div>
      </div>

      <div className="small text-muted mb-2">{t("bugs.filteredSummary")}</div>
      <Row className="g-3 mb-3">
        {[
          [t('bugs.open'), summary.abiertos ?? 0, 'open'],
          [t('bugs.criticalAndHigh'), summary.criticos ?? 0, 'critical'],
          [t('bugs.unassigned'), summary.sin_asignado ?? 0, 'unassigned'],
          [t('bugs.readyRetest'), summary.listos_retest ?? 0, 'retest'],
          [t('bugs.noEvidence'), summary.sin_evidencia ?? 0, 'no_evidence'],
          [t('bugs.linked'), summary.vinculados_externos ?? 0, 'linked'],
        ].map(([label, value, attention]) => (
          <Col md={2} sm={4} xs={6} key={String(label)}>
            <Button variant={list.appliedFilters.attention === attention ? "primary" : "light"} className="w-100 h-100 text-start border shadow-sm py-3" onClick={() => list.applyFilters({ ...list.appliedFilters, attention: String(attention) })} aria-pressed={list.appliedFilters.attention === attention}><span className="d-block small">{label}</span><span className="d-block h4 fw-bold mb-0">{String(value)}</span></Button>
          </Col>
        ))}
      </Row>

      <Row className="g-3">
        <Col xl={12}>
          <Card className="border-0 shadow-sm">
            <Card.Header className="bg-white border-bottom">
              <Row id="bugs-filter-controls" className={`g-2 bug-filter-row ${showAdvancedFilters ? 'show-advanced' : ''}`}>
                <Col md={5}><Form.Control id="bugs-search" name="bugsSearch" aria-label={t('bugs.searchPlaceholder')} size="sm" placeholder={t('bugs.searchPlaceholder')} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></Col>
                <Col md={3}><Form.Select id="bugs-scope-filter" name="bugsScope" aria-label={t('bugs.scopeFilter')} size="sm" value={filters.scope || 'all'} onChange={(e) => setFilters({ ...filters, scope: e.target.value })}><option value="all">{t('bugs.allIncidents')}</option><option value="mine">{t('bugs.myIncidents')}</option><option value="unassigned">{t('bugs.unassignedIncidents')}</option></Form.Select></Col>
                <Col md={2} className="bug-advanced-filter"><Form.Select id="bugs-status-filter" name="bugsStatus" aria-label={t('bugs.statusFilter')} size="sm" value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value })}><option value="">{t('bugs.statusFilter')}</option>{statusOptions.map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}</Form.Select></Col>
                <Col md={2} className="bug-advanced-filter"><Form.Select id="bugs-severity-filter" name="bugsSeverity" aria-label={t('bugs.severityFilter')} size="sm" value={filters.severidad} onChange={(e) => setFilters({ ...filters, severidad: e.target.value })}><option value="">{t('bugs.severityFilter')}</option>{severityOptions.map(item => <option key={item} value={item}>{severityLabel(item)}</option>)}</Form.Select></Col>
                <Col md={2} className="bug-advanced-filter"><Form.Select id="bugs-priority-filter" name="bugsPriority" aria-label={t('bugs.priorityFilter')} size="sm" value={filters.prioridad} onChange={(e) => setFilters({ ...filters, prioridad: e.target.value })}><option value="">{t('bugs.priorityFilter')}</option>{priorityOptions.map(item => <option key={item} value={item}>{item} · {priorityLabel(item)}</option>)}</Form.Select></Col>
                <Col md={2} className="bug-advanced-filter"><Form.Select id="bugs-context-filter" name="bugsContextType" aria-label={t('bugs.contextTypeFilter')} size="sm" value={filters.tipo_contexto || ''} onChange={(e) => setFilters({ ...filters, tipo_contexto: e.target.value })}><option value="">{t('bugs.contextTypeFilter')}</option><option value="CLASICO">{t('bugs.classicType')}</option><option value="API">API</option><option value="CONVERSACIONAL">{t('bugs.conversationalType')}</option></Form.Select></Col>
                <Col md={3} className="bug-advanced-filter"><Form.Select id="bugs-build-filter" name="bugsBuild" aria-label={t('bugs.buildFilter')} size="sm" value={filters.build_id || ''} onChange={(e) => setFilters({ ...filters, build_id: e.target.value })}><option value="">{t('bugs.allBuilds')}</option>{buildsList.map((build: any) => <option key={build.id} value={build.id}>{build.name || build.nombre}</option>)}</Form.Select></Col>
                <Col md={3} className="bug-advanced-filter"><Form.Select id="bugs-build-scope-filter" name="bugsBuildScope" aria-label={t('bugs.buildScopeFilter')} size="sm" value={filters.build_scope || 'reported'} onChange={(e) => setFilters({ ...filters, build_scope: e.target.value })} disabled={!filters.build_id}><option value="reported">{t('bugs.reportedInBuild')}</option><option value="historical">{t('bugs.historicalInBuild')}</option></Form.Select></Col>
                <Col xs={12} className="d-md-none"><Button variant="link" size="sm" aria-expanded={showAdvancedFilters} aria-controls="bugs-filter-controls" onClick={() => setShowAdvancedFilters(value => !value)}>{t(showAdvancedFilters ? 'bugs.lessFilters' : 'bugs.moreFilters')}</Button></Col>
                <Col md={1}><Button size="sm" variant="dark" className="w-100" onClick={() => list.applyFilters()}>{t('bugs.filter')}</Button></Col>
                <Col md={1}><Button size="sm" variant="outline-secondary" className="w-100" onClick={list.clearFilters}>{t('bugs.clearFilters')}</Button></Col>
              </Row>
              <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                <Form.Label htmlFor="bugs-sort" className="small mb-0">{t('bugs.sortBy')}</Form.Label>
                <Form.Select id="bugs-sort" size="sm" className="w-auto" value={list.sort} onChange={e => list.setSort(e.target.value)}>
                  {['newest','oldest','priority'].map(sort => <option key={sort} value={sort}>{t(`bugs.sort_${sort}`)}</option>)}
                </Form.Select>
                {Object.entries(list.appliedFilters).filter(([key,value]) => value && key !== 'build_scope' && !(key === 'scope' && value === 'all')).map(([key, value]) => <Badge key={key} bg="light" text="dark" className="border">{filterLabel(key, String(value))}<button type="button" className="btn btn-link btn-sm p-0 ms-2" aria-label={t('bugs.removeFilter', { filter: filterLabel(key, String(value)) })} onClick={() => list.applyFilters({ ...list.appliedFilters, [key]: key === 'scope' ? 'all' : '' })}><X size={12} /></button></Badge>)}
              </div>
            </Card.Header>
            <Card.Body className="p-0">
              {list.error && <div role="alert" className="alert alert-danger m-3">{list.error}<Button className="ms-2" size="sm" variant="outline-danger" onClick={() => loadBugs()}>{t('bugs.retry')}</Button></div>}
              {loading ? <div className="p-4 text-center"><Spinner size="sm" /> {t('bugs.loading')}</div> : (
                <div className="table-responsive bug-tracker-table-wrap">
                  <Table hover className="mb-0 align-middle bug-tracker-table">
                    <thead className="table-light"><tr><th scope="col">{t('bugs.bugCol')}</th><th scope="col">{t('bugs.statusCol')}</th><th scope="col">{t('bugs.sevCol')}</th><th scope="col">{t('bugs.priCol')}</th><th scope="col">{t('bugs.contextCol')}</th><th scope="col">{t('bugs.assignedCol')}</th><th scope="col" className="text-end">{t('bugs.actionsCol')}</th></tr></thead>
                    <tbody>
                      {bugs.map((bug) => {
                        const priority = bug.prioridad ? { value: String(bug.prioridad).toUpperCase(), ...bugPriorityStyle(String(bug.prioridad).toUpperCase()) } : null
                        const displayType = bugDisplayType(bug)
                        return (
                        <tr key={bug.id}>
                          <td><strong>{bug.codigo}</strong><div className="small text-muted">{bug.titulo}</div><div className="d-flex flex-wrap gap-1 mt-1">{displayType === 'CONVERSACIONAL' ? <Badge bg="info" text="dark">{t('bugs.conversationalType')}</Badge> : displayType === 'API' ? <Badge bg="success">API</Badge> : <Badge bg="light" text="dark" className="border">{t('bugs.classicType')}</Badge>}{externalIssueLabel(bug) && <Badge bg="light" text="primary" className="border"><ExternalLink size={11} className="me-1" />{externalIssueLabel(bug)}</Badge>}</div></td>
                          <td data-label={t('bugs.statusCol')}><Badge bg={closedStates.has(bug.estado) ? 'secondary' : 'success'}>{statusLabel(bug.estado)}</Badge></td>
                          <td data-label={t('bugs.severity')}><Badge bg={severityVariant[bug.severidad] || 'secondary'} text={bug.severidad === 'COSMETICA' ? 'dark' : undefined}>{severityLabel(bug.severidad)}</Badge></td>
                          <td data-label={t('bugs.priority')}>
                            {priority ? (
                              <Badge bg={priority.bg} text={priority.text} title={`${priority.value} · ${priorityLabel(priority.value)}`} className={priority.bg === 'light' ? 'border' : ''}>
                                {priorityLabel(priority.value)}
                              </Badge>
                            ) : t('bugs.noDataset')}
                          </td>
                          <td data-label={t('bugs.contextCol')} className="small"><div className="bug-list-context">
                            <div className="fw-semibold text-dark">{bug.case_title || bug.metadata_json?.case_title || bug.case_code || t('bugs.noCase')}</div>
                            <div className="text-muted">{bug.build_name || bug.metadata_json?.build_name || bug.build_code || bug.build_id || t('bugs.noBuild')}</div>
                            {(bug.case_code || bug.build_code) && <div className="x-small text-muted">{[bug.case_code, bug.build_code].filter(Boolean).join(' · ')}</div>}
                          </div></td>
                          <td data-label={t('bugs.assignedCol')} className="small">{bug.asignado_a ? assigneeName(bug.asignado_a) : t('bugs.unassignedLabel')}</td>
                          <td data-label={t('bugs.actionsCol')}>
                            <div className="d-flex justify-content-end align-items-center gap-2">
                              {statusOptions.some(item => item !== bug.estado && canTransitionTo(item, bug)) && (
                                <Form.Select
                                  id={`bug-status-${bug.id}`}
                                  name={`bugStatus-${bug.id}`}
                                  size="sm"
                                  className="bug-inline-status-select"
                                  aria-label={t('bugs.currentStatusChangeAria', { bug: bug.codigo })}
                                  value={bug.estado || 'ABIERTO'}
                                  disabled={Boolean(quickTransitioningBugId)}
                                  onChange={(event) => transitionBugInline(bug, event.target.value)}
                                >
                                  {statusOptions.filter(item => item === bug.estado || canTransitionTo(item, bug)).map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}
                                </Form.Select>
                              )}
                              <Button size="sm" variant="outline-primary" onClick={() => openDetail(bug)}>{t('bugs.view')}</Button>
                            </div>
                          </td>
                        </tr>
                      )})}
                      {bugs.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-4">{t('bugs.noBugsForFilters')}</td></tr>}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card.Body>
            <Card.Footer className="bg-white d-flex flex-wrap gap-3 justify-content-between align-items-center">
              <span className="small" aria-live="polite">{t('bugs.pageRange', { from: list.total ? list.page * list.pageSize + 1 : 0, to: Math.min((list.page + 1) * list.pageSize, list.total), total: list.total })}</span>
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <Form.Select size="sm" style={{ width: 72 }} aria-label={t('bugs.pageSize')} value={list.pageSize} onChange={e => list.setPageSize(Number(e.target.value))}>{[25,50,100].map(size => <option key={size} value={size}>{size}</option>)}</Form.Select>
                <Button size="sm" className="text-nowrap" variant="outline-secondary" disabled={loading || list.page === 0} onClick={() => list.setPage(list.page - 1)}>{t('bugs.previousPage')}</Button>
                <Button size="sm" className="text-nowrap" variant="outline-secondary" disabled={loading || (list.page + 1) * list.pageSize >= list.total} onClick={() => list.setPage(list.page + 1)}>{t('bugs.nextPage')}</Button>
              </div>
            </Card.Footer>
          </Card>
        </Col>

      </Row>
    </div>

  )
}
