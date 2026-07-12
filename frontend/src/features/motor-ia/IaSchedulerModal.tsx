import type { Dispatch, SetStateAction } from 'react'
import { Badge, Button, Card, Col, Form, ListGroup, Modal, Row } from 'react-bootstrap'
import { Clock, Cpu, Globe, Layers, Search, Send, Settings } from 'lucide-react'
import { flattenSuites } from '../../testRepositoryUtils'

type IaSchedulerModalProps = {
  show: boolean
  onHide: () => void
  visibleSuiteTree: any[]
  currentProjectCases: any[]
  belongsToCurrentComponent: (test: any) => boolean
  schedulerSearch: string
  setSchedulerSearch: (value: string) => void
  selectedTestsForIa: string[]
  setSelectedTestsForIa: Dispatch<SetStateAction<string[]>>
  execName: string
  setExecName: (value: string) => void
  scheduledTime: string
  setScheduledTime: (value: string) => void
  buildsList: any[]
  currentBuildId: string
  iaProvider: string
  onLaunch: (mode?: 'now' | 'scheduled') => void
}

export function IaSchedulerModal({
  show,
  onHide,
  visibleSuiteTree,
  currentProjectCases,
  belongsToCurrentComponent,
  schedulerSearch,
  setSchedulerSearch,
  selectedTestsForIa,
  setSelectedTestsForIa,
  execName,
  setExecName,
  scheduledTime,
  setScheduledTime,
  buildsList,
  currentBuildId,
  iaProvider,
  onLaunch
}: IaSchedulerModalProps) {
  const query = schedulerSearch.toLowerCase()
  const caseDisplayCode = (test: any) => test.code || test.codigo || test.caseCode || test.id?.slice(0, 8) || 'SIN-ID'

  return (
    <Modal show={show} onHide={onHide} size="xl" centered backdrop="static" contentClassName="border-0 shadow-lg rounded-4 overflow-hidden">
      <Modal.Header closeButton className="bg-dark text-white border-0 py-3">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2 fs-5">
          <Cpu size={22} className="text-info" /> Configurar despliegue de agente IA
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="p-0 text-dark text-start bg-light">
        <Row className="g-0" style={{ height: '70vh' }}>
          <Col md={7} className="border-end border-light-subtle bg-white d-flex flex-column h-100">
            <div className="p-3 border-bottom bg-light">
              <h6 className="fw-bold text-secondary mb-2 text-uppercase" style={{ fontSize: '0.8rem', letterSpacing: '0.5px' }}>Catálogo global de pruebas</h6>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-white text-muted border-end-0"><Search size={14} /></span>
                <Form.Control
                  type="text"
                  placeholder="Buscar en todas las suites por nombre o ID..."
                  className="border-start-0 shadow-none ps-0"
                  value={schedulerSearch}
                  onChange={(e) => setSchedulerSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-grow-1 overflow-auto p-3">
              {flattenSuites(visibleSuiteTree).map(suite => {
                const suiteTests = currentProjectCases.filter(test => belongsToCurrentComponent(test) && test.suiteId === suite.id && (
                  test.title.toLowerCase().includes(query) ||
                  caseDisplayCode(test).toLowerCase().includes(query) ||
                  test.id.toLowerCase().includes(query)
                ))

                if (suiteTests.length === 0) return null

                const allSelected = suiteTests.every(test => selectedTestsForIa.includes(test.id))

                return (
                  <Card key={suite.id} className="border-light-subtle shadow-sm mb-3">
                    <Card.Header className="bg-light py-2 d-flex justify-content-between align-items-center border-bottom-0">
                      <div className="d-flex align-items-center gap-2">
                        <Form.Check
                          type="checkbox"
                          className="cursor-pointer shadow-none"
                          checked={allSelected}
                          onChange={(e) => {
                            const ids = suiteTests.map(test => test.id)
                            if (e.target.checked) {
                              setSelectedTestsForIa(prev => Array.from(new Set([...prev, ...ids])))
                            } else {
                              setSelectedTestsForIa(prev => prev.filter(id => !ids.includes(id)))
                            }
                          }}
                        />
                        <span className="fw-bold text-dark small">{suite.nombre}</span>
                      </div>
                      <Badge bg="secondary" className="opacity-75">{suiteTests.length} casos</Badge>
                    </Card.Header>
                    <ListGroup variant="flush">
                      {suiteTests.map(test => (
                        <ListGroup.Item
                          key={test.id}
                          className="py-2 px-3 border-light d-flex align-items-center gap-3 hover-bg-light cursor-pointer"
                          onClick={() => {
                            setSelectedTestsForIa(prev => prev.includes(test.id) ? prev.filter(id => id !== test.id) : [...prev, test.id])
                          }}
                        >
                          <Form.Check
                            type="checkbox"
                            className="cursor-pointer shadow-none pointer-events-none"
                            checked={selectedTestsForIa.includes(test.id)}
                            readOnly
                          />
                          <div className="flex-grow-1 text-truncate">
                            <span className="fw-bold text-primary font-monospace x-small me-2">{caseDisplayCode(test)}</span>
                            <span className="small text-dark fw-medium">{test.title}</span>
                          </div>
                          <Badge bg="light" text="dark" className="border fw-normal x-small">{test.component}</Badge>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  </Card>
                )
              })}
            </div>
          </Col>

          <Col md={5} className="d-flex flex-column bg-light h-100 p-4 overflow-auto">
            <h6 className="fw-bold text-secondary mb-3 text-uppercase" style={{ fontSize: '0.8rem', letterSpacing: '0.5px' }}>
              Planilla de despliegue
            </h6>

            <Card className="border-0 shadow-sm rounded-3 mb-3">
              <Card.Body className="p-3">
                <Form.Group className="mb-3">
                  <Form.Label className="x-small fw-bold text-muted mb-1">NOMBRE DE LA EJECUCIÓN</Form.Label>
                  <Form.Control type="text" size="sm" value={execName} onChange={(e) => setExecName(e.target.value)} className="bg-light fw-bold text-dark" />
                </Form.Group>
                <Form.Group>
                  <Form.Label className="x-small fw-bold text-muted mb-1 d-flex gap-1 align-items-center"><Clock size={12} /> HORARIO PROGRAMADO</Form.Label>
                  <Form.Control type="datetime-local" size="sm" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="bg-light text-dark" />
                </Form.Group>
              </Card.Body>
            </Card>

            <Card className="border-0 shadow-sm rounded-3 mb-3">
              <Card.Body className="p-3">
                <h6 className="x-small fw-bold text-muted mb-3">CONTEXTO DE ENTORNO</h6>
                <div className="d-flex align-items-center justify-content-between mb-2 small">
                  <span className="text-secondary d-flex align-items-center gap-1"><Layers size={14} /> Build activa</span>
                  <span className="fw-bold text-dark text-truncate" style={{ maxWidth: '150px' }}>{buildsList.find(build => build.id === currentBuildId)?.name || 'N/A'}</span>
                </div>
                <div className="d-flex align-items-center justify-content-between mb-2 small">
                  <span className="text-secondary d-flex align-items-center gap-1"><Globe size={14} /> Ambiente</span>
                  <span className="fw-bold text-dark">Staging (QA)</span>
                </div>
                <div className="d-flex align-items-center justify-content-between small">
                  <span className="text-secondary d-flex align-items-center gap-1"><Settings size={14} /> Modelo NLP</span>
                  <Badge bg="primary" className="fw-normal">{iaProvider.toUpperCase()}</Badge>
                </div>
              </Card.Body>
            </Card>

            <div className="mt-auto pt-3 border-top border-light-subtle">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="fw-bold text-secondary">Total seleccionados:</span>
                <h3 className={`m-0 fw-bold ${selectedTestsForIa.length > 0 ? 'text-primary' : 'text-danger'}`}>
                  {selectedTestsForIa.length}
                </h3>
              </div>
              <div className="d-flex gap-2 ia-launch-actions">
                <Button variant="outline-secondary" className="fw-bold shadow-none" onClick={onHide}>Cancelar</Button>
                <Button
                  variant="outline-primary"
                  className="fw-bold shadow-none d-flex justify-content-center align-items-center gap-2"
                  disabled={selectedTestsForIa.length === 0 || !scheduledTime}
                  onClick={() => onLaunch('scheduled')}
                >
                  <Clock size={16} /> Programar
                </Button>
                <Button
                  variant="primary"
                  className="fw-bold flex-grow-1 shadow-sm d-flex justify-content-center align-items-center gap-2"
                  disabled={selectedTestsForIa.length === 0}
                  onClick={() => onLaunch('now')}
                >
                  <Send size={16} /> Ejecutar ahora
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      </Modal.Body>
    </Modal>
  )
}

