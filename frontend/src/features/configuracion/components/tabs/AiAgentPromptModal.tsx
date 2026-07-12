import { Button, Col, Form, Modal, Row } from 'react-bootstrap'
import { RotateCcw } from 'lucide-react'

type Props = {
  promptAgentIndex: number | null
  promptAgent: any
  canEditAi: boolean
  agentActionOptions: Array<{ value: string; label: string }>
  setPromptAgentIndex: (index: number | null) => void
  updateAgentWorkflowItem: (index: number, patch: Record<string, any>) => void
  restoreAgentPrompt: (index: number) => void
}

export function AiAgentPromptModal({
  promptAgentIndex,
  promptAgent,
  canEditAi,
  agentActionOptions,
  setPromptAgentIndex,
  updateAgentWorkflowItem,
  restoreAgentPrompt,
}: Props) {
  return (
    <Modal show={promptAgentIndex !== null} onHide={() => setPromptAgentIndex(null)} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold">
          Prompt de {promptAgent?.name || promptAgent?.id || 'agente'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {promptAgent && (
          <div className="d-flex flex-column gap-3">
            <Row className="g-2">
              <Col md={8}>
                <Form.Label className="x-small text-muted fw-bold text-uppercase">Acción operativa</Form.Label>
                <Form.Select
                  value={promptAgent.action || 'custom_review'}
                  disabled={!canEditAi || promptAgent.locked}
                  onChange={(e) => updateAgentWorkflowItem(promptAgentIndex as number, { action: e.target.value })}
                >
                  {agentActionOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label className="x-small text-muted fw-bold text-uppercase">Reintentos</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={5}
                  value={Number(promptAgent.retry_limit || 0)}
                  disabled={!canEditAi || promptAgent.locked}
                  onChange={(e) => updateAgentWorkflowItem(promptAgentIndex as number, { retry_limit: Number(e.target.value) })}
                />
              </Col>
            </Row>
            <Form.Group>
              <Form.Label className="x-small text-muted fw-bold text-uppercase">Prompt operativo</Form.Label>
              <Form.Control
                as="textarea"
                rows={9}
                value={promptAgent.prompt || ''}
                disabled={!canEditAi}
                onChange={(e) => updateAgentWorkflowItem(promptAgentIndex as number, { prompt: e.target.value })}
              />
            </Form.Group>
            <div className="d-flex justify-content-between gap-2">
              {canEditAi && (
                <Button variant="outline-secondary" type="button" disabled={!promptAgent.locked} onClick={() => restoreAgentPrompt(promptAgentIndex as number)}>
                  <RotateCcw size={14} className="me-1" /> Restaurar prompt
                </Button>
              )}
              <Button variant="primary" type="button" onClick={() => setPromptAgentIndex(null)}>
                Listo
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>
    </Modal>
  )
}
