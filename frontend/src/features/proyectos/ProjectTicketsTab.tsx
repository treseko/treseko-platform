import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Bug, CheckCircle2, KanbanSquare, RefreshCw } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

const BUG_STATUS_OPTIONS = [
  'ABIERTO', 'TRIAGE', 'ASIGNADO', 'EN_PROGRESO', 'LISTO_PARA_RETEST', 'EN_RETEST',
  'RESUELTO', 'REABIERTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE', 'BLOQUEADO',
]
const PROJECT_BUG_COLUMNS = [
  { id: 'pendientes', labelKey: 'bugColumnPending', statuses: ['ABIERTO', 'TRIAGE', 'ASIGNADO'] },
  { id: 'en_curso', labelKey: 'bugColumnInProgress', statuses: ['EN_PROGRESO', 'BLOQUEADO'] },
  { id: 'validacion', labelKey: 'bugColumnValidation', statuses: ['LISTO_PARA_RETEST', 'EN_RETEST', 'REABIERTO'] },
  { id: 'cerrados', labelKey: 'bugColumnClosed', statuses: ['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'] },
]

export function ProjectTicketsTab({ context }: { context: any }) {
  const { t, canEditProjectTicketsEffective, loadProjectBugs, bugsLoading, createBugIssue, bugForm, setBugForm,
    componentsList, managingProjectId, buildsList, bugIssues, updateBugIssue } = context
  return (
<div className="animate__animated animate__fadeIn">
                      <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-4">
                        <h5 className="fw-bold text-dark m-0">{t('proyectos.bugTracker')}</h5>
                        <Button variant="outline-secondary" size="sm" className="fw-bold rounded-pill px-3" onClick={loadProjectBugs} disabled={bugsLoading}><RefreshCw size={14} className="me-1" /> {t('proyectos.refresh')}</Button>
                      </div>

                      {canEditProjectTicketsEffective && <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mb-4">
                        <Form onSubmit={createBugIssue}>
                          <Row className="g-3">
                            <Col md={5}>
                              <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.bugTitle')}</RequiredLabel></Form.Label>
                              <Form.Control value={bugForm.titulo} onChange={(e) => setBugForm({ ...bugForm, titulo: e.target.value })} placeholder={t('proyectos.bugTitlePlaceholder')} required />
                            </Col>
                            <Col md={2}>
                              <Form.Label className="x-small fw-bold text-muted">{t('proyectos.severity')}</Form.Label>
                              <Form.Select value={bugForm.severidad} onChange={(e) => setBugForm({ ...bugForm, severidad: e.target.value })}>
                                {['BLOCKER', 'CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map(item => <option key={item} value={item}>{item}</option>)}
                              </Form.Select>
                            </Col>
                            <Col md={2}>
                              <Form.Label className="x-small fw-bold text-muted">{t('proyectos.priority')}</Form.Label>
                              <Form.Select value={bugForm.prioridad} onChange={(e) => setBugForm({ ...bugForm, prioridad: e.target.value })}>
                                {['ALTA', 'MEDIA', 'BAJA'].map(item => <option key={item} value={item}>{item}</option>)}
                              </Form.Select>
                            </Col>
                            <Col md={3}>
                              <Form.Label className="x-small fw-bold text-muted">{t('proyectos.component')}</Form.Label>
                              <Form.Select value={bugForm.componente_id} onChange={(e) => setBugForm({ ...bugForm, componente_id: e.target.value })}>
                                <option value="">{t('proyectos.noComponent')}</option>
                                {componentsList.filter((c: any) => c.projectId === managingProjectId).map((component: any) => <option key={component.id} value={component.id}>{component.name}</option>)}
                              </Form.Select>
                            </Col>
                            <Col md={9}>
                              <Form.Label className="x-small fw-bold text-muted">{t('proyectos.description')}</Form.Label>
                              <Form.Control as="textarea" rows={2} value={bugForm.descripcion} onChange={(e) => setBugForm({ ...bugForm, descripcion: e.target.value })} placeholder={t('proyectos.descriptionPlaceholder')} />
                            </Col>
                            <Col md={3}>
                              <Form.Label className="x-small fw-bold text-muted">{t('proyectos.build')}</Form.Label>
                              <Form.Select value={bugForm.build_id} onChange={(e) => setBugForm({ ...bugForm, build_id: e.target.value })}>
                                <option value="">{t('proyectos.activeBuildLabel')}</option>
                                {buildsList.filter((build: any) => build.projectId === managingProjectId).map((build: any) => <option key={build.id} value={build.id}>{build.name}</option>)}
                              </Form.Select>
                              <Button type="submit" variant="danger" size="sm" className="fw-bold rounded-pill px-3 mt-3 w-100"><Bug size={14} className="me-1" /> {t('proyectos.createBug')}</Button>
                            </Col>
                          </Row>
                        </Form>
                      </Card>}

                      <Row className="g-3 mb-4">
                        {PROJECT_BUG_COLUMNS.map((column) => {
                          const items = bugIssues.filter((bug: any) => column.statuses.includes(bug.estado || 'ABIERTO'))
                          return (
                            <Col lg={3} md={6} key={column.id}>
                              <Card className="border-0 shadow-sm bg-light h-100">
                                <Card.Header className="bg-white fw-bold py-3 border-bottom-0 d-flex justify-content-between align-items-center">
                  <span><KanbanSquare size={18} className="me-2" />{t(`proyectos.${column.labelKey}`)}</span>
                                  <Badge bg="light" text="dark" className="border">{items.length}</Badge>
                                </Card.Header>
                                <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                                  {items.length === 0 && <div className="small text-muted p-3 bg-white rounded-3 border">{t('proyectos.noBugs')}</div>}
                                  {items.map((bug: any) => (
                                    <div key={bug.id} className={`p-3 bg-white border rounded-3 shadow-sm border-start border-4 ${bug.severidad === 'BLOCKER' || bug.severidad === 'CRITICA' ? 'border-danger' : bug.severidad === 'ALTA' ? 'border-warning' : 'border-primary'}`}>
                                      <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">{bug.codigo}</strong> <Badge bg={bug.severidad === 'BLOCKER' || bug.severidad === 'CRITICA' ? 'danger' : bug.severidad === 'ALTA' ? 'warning' : 'secondary'}>{bug.severidad}</Badge></div>
                                      <Badge bg="light" text="dark" className="border mb-2">{String(bug.estado || 'ABIERTO').replaceAll('_', ' ')}</Badge>
                                      <p className="x-small text-muted mb-2">{bug.titulo}</p>
                                      {bug.descripcion && <div className="x-small text-secondary mb-2">{bug.descripcion}</div>}
                                      {canEditProjectTicketsEffective ? (
                                        <Form.Select size="sm" value={bug.estado} onChange={(e) => updateBugIssue(bug, { estado: e.target.value })}>
                                          {BUG_STATUS_OPTIONS.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}
                                        </Form.Select>
                                      ) : (
                                        <Badge bg="light" text="dark" className="border">{String(bug.estado || 'ABIERTO').replaceAll('_', ' ')}</Badge>
                                      )}
                                    </div>
                                  ))}
                                </Card.Body>
                              </Card>
                            </Col>
                          )
                        })}
                      </Row>

                      <Row className="g-2 d-none">
                        <Col md={4}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Header className="bg-white fw-bold text-danger py-3 border-bottom-0"><KanbanSquare size={18} className="me-2" />Bugs Reportados</Card.Header>
                            <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-danger">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">BUG-453</strong> <Badge bg="danger">Blocker</Badge></div>
                                <p className="x-small text-muted mb-2">Timeout en Login con MFA. El endpoint responde 504 en Staging.</p>
                                <div className="x-small fw-bold text-secondary">Asignado a: Dev Backend</div>
                              </div>
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-warning">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">BUG-457</strong> <Badge bg="warning" text="dark">Medium</Badge></div>
                                <p className="x-small text-muted mb-2">Responsive incorrecto en Tablet al abrir el carrito.</p>
                                <div className="x-small fw-bold text-secondary">Asignado a: Frontend UI</div>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                        <Col md={4}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Header className="bg-white fw-bold text-primary py-3 border-bottom-0"><KanbanSquare size={18} className="me-2" />{t('proyectos.qaImprovementsTasks')}</Card.Header>
                            <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-primary">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark">TSK-102</strong> <Badge bg="primary">To Do</Badge></div>
                                <p className="x-small text-muted mb-2">{t('proyectos.qaAutomationTask')}</p>
                                <div className="x-small fw-bold text-secondary">{t('proyectos.qaAssignedTo')}</div>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                        <Col md={4}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Header className="bg-white fw-bold text-success py-3 border-bottom-0"><CheckCircle2 size={18} className="me-2" />{t('proyectos.resolvedReleaseReady')}</Card.Header>
                            <Card.Body className="d-flex flex-column gap-2 p-2 pt-0">
                              <div className="p-3 bg-white border rounded-3 shadow-sm border-start border-4 border-success opacity-75">
                                <div className="d-flex justify-content-between mb-1"><strong className="small text-dark text-decoration-line-through">BUG-451</strong> <Badge bg="success">Done</Badge></div>
                                <p className="x-small text-muted mb-0">{t('proyectos.qaSslFix')}</p>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                      </Row>
                    </div>
  )
}
