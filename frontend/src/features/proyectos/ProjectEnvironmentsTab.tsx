import { useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Edit, Info, Plus, Trash2 } from 'lucide-react'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

export function ProjectEnvironmentsTab({ context }: { context: any }) {
  const [showVariableHelp, setShowVariableHelp] = useState(false)
  const datasetEnvironmentRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const { t,
    canReadProjectEnvironments,
    canReadProjectDatasets,
    canEditProjectEnvironmentsEffective,
    canEditProjectDatasetsEffective,
    openEnvironmentModal,
    handleSaveProjectEnvironment,
    projectEnvironments,
    datasetFormEnvId,
    setDatasetFormEnvId,
    handleDeleteProjectEnvironment,
    handleSaveEnvironmentDataset,
    getDatasetDraft,
    isDatasetDraftDirty,
    savingDatasetId,
    savedDatasetId,
    handleDatasetSubmit,
    handleSetDefaultEnvironmentDataset,
    setDatasetDrafts,
    handleDeleteEnvironmentDataset,
    updateDatasetDraft } = context
  const toggleDatasetForm = (environmentId: string) => {
    const shouldOpen = datasetFormEnvId !== environmentId
    setDatasetFormEnvId(shouldOpen ? environmentId : null)
    if (shouldOpen) {
      window.setTimeout(() => datasetEnvironmentRefs.current[environmentId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
    }
  }
  const chatbotBindings = (env: any) => Object.entries(env.chatbotConfig?.profile_bindings || {}).filter(([, variable]) => typeof variable === 'string' && variable.trim()) as [string, string][]
  const environmentStatusLabel = (status: string) => status === 'Online' ? t('proyectos.environmentOnline') : status === 'Offline' ? t('proyectos.environmentOffline') : status === 'Maintenance' ? t('proyectos.environmentMaintenance') : status === 'Unknown' ? t('proyectos.environmentUnknown') : status
  const datasetMissingChatbotVariables = (env: any, dataset: any) => chatbotBindings(env).map(([, variable]) => variable).filter(variable => {
    const variables = dataset?.variables || {}
    return !Object.keys(variables).some(key => key === variable || key.toLowerCase() === variable.toLowerCase() || key === `DATASET.${variable}`)
  })
  const completeLocalChatbotDemo = (env: any, dataset: any) => {
    const isLocalChatbot = `${env.url || ''} ${env.chatbotConfig?.connection?.endpoint || ''}`.includes('127.0.0.1:8091')
    if (!isLocalChatbot) return
    const defaults: Record<string, string> = { name: 'Jorge', age: '65', gender: 'no especificado', language: 'es', writing_level: 'bajo', spelling_errors: 'true', tone: 'confundido', goal: 'consultar vencimiento de licencia', user_id: 'qa-1', cart_items: '3', cart_total: '12500' }
    const variables = { ...(dataset.variables || {}) }
    chatbotBindings(env).forEach(([field, variable]) => { if (!(variable in variables)) variables[variable] = defaults[field] || defaults[variable] || 'demo' })
    updateDatasetDraft(dataset, { variablesText: Object.entries(variables).map(([key, value]) => `${key}=${value}`).join('\n') })
  }
  return (
<>
<div className="project-environments-tab animate__animated animate__fadeIn">
                      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 border-bottom pb-2 mb-4">
                        <div className="min-w-0">
                          <h5 className="fw-bold text-dark m-0">{t('proyectos.envsTitle')}</h5>
                          <div className="small text-muted">{t('proyectos.envsSubtitle')}</div>
                        </div>
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <Button
                            variant="outline-primary"
                            size="sm"
                            className="fw-bold rounded-pill px-3"
                            onClick={() => setShowVariableHelp(true)}
                          >
                            <Info size={15} className="me-1" aria-hidden="true" /> {t('proyectos.variableResolutionHelpButton')}
                          </Button>
                          {canEditProjectEnvironmentsEffective && (
                            <Button variant="primary" size="sm" className="fw-bold rounded-pill px-3" onClick={() => openEnvironmentModal()}>
                              <Plus size={15} className="me-1" aria-hidden="true" /> {t('proyectos.newEnvironment')}
                            </Button>
                          )}
                        </div>
                      </div>
                      <Form className="d-none" onSubmit={handleSaveProjectEnvironment}>
                        <Row className="g-2 align-items-end">
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.envName')}</RequiredLabel></Form.Label>
                            <Form.Control name="envName" size="sm" placeholder={t('proyectos.envNamePlaceholder')} required />
                          </Col>
                          <Col md={4}>
                            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.envUrl')}</RequiredLabel></Form.Label>
                            <Form.Control name="envUrl" size="sm" type="url" placeholder={t('proyectos.envUrlPlaceholder')} required />
                          </Col>
                          <Col md={2}>
                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.envVersion')}</Form.Label>
                            <Form.Control name="envVersion" size="sm" placeholder={t('proyectos.envVersionPlaceholder')} />
                          </Col>
                          <Col md={2}>
                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.envStatus')}</Form.Label>
                            <Form.Select name="envStatus" size="sm" defaultValue="Online">
                              <option value="Online">{t('proyectos.environmentOnline')}</option>
                              <option value="Offline">{t('proyectos.environmentOffline')}</option>
                              <option value="Maintenance">{t('proyectos.environmentMaintenance')}</option>
                              <option value="Unknown">{t('proyectos.environmentUnknown')}</option>
                            </Form.Select>
                          </Col>
                          <Col md={1}>
                            <Button type="submit" variant="primary" size="sm" className="w-100 fw-bold" title={t('proyectos.addEnvironment')} aria-label={t('proyectos.addEnvironment')}>+</Button>
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.envSearchUser')}</Form.Label>
                            <Form.Control name="envUSER" size="sm" placeholder={t('proyectos.envSearchUserPlaceholder')} />
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.envPassword')}</Form.Label>
                            <Form.Control name="envPASSWORD" size="sm" type="password" placeholder={t('proyectos.passwordPlaceholder')} />
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.envToken')}</Form.Label>
                            <Form.Control name="envTOKEN" size="sm" type="password" placeholder={t('proyectos.envTokenPlaceholder')} />
                          </Col>
                          <Col md={3}>
                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.envTenant')}</Form.Label>
                            <Form.Control name="envTENANT" size="sm" placeholder={t('proyectos.envTenantPlaceholder')} />
                          </Col>
                        </Row>
                      </Form>
                      <Table responsive hover className="border rounded-3 overflow-hidden shadow-sm align-middle">
                        <thead className="bg-light text-secondary small">
                          <tr>
                            <th className="py-3 px-4 border-0">{t('proyectos.envTableName')}</th>
                            <th className="py-3 border-0">{t('proyectos.envTableUrl')}</th>
                            <th className="py-3 border-0">{t('proyectos.envTableVariables')}</th>
                            <th className="py-3 border-0">{t('proyectos.envTableVersion')}</th>
                            <th className="py-3 border-0">{t('proyectos.envTableApiStatus')}</th>
                            <th className="py-3 px-4 border-0 text-end">{t('proyectos.envTableActions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectEnvironments.map((env: any) => (
                            <tr key={env.id}>
                              <td className="px-4 fw-bold text-dark">{env.name}</td>
                              <td className="font-monospace text-primary small text-break">{env.url}</td>
                              <td className="small text-muted">
                                <Badge bg="light" text="dark" className="border me-1">{t('proyectos.vars', { count: Object.keys(env.variables || {}).length })}</Badge>
                                <Badge bg="light" text="dark" className="border">{t('proyectos.datasetsCount', { count: (env.datasets || []).length })}</Badge>
                                {env.chatbotConfig?.connection && <Badge bg="info" text="dark" className="border ms-1">{t('proyectos.chatbotLabel')}</Badge>}
                              </td>
                              <td className="text-muted small">{env.version || t('proyectos.noVersion')}</td>
                              <td>
                                <Badge bg={env.status === 'Online' ? 'success' : env.status === 'Offline' ? 'danger' : 'warning'} text={env.status === 'Maintenance' ? 'dark' : undefined} className="fw-normal">
                                  <span className="d-inline-block bg-white rounded-circle me-1" style={{ width: '6px', height: '6px' }}></span>{environmentStatusLabel(env.status)}
                                </Badge>
                              </td>
                              <td className="px-4 text-end">
                                {canEditProjectDatasetsEffective && <Button variant="link" className="text-primary p-0 me-2" title={t('proyectos.addDataset')} aria-label={t('proyectos.environmentActionAria', { action: t('proyectos.addDataset'), environment: env.name })} onClick={() => toggleDatasetForm(env.id)}><Plus size={16} /></Button>}
                                {canEditProjectEnvironmentsEffective && <Button variant="link" className="text-muted p-0 me-2" title={t('proyectos.editEnvironment')} onClick={() => openEnvironmentModal(env)}><Edit size={16} /></Button>}
                                {canEditProjectEnvironmentsEffective && <Button variant="link" className="text-danger p-0" title={t('proyectos.hideEnvironment')} onClick={() => handleDeleteProjectEnvironment(env.id)}><Trash2 size={16} /></Button>}
                              </td>
                            </tr>
                          ))}
                          {projectEnvironments.length === 0 && (
                            <tr><td colSpan={6} className="text-center py-4 text-muted small">{t('proyectos.envNoEnvironments')}</td></tr>
                          )}
                        </tbody>
                      </Table>
                      {canReadProjectDatasets && <div className="mt-4">
                        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                          <div className="min-w-0">
                            <h6 className="fw-bold text-dark mb-1">{t('proyectos.datasetsByEnv')}</h6>
                            <div className="small text-muted">{t('proyectos.datasetsSubtitle')}</div>
                          </div>
                          <Badge bg="light" text="dark" className="border">
                            {t('proyectos.totalDatasets', { count: projectEnvironments.reduce((total: number, env: any) => total + (env.datasets || []).length, 0) })}
                          </Badge>
                        </div>
                        <Row className="g-3">
                          {projectEnvironments.map((env: any) => (
                            <Col xl={6} key={`${env.id}-datasets`} ref={node => { datasetEnvironmentRefs.current[env.id] = node }}>
                              <Card className="border shadow-sm h-100">
                                <Card.Header className="bg-white d-flex flex-wrap justify-content-between align-items-start gap-2">
                                  <div className="dataset-environment-heading flex-grow-1 min-w-0">
                                    <div className="fw-bold text-dark">{env.name}</div>
                                    <div className="font-monospace x-small text-primary text-break" title={env.url}>{env.url}</div>
                                  </div>
                                  <div className="d-flex flex-wrap align-items-center justify-content-end gap-2">
                                    <Badge bg="light" text="dark" className="border">{t('proyectos.datasetsCount', { count: (env.datasets || []).length })}</Badge>
                                    {canEditProjectDatasetsEffective && (
                                      <Button variant="outline-primary" size="sm" className="x-small fw-bold text-nowrap" onClick={() => toggleDatasetForm(env.id)}>
                                        <Plus size={13} className="me-1" /> {t('proyectos.addDataset')}
                                      </Button>
                                    )}
                                  </div>
                                </Card.Header>
                                <Card.Body>
                                  {datasetFormEnvId === env.id && canEditProjectDatasetsEffective && (
                                  <Form className="bg-light border rounded-3 p-3 mb-3" onSubmit={async (event) => {
                                    const ok = await handleSaveEnvironmentDataset(event, env.id)
                                    if (ok) setDatasetFormEnvId(null)
                                  }}>
                                    <Row className="g-2">
                                      <Col md={6}>
                                        <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.datasetName')}</RequiredLabel></Form.Label>
                                        <Form.Control name="datasetName" size="sm" placeholder={t('proyectos.datasetNamePlaceholder')} required />
                                      </Col>
                                      <Col md={6}>
                                        <Form.Label className="x-small fw-bold text-muted">{t('proyectos.datasetDescription')}</Form.Label>
                                        <Form.Control name="datasetDescription" size="sm" placeholder={t('proyectos.datasetDescriptionPlaceholder')} />
                                      </Col>
                                      <Col xs={12}>
                                        <Form.Label className="x-small fw-bold text-muted">{t('proyectos.datasetVariables')}</Form.Label>
                                        <Form.Control
                                          as="textarea"
                                          rows={3}
                                          name="datasetVariables"
                                          size="sm"
                                          className="font-monospace small"
                                          placeholder={t('proyectos.datasetVariablesPlaceholder')}
                                        />
                                      </Col>
                                      <Col xs={12} className="d-flex justify-content-between align-items-center">
                                        <Form.Check name="datasetDefault" label={t('proyectos.useAsDefault')} className="small" />
                                        <div className="d-flex gap-2">
                                          <Button type="button" size="sm" variant="outline-secondary" className="fw-bold" onClick={() => setDatasetFormEnvId(null)}>{t('proyectos.cancel')}</Button>
                                          <Button type="submit" size="sm" variant="primary" className="fw-bold">{t('proyectos.createDataset')}</Button>
                                        </div>
                                      </Col>
                                    </Row>
                                  </Form>
                                  )}
                                  <div className="d-flex flex-column gap-2">
                                    {(env.datasets || []).map((dataset: any) => {
                                      const draft = getDatasetDraft(dataset)
                                      const dirty = isDatasetDraftDirty(dataset)
                                      const saving = savingDatasetId === dataset.id
                                      const justSaved = savedDatasetId === dataset.id
                                      return (
                                      <Form key={dataset.id} className="border rounded-3 bg-white p-3" onSubmit={(event) => handleDatasetSubmit(event, env.id, dataset)}>
                                        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                                          <div className="d-flex flex-wrap align-items-center gap-2 min-w-0">
                                            <Badge bg={dataset.isDefault ? 'success' : 'light'} text={dataset.isDefault ? undefined : 'dark'} className="border">
                                              {dataset.isDefault ? t('proyectos.default') : t('proyectos.dataset')}
                                            </Badge>
                                            {justSaved && <Badge bg="success" className="border">{t('proyectos.changesSaved')}</Badge>}
                                            <span className="x-small text-muted font-monospace text-break">{dataset.id}</span>
                                          </div>
                                          <div className="d-flex flex-wrap justify-content-end gap-2">
                                            {canEditProjectDatasetsEffective && !dataset.isDefault && (
                                              <Button type="button" variant="outline-success" size="sm" className="x-small" onClick={async () => {
                                                const ok = await handleSetDefaultEnvironmentDataset(env.id, dataset.id)
                                                if (ok) {
                                                  setDatasetDrafts(prev => {
                                                    const next = { ...prev }
                                                    Object.keys(next).forEach(key => {
                                                      next[key] = { ...next[key], isDefault: key === dataset.id }
                                                    })
                                                    return next
                                                  })
                                                }
                                              }}>{t('proyectos.markAsDefault')}</Button>
                                            )}
                                            {canEditProjectDatasetsEffective && (
                                              <Button type="submit" variant={dirty ? 'primary' : 'secondary'} size="sm" className="x-small" disabled={!dirty || saving}>
                                                {saving ? t('proyectos.saving') : dirty ? t('proyectos.save') : t('proyectos.noChanges')}
                                              </Button>
                                            )}
                                            {canEditProjectDatasetsEffective && (
                                              <Button type="button" variant="outline-danger" size="sm" className="x-small" onClick={async () => {
                                                const ok = await handleDeleteEnvironmentDataset(env.id, dataset.id)
                                                if (ok) {
                                                  setDatasetDrafts(prev => {
                                                    const next = { ...prev }
                                                    delete next[dataset.id]
                                                    return next
                                                  })
                                                }
                                              }}><Trash2 size={13} /></Button>
                                            )}
                                          </div>
                                        </div>
                                        <Row className="g-2">
                                          <Col md={5}>
                                            <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>{t('proyectos.datasetName')}</RequiredLabel></Form.Label>
                                            <Form.Control name="datasetName" size="sm" value={draft.name} onChange={(event) => updateDatasetDraft(dataset, { name: event.target.value })} required disabled={!canEditProjectDatasetsEffective} />
                                          </Col>
                                          <Col md={7}>
                                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.datasetDescription')}</Form.Label>
                                            <Form.Control name="datasetDescription" size="sm" value={draft.description} onChange={(event) => updateDatasetDraft(dataset, { description: event.target.value })} disabled={!canEditProjectDatasetsEffective} />
                                          </Col>
                                          <Col xs={12}>
                                            <Form.Label className="x-small fw-bold text-muted">{t('proyectos.datasetVariables')}</Form.Label>
                                            <Form.Control
                                              as="textarea"
                                              rows={4}
                                              name="datasetVariables"
                                              size="sm"
                                              className="font-monospace small"
                                              value={draft.variablesText}
                                              onChange={(event) => updateDatasetDraft(dataset, { variablesText: event.target.value })}
                                              disabled={!canEditProjectDatasetsEffective}
                                            />
                                            <div className="small text-muted mt-2">{t('proyectos.chatbotDatasetHelp')} {t('proyectos.chatbotDatasetProfileExample')}</div>
                                            {env.chatbotConfig?.profile_bindings && Object.keys(env.chatbotConfig.profile_bindings).length > 0 && (
                                              <Alert variant={datasetMissingChatbotVariables(env, dataset).length ? 'warning' : 'light'} className="small py-2 mt-2 mb-0">
                                                <div className="fw-semibold">{t('proyectos.chatbotDatasetUsedVariables')}: {chatbotBindings(env).map(([field, variable]) => `${field} → ${variable}`).join(' · ')}</div>
                                                <div className={datasetMissingChatbotVariables(env, dataset).length ? 'text-warning-emphasis' : 'text-muted'}>
                                                  {datasetMissingChatbotVariables(env, dataset).length
                                                    ? `${t('proyectos.chatbotDatasetMissingVariables')}: ${datasetMissingChatbotVariables(env, dataset).join(', ')}`
                                                    : t('proyectos.chatbotDatasetNoMissingVariables')}
                                                </div>
                                                {`${env.url || ''} ${env.chatbotConfig?.connection?.endpoint || ''}`.includes('127.0.0.1:8091') && datasetMissingChatbotVariables(env, dataset).length > 0 && canEditProjectDatasetsEffective && <Button type="button" size="sm" variant="outline-primary" className="mt-2" onClick={() => completeLocalChatbotDemo(env, dataset)}>{t('proyectos.chatbotDatasetFillDemo')}</Button>}
                                              </Alert>
                                            )}
                                          </Col>
                                          <Col xs={12} className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                                            <Form.Check name="datasetDefault" label={t('proyectos.useAsDefault')} className="small" checked={draft.isDefault} onChange={(event) => updateDatasetDraft(dataset, { isDefault: event.target.checked })} disabled={!canEditProjectDatasetsEffective} />
                                            <div className="small text-muted text-break">
                                              {t('proyectos.useInTests', { code1: '{{DATASET.usuario}}', code2: '{{usuario}}' })}
                                            </div>
                                          </Col>
                                        </Row>
                                      </Form>
                                    )})}
                                    {(env.datasets || []).length === 0 && (
                                      <div className="text-center text-muted small border rounded-3 bg-white py-3">{t('proyectos.noDatasets')}</div>
                                    )}
                                  </div>
                                </Card.Body>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      </div>}
                    </div>
                    <Modal
                      show={showVariableHelp}
                      onHide={() => setShowVariableHelp(false)}
                      size="xl"
                      centered
                      scrollable
                      dialogClassName="variable-resolution-modal"
                      aria-labelledby="variable-resolution-modal-title"
                    >
                      <Modal.Header closeButton>
                        <Modal.Title id="variable-resolution-modal-title" className="d-flex align-items-center gap-2">
                          <Info size={20} className="text-primary" aria-hidden="true" />
                          {t('proyectos.variableResolutionModalTitle')}
                        </Modal.Title>
                      </Modal.Header>
                      <Modal.Body>
                        <Alert variant="primary" className="mb-4">
                          <div className="fw-bold mb-1">{t('proyectos.variableResolutionEnvironmentTitle')}</div>
                          <div>{t('proyectos.variableResolutionEnvironmentDescription')}</div>
                        </Alert>
                        <Row className="g-3 mb-4">
                          <Col md={6}>
                            <Card className="h-100 border shadow-sm">
                              <Card.Body>
                                <Card.Title as="h5">{t('proyectos.variableResolutionEnvironmentCardTitle')}</Card.Title>
                                <Card.Text className="text-muted">{t('proyectos.variableResolutionEnvironmentCardDescription')}</Card.Text>
                                <ul className="small text-muted mb-0">
                                  <li>{t('proyectos.variableResolutionEnvironmentItemUrl')}</li>
                                  <li>{t('proyectos.variableResolutionEnvironmentItemVersion')}</li>
                                  <li>{t('proyectos.variableResolutionEnvironmentItemVariables')}</li>
                                </ul>
                              </Card.Body>
                            </Card>
                          </Col>
                          <Col md={6}>
                            <Card className="h-100 border shadow-sm">
                              <Card.Body>
                                <Card.Title as="h5">{t('proyectos.variableResolutionDatasetCardTitle')}</Card.Title>
                                <Card.Text className="text-muted">{t('proyectos.variableResolutionDatasetCardDescription')}</Card.Text>
                                <ul className="small text-muted mb-0">
                                  <li>{t('proyectos.variableResolutionDatasetItemReusable')}</li>
                                  <li>{t('proyectos.variableResolutionDatasetItemDefault')}</li>
                                  <li>{t('proyectos.variableResolutionDatasetItemSelection')}</li>
                                </ul>
                              </Card.Body>
                            </Card>
                          </Col>
                        </Row>
                        <h5 className="fw-bold">{t('proyectos.variableResolutionLevelsTitle')}</h5>
                        <p className="text-muted">{t('proyectos.variableResolutionLevelsDescription')}</p>
                        <Table responsive bordered hover className="align-middle mb-4">
                          <thead className="table-light">
                            <tr>
                              <th>{t('proyectos.variableResolutionLevel')}</th>
                              <th>{t('proyectos.variableResolutionPurpose')}</th>
                              <th>{t('proyectos.variableResolutionToken')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="fw-bold">{t('proyectos.variableResolutionEnvironment')}</td>
                              <td>{t('proyectos.variableResolutionEnvironmentHelp')}</td>
                              <td translate="no"><code>{'{{ENV.variable}}'}</code></td>
                            </tr>
                            <tr>
                              <td className="fw-bold">{t('proyectos.variableResolutionComponent')}</td>
                              <td>{t('proyectos.variableResolutionComponentHelp')}</td>
                              <td translate="no"><code>{'{{COMPONENT.variable}}'}</code></td>
                            </tr>
                            <tr>
                              <td className="fw-bold">{t('proyectos.variableResolutionDataset')}</td>
                              <td>{t('proyectos.variableResolutionDatasetHelp')}</td>
                              <td translate="no"><code>{'{{DATASET.variable}}'}</code></td>
                            </tr>
                            <tr>
                              <td className="fw-bold">{t('proyectos.variableResolutionCase')}</td>
                              <td>{t('proyectos.variableResolutionCaseHelp')}</td>
                              <td translate="no"><code>{'{{variable}}'}</code></td>
                            </tr>
                          </tbody>
                        </Table>
                        <Row className="g-3">
                          <Col md={6}>
                            <Card className="h-100 border">
                              <Card.Body>
                                <Card.Title as="h5">{t('proyectos.variableResolutionOrderTitle')}</Card.Title>
                                <Card.Text className="mb-2">{t('proyectos.variableResolutionOrderDescription')}</Card.Text>
                                <div className="text-center fw-bold text-primary py-2" translate="no">{t('proyectos.variableResolutionPrecedence')}</div>
                                <Card.Text className="small text-muted mb-0">{t('proyectos.variableResolutionOrderExample')}</Card.Text>
                              </Card.Body>
                            </Card>
                          </Col>
                          <Col md={6}>
                            <Card className="h-100 border">
                              <Card.Body>
                                <Card.Title as="h5">{t('proyectos.variableResolutionRecommendedTitle')}</Card.Title>
                                <Card.Text className="text-muted">{t('proyectos.variableResolutionRecommendedDescription')}</Card.Text>
                                <div className="font-monospace small bg-light rounded p-3" translate="no">
                                  <div>{'{{ENV.base_url}}'}</div>
                                  <div>{'{{COMPONENT.service_name}}'}</div>
                                  <div>{'{{DATASET.usuario}}'}</div>
                                  <div>{'{{case_marker}}'}</div>
                                </div>
                              </Card.Body>
                            </Card>
                          </Col>
                        </Row>
                      </Modal.Body>
                      <Modal.Footer>
                        <Button variant="primary" onClick={() => setShowVariableHelp(false)}>{t('proyectos.variableResolutionClose')}</Button>
                      </Modal.Footer>
                    </Modal>
                    </>
  )
}
