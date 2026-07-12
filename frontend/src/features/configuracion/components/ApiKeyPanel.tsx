import { Alert, Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap'
import { Copy, Key } from 'lucide-react'
import { formatDateTime } from '../../../shared/utils/dateTime'

type ApiKeyPanelProps = {
  apiKeys: any[]
  apiKeysLoading: boolean
  apiKeyName: string
  newApiKeyValue: string
  setApiKeyName: (value: string) => void
  createUserApiKey: () => void
  revokeUserApiKey: (apiKeyId: string) => void
  handleApiKeyEnabledChange: (enabled: boolean) => void
  copyToClipboard: (value: string, label?: string) => void
}

export function ApiKeyPanel({
  apiKeys,
  apiKeysLoading,
  apiKeyName,
  newApiKeyValue,
  setApiKeyName,
  createUserApiKey,
  revokeUserApiKey,
  handleApiKeyEnabledChange,
  copyToClipboard,
}: ApiKeyPanelProps) {
  const activeApiKeys = apiKeys.filter((key: any) => key.activo)

  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3 responsive-card-header">
        <div>
          <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
            <Key size={20} className="text-primary" /> API key de automatización externa
          </h6>
          <p className="small text-muted mb-0">
            Habilita una clave personal para que runners externos reporten resultados al endpoint de ejecuciones.
          </p>
        </div>
        <Form.Check
          type="switch"
          id="external-api-key-switch"
          label={activeApiKeys.length > 0 ? 'Habilitada' : 'Deshabilitada'}
          checked={activeApiKeys.length > 0}
          disabled={apiKeysLoading}
          onChange={(event) => handleApiKeyEnabledChange(event.target.checked)}
          className="fw-bold text-dark"
        />
      </div>

      <Row className="g-3 align-items-end mb-3">
        <Col md={8}>
          <Form.Label className="x-small fw-bold text-muted">Nombre de la API key</Form.Label>
          <Form.Control
            value={apiKeyName}
            onChange={(event) => setApiKeyName(event.target.value)}
            placeholder="Ej: CI Playwright"
            className="shadow-none"
          />
        </Col>
        <Col md={4}>
          <Button variant="primary" className="w-100 fw-bold" disabled={apiKeysLoading} onClick={createUserApiKey}>
            <Key size={16} className="me-2" /> Crear nueva key
          </Button>
        </Col>
      </Row>

      {newApiKeyValue && (
        <Alert variant="success" className="small">
          <div className="fw-bold mb-2">Key creada. Guárdala ahora: no se volverá a mostrar completa.</div>
          <div className="d-flex align-items-center gap-2 api-key-copy-row">
            <code className="flex-grow-1 bg-light p-2 rounded text-break">{newApiKeyValue}</code>
            <Button variant="outline-primary" size="sm" onClick={() => copyToClipboard(newApiKeyValue, 'API key')}>
              <Copy size={14} className="me-1" /> Copiar
            </Button>
          </div>
        </Alert>
      )}

      <Table responsive hover size="sm" className="mb-0 align-middle">
        <thead className="table-light">
          <tr>
            <th>Nombre</th>
            <th>Prefijo</th>
            <th>Estado</th>
            <th>Último uso</th>
            <th className="text-end">Acción</th>
          </tr>
        </thead>
        <tbody>
          {apiKeys.map((key: any) => (
            <tr key={key.id}>
              <td className="small fw-semibold text-dark">{key.nombre}</td>
              <td><code className="small">{key.key_prefix}...</code></td>
              <td><Badge bg={key.activo ? 'success' : 'secondary'}>{key.activo ? 'Activa' : 'Revocada'}</Badge></td>
              <td className="small text-muted">{key.ultimo_uso ? formatDateTime(key.ultimo_uso) : 'Nunca'}</td>
              <td className="text-end">
                <Button variant="link" size="sm" className="text-danger p-0" disabled={!key.activo || apiKeysLoading} onClick={() => revokeUserApiKey(key.id)}>
                  Revocar
                </Button>
              </td>
            </tr>
          ))}
          {apiKeys.length === 0 && (
            <tr><td colSpan={5} className="text-center py-4 text-muted small">No hay API keys creadas para tu usuario.</td></tr>
          )}
        </tbody>
      </Table>
    </Card>
  )
}
