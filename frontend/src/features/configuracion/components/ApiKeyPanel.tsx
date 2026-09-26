import { Alert, Badge, Button, Card, Col, Form, Row, Table } from 'react-bootstrap'
import { Copy, Key } from 'lucide-react'
import { formatDateTime } from '../../../shared/utils/dateTime'
import { useI18n } from '../../../i18n'

type ApiKeyPanelProps = {
  apiKeys: any[]
  apiKeysLoading: boolean
  apiKeyName: string
  newApiKeyValue: string
  setApiKeyName: (value: string) => void
  createUserApiKey: () => void
  revokeUserApiKey: (apiKeyId: string) => void
  setUserApiKeyState: (apiKeyId: string, estado: 'ACTIVE' | 'PAUSED') => void
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
  setUserApiKeyState,
  copyToClipboard,
}: ApiKeyPanelProps) {
  const { t } = useI18n()
  return (
    <Card className="border-0 shadow-sm rounded-4 bg-white p-4 mt-4">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3 responsive-card-header">
        <div>
          <h6 className="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
            <Key size={20} className="text-primary" /> {t('configuracion.apiKeyTitle')}
          </h6>
          <p className="small text-muted mb-0">
            {t('configuracion.apiKeyDesc')}
          </p>
        </div>
        <span className="small text-muted">{t('configuracion.apiKeyLifecycleHint')}</span>
      </div>

      <Row className="g-3 align-items-end mb-3">
        <Col md={8}>
          <Form.Label className="x-small fw-bold text-muted">{t('configuracion.apiKeyName')}</Form.Label>
          <Form.Control name="a11y-apikeypaneltsx-57" aria-label={t('configuracion.apiKeyName')}
            value={apiKeyName}
            onChange={(event) => setApiKeyName(event.target.value)}
            placeholder={t('configuracion.apiKeyPlaceholder')}
            className="shadow-none"
          />
        </Col>
        <Col md={4}>
          <Button variant="primary" className="w-100 fw-bold" disabled={apiKeysLoading} onClick={createUserApiKey}>
            <Key size={16} className="me-2" /> {t('configuracion.createKey')}
          </Button>
        </Col>
      </Row>

      {newApiKeyValue && (
        <Alert variant="success" className="small">
          <div className="fw-bold mb-2">{t('configuracion.keyCreated')}</div>
          <div className="d-flex align-items-center gap-2 api-key-copy-row">
            <code className="flex-grow-1 bg-light p-2 rounded text-break">{newApiKeyValue}</code>
            <Button variant="outline-primary" size="sm" onClick={() => copyToClipboard(newApiKeyValue, t('configuracion.apiKeyTitle'))}>
              <Copy size={14} className="me-1" /> {t('configuracion.copy')}
            </Button>
          </div>
        </Alert>
      )}

      <Table responsive hover size="sm" className="mb-0 align-middle">
        <thead className="table-light">
          <tr>
            <th>{t('configuracion.name')}</th>
            <th>{t('configuracion.prefix')}</th>
            <th>{t('configuracion.status')}</th>
            <th>{t('configuracion.lastUse')}</th>
            <th className="text-end">{t('configuracion.action')}</th>
          </tr>
        </thead>
        <tbody>
          {apiKeys.map((key: any) => (
            <tr key={key.id}>
              <td className="small fw-semibold text-dark">{key.nombre}</td>
              <td><code className="small">{key.key_prefix}...</code></td>
              <td><Badge bg={key.estado === 'ACTIVE' || (!key.estado && key.activo) ? 'success' : key.estado === 'PAUSED' ? 'warning' : 'secondary'} text={key.estado === 'PAUSED' ? 'dark' : undefined}>{key.estado === 'ACTIVE' || (!key.estado && key.activo) ? t('configuracion.active') : key.estado === 'PAUSED' ? t('configuracion.paused') : t('configuracion.revoked')}</Badge></td>
              <td className="small text-muted">{key.ultimo_uso ? formatDateTime(key.ultimo_uso) : t('configuracion.never')}</td>
              <td className="text-end">
                <div className="d-flex justify-content-end gap-2 flex-wrap">
                  {key.estado !== 'REVOKED' && key.activo && <Button variant="link" size="sm" className="text-warning p-0" disabled={apiKeysLoading} onClick={() => setUserApiKeyState(key.id, 'PAUSED')}>{t('configuracion.pause')}</Button>}
                  {key.estado === 'PAUSED' && <Button variant="link" size="sm" className="text-success p-0" disabled={apiKeysLoading} onClick={() => setUserApiKeyState(key.id, 'ACTIVE')}>{t('configuracion.activate')}</Button>}
                  <Button variant="link" size="sm" className="text-danger p-0" disabled={key.estado === 'REVOKED' || (!key.estado && !key.activo) || apiKeysLoading} onClick={() => revokeUserApiKey(key.id)}>{t('configuracion.revoke')}</Button>
                </div>
              </td>
            </tr>
          ))}
          {apiKeys.length === 0 && (
            <tr><td colSpan={5} className="text-center py-4 text-muted small">{t('configuracion.noApiKeys')}</td></tr>
          )}
        </tbody>
      </Table>
    </Card>
  )
}
