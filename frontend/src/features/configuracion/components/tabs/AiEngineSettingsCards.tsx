import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { formatDateTime } from '../../../../shared/utils/dateTime'

type Props = {
  aiEngineConfig: any
  setAiEngineConfig: (config: any) => void
  canEditAi: boolean
  modelScanLoading: boolean
  scanAiModels: () => void
  selectedRuntimeProvider: string
  updateAiRuntimeProvider: (provider: string) => void
  aiProviderOptions: Array<{ value: string; label: string; scan: string }>
  selectedProviderMeta: { scan: string }
  modelCatalog: any[]
  modelScanError: string
  activeModelCapabilities: any
  capabilityVariant: (enabled: boolean) => string
  updateActiveModelCapability: (key: string, value: any) => void
  aiEngineHealth: any
  checkAiEngineHealth: () => void
}

export function AiEngineSettingsCards({
  aiEngineConfig,
  setAiEngineConfig,
  canEditAi,
  modelScanLoading,
  scanAiModels,
  selectedRuntimeProvider,
  updateAiRuntimeProvider,
  aiProviderOptions,
  selectedProviderMeta,
  modelCatalog,
  modelScanError,
  activeModelCapabilities,
  capabilityVariant,
  updateActiveModelCapability,
  aiEngineHealth,
  checkAiEngineHealth,
}: Props) {
  return (
    <div className="d-flex flex-column gap-3">
      <Card className="border shadow-none p-3">
        <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
          <div>
            <h6 className="fw-bold m-0">Modelo de IA</h6>
            <div className="small text-muted">Runtime, endpoint, modelo activo y capacidades visibles para el Motor IA.</div>
          </div>
          {canEditAi && (
            <Button
              type="button"
              variant="outline-primary"
              size="sm"
              className="fw-bold"
              disabled={modelScanLoading}
              onClick={scanAiModels}
            >
              {modelScanLoading ? 'Escaneando...' : 'Auto-scan modelos'}
            </Button>
          )}
        </div>
        <Row className="g-3">
          <Col md={4}>
            <Form.Label className="fw-bold small text-muted">Runtime / Proveedor</Form.Label>
            <Form.Select
              value={selectedRuntimeProvider}
              disabled={!canEditAi}
              onChange={(e) => updateAiRuntimeProvider(e.target.value)}
            >
              {aiProviderOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Form.Select>
            <div className="small text-muted mt-1">{selectedProviderMeta.scan}</div>
          </Col>
          <Col md={8}>
            <Form.Label className="fw-bold small text-muted">Endpoint base</Form.Label>
            <Form.Control
              value={aiEngineConfig.llm_endpoint || ''}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, llm_endpoint: e.target.value })}
              placeholder="http://127.0.0.1:1234/v1"
            />
          </Col>
          <Col md={6}>
            <Form.Label className="fw-bold small text-muted">Modelo activo</Form.Label>
            <Form.Control
              list="ai-model-catalog"
              value={aiEngineConfig.model || ''}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, model: e.target.value })}
              placeholder="google/gemma-4-e4b"
            />
            <datalist id="ai-model-catalog">
              {modelCatalog.map((item: any) => (
                <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>
              ))}
            </datalist>
          </Col>
          <Col md={3}>
            <Form.Label className="fw-bold small text-muted">Temperatura</Form.Label>
            <Form.Control
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={aiEngineConfig.temperature}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, temperature: Number(e.target.value) })}
            />
          </Col>
          <Col md={3}>
            <Form.Label className="fw-bold small text-muted">Último scan</Form.Label>
            <div className="d-flex flex-column gap-1">
              <Badge bg={aiEngineConfig.last_model_scan_status === 'ok' ? 'success' : aiEngineConfig.last_model_scan_status === 'error' ? 'danger' : aiEngineConfig.last_model_scan_status === 'empty' ? 'warning' : 'secondary'} className="align-self-start">
                {aiEngineConfig.last_model_scan_status || 'manual'}
              </Badge>
              <span className="small text-muted">{formatDateTime(aiEngineConfig.last_model_scan_at) || 'Sin auto-scan'}</span>
            </div>
          </Col>
          <Col md={12}>
            <div className="border rounded-3 p-3 bg-light">
              <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                <span className="fw-bold small text-muted text-uppercase">Capacidades del modelo activo</span>
                <Badge bg="light" text="dark" className="border">{activeModelCapabilities.source || 'manual'}</Badge>
                {modelScanError && <span className="small text-danger">{modelScanError}</span>}
              </div>
              <Row className="g-3 align-items-center">
                {[
                  ['vision', 'Vision'],
                  ['reasoning', 'Razonamiento'],
                  ['tools', 'Tools'],
                  ['json_mode', 'JSON mode'],
                ].map(([key, label]) => (
                  <Col md={3} key={key}>
                    <Form.Check
                      type="switch"
                      id={`ai-capability-${key}`}
                      label={<span><Badge bg={capabilityVariant(Boolean((activeModelCapabilities as any)[key]))} className="me-2">{Boolean((activeModelCapabilities as any)[key]) ? 'Si' : 'No'}</Badge>{label}</span>}
                      checked={Boolean((activeModelCapabilities as any)[key])}
                      disabled={!canEditAi}
                      onChange={(event) => updateActiveModelCapability(key, event.target.checked)}
                    />
                  </Col>
                ))}
                <Col md={3}>
                  <Form.Label className="fw-bold small text-muted">Context window</Form.Label>
                  <Form.Control
                    type="number"
                    min={0}
                    value={Number(activeModelCapabilities.context_window || 0)}
                    disabled={!canEditAi}
                    onChange={(event) => updateActiveModelCapability('context_window', Number(event.target.value))}
                  />
                </Col>
                <Col md={9}>
                  <Form.Label className="fw-bold small text-muted">Notas de capacidades</Form.Label>
                  <Form.Control
                    value={activeModelCapabilities.notes || ''}
                    disabled={!canEditAi}
                    onChange={(event) => updateActiveModelCapability('notes', event.target.value)}
                    placeholder="Ej: vision detectada por nombre de modelo; tools validado manualmente."
                  />
                </Col>
              </Row>
            </div>
          </Col>
        </Row>
      </Card>

      <Card className="border shadow-none p-3">
        <h6 className="fw-bold m-0">Variables de ejecución del motor</h6>
        <div className="small text-muted mb-3">Navegador, resolución, timeout y concurrencia aplicados a ejecuciones nuevas.</div>
        <Row className="g-3 align-items-end">
          <Col md={3}>
            <Form.Label className="fw-bold small text-muted">Timeout seg</Form.Label>
            <Form.Control
              type="number"
              min={30}
              max={7200}
              value={aiEngineConfig.timeout_seconds}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, timeout_seconds: Number(e.target.value) })}
            />
          </Col>
          <Col md={3}>
            <Form.Label className="fw-bold small text-muted">Ancho viewport</Form.Label>
            <Form.Control
              type="number"
              min={320}
              max={7680}
              value={Number(aiEngineConfig.viewport_width ?? 1920)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, viewport_width: Number(e.target.value) })}
            />
          </Col>
          <Col md={3}>
            <Form.Label className="fw-bold small text-muted">Alto viewport</Form.Label>
            <Form.Control
              type="number"
              min={320}
              max={4320}
              value={Number(aiEngineConfig.viewport_height ?? 1080)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, viewport_height: Number(e.target.value) })}
            />
          </Col>
          <Col md={3}>
            <Form.Label className="fw-bold small text-muted">IA paralelo</Form.Label>
            <Form.Control
              type="number"
              min={1}
              max={5}
              value={Number(aiEngineConfig.max_parallel_ai_runs ?? 1)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, max_parallel_ai_runs: Number(e.target.value) })}
            />
          </Col>
          <Col md={12}>
            <Form.Check
              type="switch"
              id="ai-headless-config"
              label="Usar navegador oculto por defecto"
              checked={Boolean(aiEngineConfig.headless)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, headless: e.target.checked })}
            />
            <div className="small text-muted mt-1">Desactivalo solo para depuracion visual puntual.</div>
          </Col>
        </Row>
      </Card>

      <Card className="border shadow-none p-3">
        <h6 className="fw-bold m-0">Costos y metricas del modelo</h6>
        <div className="small text-muted mb-3">Costo estimado usado en reportes. Si prompt/respuesta son mayores a cero, tienen prioridad sobre costo total.</div>
        <Row className="g-3">
          <Col md={4}>
            <Form.Label className="fw-bold small text-muted">Costo prompt / 1K</Form.Label>
            <Form.Control
              type="number"
              min={0}
              step={0.0001}
              value={Number(aiEngineConfig.token_cost_prompt_per_1k ?? 0)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, token_cost_prompt_per_1k: Number(e.target.value) })}
            />
          </Col>
          <Col md={4}>
            <Form.Label className="fw-bold small text-muted">Costo respuesta / 1K</Form.Label>
            <Form.Control
              type="number"
              min={0}
              step={0.0001}
              value={Number(aiEngineConfig.token_cost_completion_per_1k ?? 0)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, token_cost_completion_per_1k: Number(e.target.value) })}
            />
          </Col>
          <Col md={4}>
            <Form.Label className="fw-bold small text-muted">Costo total / 1K</Form.Label>
            <Form.Control
              type="number"
              min={0}
              step={0.0001}
              value={Number(aiEngineConfig.token_cost_per_1k ?? 0.01)}
              disabled={!canEditAi}
              onChange={(e) => setAiEngineConfig({ ...aiEngineConfig, token_cost_per_1k: Number(e.target.value) })}
            />
          </Col>
        </Row>
      </Card>

      <Card className="border shadow-none p-3 bg-light">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <h6 className="fw-bold m-0">Diagnostico y parametros del servidor</h6>
            <div className="small text-muted mt-1">
              Puertos, conexion interna, token de callback, listas permitidas, seguridad y trazas se configuran en el servidor y requieren reiniciar servicios. No se editan desde esta pantalla.
            </div>
            {aiEngineHealth?.detail && (
              <div className="small text-warning-emphasis mt-2">{aiEngineHealth.detail}</div>
            )}
          </div>
          <div className="d-flex flex-column align-items-end gap-2">
            {aiEngineHealth?.status && (
              <Badge bg={aiEngineHealth.status === 'ok' ? 'success' : 'danger'} className="fw-bold">
                {String(aiEngineHealth.status).toUpperCase()}
              </Badge>
            )}
            <Button variant="outline-primary" size="sm" className="fw-bold" type="button" onClick={checkAiEngineHealth}>
              Verificar Motor IA
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
