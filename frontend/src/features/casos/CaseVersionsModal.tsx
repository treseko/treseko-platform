import { Badge, Col, Modal, Row, Table } from 'react-bootstrap'
import { ExternalLink, FileText, History } from 'lucide-react'
import { useI18n } from '../../i18n'
import { formatDateTime } from '../../shared/utils/dateTime'
import { isImageAsset, resolveAssetUrl } from '../../shared/utils/assets'
import { getEvidenceMissingReason, isEvidenceAvailable } from '../../shared/utils/evidenceAvailability'

type CaseVersionsModalProps = {
  show: boolean
  onHide: () => void
  versionsCase: any | null
  caseVersions: any[]
  selectedCompareVersionId: string | null
  setSelectedCompareVersionId: (id: string) => void
  getCasoVersionRows: (current: any, selected: any) => any[]
}

const formatStepText = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'Sin valor'
  return String(value)
}

function VersionStepAttachments({ step }: { step: any }) {
  const attachments = Array.isArray(step?.attachments) ? step.attachments : []
  if (attachments.length === 0) {
    return <div className="x-small text-muted mt-2">Sin evidencias adjuntas</div>
  }

  return (
    <div className="d-flex flex-wrap gap-2 mt-2">
      {attachments.map((link: any) => {
        const attachment = link?.attachment || link
        const url = resolveAssetUrl(attachment?.public_url)
        const available = isEvidenceAvailable(attachment)
        const image = available && isImageAsset(attachment)
        const label = link?.tipo === 'EXPECTED_REFERENCE' ? 'Resultado esperado' : 'Acción'
        const filename = attachment?.filename_original || 'Evidencia'

        if (!available || !url) {
          return (
            <span key={link?.id || attachment?.id || filename} className="border rounded-2 px-2 py-1 x-small text-warning-emphasis bg-warning-subtle" title={getEvidenceMissingReason(attachment)}>
              <FileText size={12} className="me-1" /> {label}: {filename}
            </span>
          )
        }

        return (
          <a
            key={link?.id || attachment?.id || filename}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="border rounded-2 bg-white p-1 d-flex align-items-center gap-2 text-decoration-none"
            title={`Abrir ${filename}`}
          >
            {image ? (
              <img src={url} alt={filename} className="rounded border" style={{ width: 42, height: 32, objectFit: 'cover' }} />
            ) : (
              <FileText size={17} className="text-primary" />
            )}
            <span className="x-small text-primary text-truncate" style={{ maxWidth: 150 }}>{label}: {filename}</span>
            <ExternalLink size={12} className="text-muted flex-shrink-0" />
          </a>
        )
      })}
    </div>
  )
}

function VersionSteps({ value }: { value: any }) {
  const steps = Array.isArray(value) ? value.slice().sort((a, b) => (a?.numero_paso || 0) - (b?.numero_paso || 0)) : []
  if (steps.length === 0) return <span className="text-muted">Sin pasos</span>

  return (
    <div className="d-flex flex-column gap-2">
      {steps.map((step: any, index: number) => (
        <div key={step?.id || `${step?.numero_paso || index}`} className="border rounded-2 p-2 bg-white">
          <div className="fw-bold text-dark mb-1">Paso {step?.numero_paso || index + 1}</div>
          <div className="x-small text-muted text-uppercase">Acción</div>
          <div className="small text-dark mb-2" style={{ whiteSpace: 'pre-wrap' }}>{formatStepText(step?.accion || step?.acción)}</div>
          <div className="x-small text-muted text-uppercase">Resultado esperado</div>
          <div className="small text-dark" style={{ whiteSpace: 'pre-wrap' }}>{formatStepText(step?.resultado_esperado)}</div>
          <VersionStepAttachments step={step} />
        </div>
      ))}
    </div>
  )
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
  const { t } = useI18n()
  const currentVersion = caseVersions[0]
  const selectedVersion = currentVersion
    ? caseVersions.find(version => version.id === selectedCompareVersionId) || caseVersions[1] || currentVersion
    : null
  const rows = currentVersion && selectedVersion ? getCasoVersionRows(currentVersion, selectedVersion) : []

  return (
    <Modal show={show} onHide={onHide} centered size="xl">
      <Modal.Header closeButton className="bg-light border-bottom text-dark">
        <Modal.Title className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
          <History size={20} className="text-primary" /> {t('casos.changeLog')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-start">
        <div className="mb-3">
          <div className="fw-bold text-dark">{versionsCase?.code || caseVersions[0]?.codigo} {versionsCase?.title || caseVersions[0]?.titulo}</div>
          <div className="small text-muted">{t('casos.selectVersion')}</div>
        </div>
        {caseVersions.length === 0 || !currentVersion || !selectedVersion ? (
          <div className="text-muted small border rounded-3 p-3 bg-light">{t('casos.noVersions')}</div>
        ) : (
          <Row className="g-3">
            <Col md={3}>
              <div className="border rounded-3 overflow-hidden">
                <div className="bg-light border-bottom px-3 py-2 fw-bold small text-dark">{t('casos.versions')}</div>
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
                        {index === 0 && <Badge bg="primary" className="x-small">{t('casos.current')}</Badge>}
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
                  <div className="fw-bold small text-dark">{t('casos.comparison')}</div>
                  <Badge bg="light" text="dark" className="border">v{selectedVersion.version} vs v{currentVersion.version}</Badge>
                </div>
                <Table responsive hover className="align-middle mb-0 small">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: '150px' }}>{t('casos.field')}</th>
                      <th>{t('casos.selectedVersion')}</th>
                      <th>{t('casos.currentVersion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.key} className={row.changed ? 'table-warning' : ''}>
                        <td className="fw-bold text-dark">{row.label}</td>
                        <td>
                          {row.key === 'pasos' ? <VersionSteps value={row.beforeValue} /> : <pre className="m-0 small text-dark bg-transparent border-0 p-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{row.before}</pre>}
                        </td>
                        <td>
                          {row.key === 'pasos' ? <VersionSteps value={row.afterValue} /> : <pre className="m-0 small text-dark bg-transparent border-0 p-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{row.after}</pre>}
                        </td>
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
