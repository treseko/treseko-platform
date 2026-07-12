import { Badge, Col, Modal, Row, Table } from 'react-bootstrap'
import { History } from 'lucide-react'
import { formatDateTime } from '../../shared/utils/dateTime'

type CaseVersionsModalProps = {
  show: boolean
  onHide: () => void
  versionsCase: any | null
  caseVersions: any[]
  selectedCompareVersionId: string | null
  setSelectedCompareVersionId: (id: string) => void
  getCasoVersionRows: (current: any, selected: any) => any[]
}

export function CaseVersionsModal({
  show,
  onHide,
  versionsCase,
  caseVersions,
  selectedCompareVersionId,
  setSelectedCompareVersionId,
  getCasoVersionRows
}: CaseVersionsModalProps) {
  const currentVersion = caseVersions[0]
  const selectedVersion = currentVersion
    ? caseVersions.find(version => version.id === selectedCompareVersionId) || caseVersions[1] || currentVersion
    : null
  const rows = currentVersion && selectedVersion ? getCasoVersionRows(currentVersion, selectedVersion) : []

  return (
    <Modal show={show} onHide={onHide} centered size="xl">
      <Modal.Header closeButton className="bg-light border-bottom text-dark">
        <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
          <History size={20} className="text-primary" /> Registro de cambios
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-start">
        <div className="mb-3">
          <div className="fw-bold text-dark">{versionsCase?.code || caseVersions[0]?.codigo} {versionsCase?.title || caseVersions[0]?.titulo}</div>
          <div className="small text-muted">Selecciona una versión para compararla contra la versión actual.</div>
        </div>
        {caseVersions.length === 0 || !currentVersion || !selectedVersion ? (
          <div className="text-muted small border rounded-3 p-3 bg-light">No hay versiones registradas.</div>
        ) : (
          <Row className="g-3">
            <Col md={3}>
              <div className="border rounded-3 overflow-hidden">
                <div className="bg-light border-bottom px-3 py-2 fw-bold small text-dark">Versiones</div>
                <div className="d-flex flex-column">
                  {caseVersions.map((version, index) => (
                    <button
                      key={version.id}
                      type="button"
                      className={`text-start border-0 border-bottom px-3 py-3 bg-white ${selectedVersion.id === version.id ? 'text-primary fw-bold' : 'text-dark'}`}
                      onClick={() => setSelectedCompareVersionId(version.id)}
                    >
                      <div className="d-flex justify-content-between align-items-center">
                        <span>v{version.version}</span>
                        {index === 0 && <Badge bg="primary" className="x-small">Actual</Badge>}
                      </div>
                      <div className="x-small text-muted fw-normal mt-1">
                        {formatDateTime(version.ultima_modificacion || version.fecha_creacion)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </Col>
            <Col md={9}>
              <div className="border rounded-3 overflow-hidden">
                <div className="bg-light border-bottom px-3 py-2 d-flex justify-content-between align-items-center">
                  <div className="fw-bold small text-dark">Comparación</div>
                  <Badge bg="light" text="dark" className="border">v{selectedVersion.version} vs v{currentVersion.version}</Badge>
                </div>
                <Table responsive hover className="align-middle mb-0 small">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: '150px' }}>Campo</th>
                      <th>Versión seleccionada</th>
                      <th>Versión actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.key} className={row.changed ? 'table-warning' : ''}>
                        <td className="fw-bold text-dark">{row.label}</td>
                        <td><pre className="m-0 small text-dark bg-transparent border-0 p-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{row.before}</pre></td>
                        <td><pre className="m-0 small text-dark bg-transparent border-0 p-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{row.after}</pre></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Col>
          </Row>
        )}
      </Modal.Body>
    </Modal>
  )
}
