import { Badge, Button, Card, Col, Form, ListGroup, Row } from 'react-bootstrap'
import { Image as ImageIcon, Info, Trash2 } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

export function ProjectConfigTab({
  t, canEditProjectPortfolio, canReadProjectTeam, canEditProject, projectsList, managingProjectId,
  setShowProjectStatusHelp, handleUpdateProject, canEditProjectTeamEffective, handleAddProjectMember,
  projectMembers, handleRemoveProjectMember,
}: any) {
  return (
                    <div className="animate__animated animate__fadeIn">
                      <h5 className="fw-bold text-dark mb-4 border-bottom pb-2">{canReadProjectTeam ? t('proyectos.infoAndTeam') : t('proyectos.info')}</h5>
                      <Row className="g-2">
                        {canEditProject && (
                        <Col md={canReadProjectTeam ? 6 : 12}>
                          <Card className="border-0 shadow-sm bg-light">
                            <Form onSubmit={handleUpdateProject}>
                            <Card.Body>
                              <div className="d-flex align-items-center gap-3 mb-3">
                                <div className="project-avatar">
                                  {projectsList.find(p => p.id === managingProjectId)?.imageUrl ? (
                                    <img src={projectsList.find(p => p.id === managingProjectId)?.imageUrl} alt={projectsList.find(p => p.id === managingProjectId)?.name || t('proyectos.projectFallback')} onError={(event) => { event.currentTarget.style.display = 'none' }} />
                                  ) : (
                                    <ImageIcon size={22} className="text-primary" />
                                  )}
                                </div>
                                <div>
                                  <div className="fw-bold small text-dark">{t('proyectos.visualIdentity')}</div>
                                  <div className="text-muted x-small">{t('proyectos.visualIdentityHint')}</div>
                                </div>
                              </div>
                              <Form.Group className="mb-3">
                                <Form.Label className="small fw-bold text-muted"><RequiredLabel required>{t('proyectos.projectName')}</RequiredLabel></Form.Label>
                                <Form.Control name="projectName" type="text" defaultValue={projectsList.find(p => p.id === managingProjectId)?.name} className="fw-bold text-dark border-light-subtle" required disabled={!canEditProject} />
                              </Form.Group>
                              <Form.Group className="mb-3">
                                <Form.Label className="small fw-bold text-muted">{t('proyectos.projectLogo')}</Form.Label>
                                <Form.Control name="projectImageUrl" type="url" placeholder={t('proyectos.urlPlaceholder')} defaultValue={projectsList.find(p => p.id === managingProjectId)?.imageUrl || ''} className="border-light-subtle" disabled={!canEditProject} />
                              </Form.Group>
                              <Form.Group className="mb-3">
                                <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                                  <Form.Label className="small fw-bold text-muted mb-0">{t('proyectos.currentStatus')}</Form.Label>
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="project-status-help-btn p-0 text-primary shadow-none"
                                    onClick={() => setShowProjectStatusHelp(true)}
                                    title={t('proyectos.statusHelp')}
                                    aria-label={t('proyectos.statusHelp')}
                                  >
                                    <Info size={16} />
                                  </Button>
                                </div>
                                <Form.Select name="projectStatus" className="border-light-subtle" defaultValue={projectsList.find(p => p.id === managingProjectId)?.status || 'Activo'} disabled={!canEditProject}>
                                  <option value="Planificacion">{t('proyectos.planning')}</option>
                                  <option value="Activo">{t('proyectos.activeStatus')}</option>
                                  <option value="En QA">{t('proyectos.inQa')}</option>
                                  <option value="Bloqueado">{t('proyectos.blocked')}</option>
                                  <option value="Mantenimiento">{t('proyectos.maintenance')}</option>
                                  <option value="En Pausa">{t('proyectos.onHold')}</option>
                                  <option value="Cerrado">{t('proyectos.closed')}</option>
                                  <option value="Archivado">{t('proyectos.archived')}</option>
                                </Form.Select>
                              </Form.Group>
                              {canEditProject && (
                                <Button type="submit" variant="primary" size="sm" className="fw-bold px-4 rounded-pill shadow-sm">{t('proyectos.saveChanges')}</Button>
                              )}
                            </Card.Body>
                            </Form>
                          </Card>
                        </Col>
                        )}
                        {canReadProjectTeam && (
                        <Col md={6}>
                          <Card className="border-0 shadow-sm bg-light h-100">
                            <Card.Body>
                              <div className="d-flex justify-content-between align-items-center mb-3">
                                <span className="small fw-bold text-muted text-uppercase">{t('proyectos.assignedTeam')}</span>
                                {canEditProjectTeamEffective && (
                                  <Button variant="outline-primary" size="sm" className="x-small fw-bold py-1 px-2" onClick={handleAddProjectMember}>{t('proyectos.assignUser')}</Button>
                                )}
                              </div>
                              <ListGroup variant="flush" className="border rounded-3 overflow-hidden">
                                {projectMembers.filter(member => member.projectId === managingProjectId).map(member => (
                                  <ListGroup.Item key={member.id} className="d-flex justify-content-between align-items-center py-2 px-3 bg-white">
                                    <div>
                                      <div className="fw-bold small text-dark">{member.user?.name || member.userId}</div>
                                      <div className="x-small text-muted">{member.user?.email || t('proyectos.userBackend')}</div>
                                    </div>
                                    <div className="d-flex align-items-center gap-2">
                                      {canEditProjectTeamEffective && (
                                        <Button variant="link" size="sm" className="text-danger p-0 shadow-none" title={t('proyectos.removeFromProject')} onClick={() => handleRemoveProjectMember(member.userId)}><Trash2 size={14} /></Button>
                                      )}
                                    </div>
                                  </ListGroup.Item>
                                ))}
                                {projectMembers.filter(member => member.projectId === managingProjectId).length === 0 && (
                                  <ListGroup.Item className="text-center py-4 text-muted small bg-white">
                                    {t('proyectos.noMembersAssigned')}
                                  </ListGroup.Item>
                                )}
                              </ListGroup>
                            </Card.Body>
                          </Card>
                        </Col>
                        )}
                      </Row>
                    </div>
  )
}
