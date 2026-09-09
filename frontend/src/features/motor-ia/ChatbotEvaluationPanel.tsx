import { useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, Row } from 'react-bootstrap'
import { Bot, ExternalLink, Play, ShieldCheck } from 'lucide-react'
import { normalizeChatbotConfig } from '../casos/chatbotConfig'
import { useI18n } from '../../i18n'

type Props = { cases: any[]; environments?: any[]; onOpenCase?: (test: any) => void; onExecuteCase?: (test: any) => void }

export function ChatbotEvaluationPanel({ cases, environments = [], onOpenCase, onExecuteCase }: Props) {
  const { t } = useI18n()
  const chatbotCases = useMemo(() => (cases || []).filter(test => String(test.format || test.formato_prueba || '').toUpperCase() === 'CONVERSACIONAL'), [cases])
  const [selectedId, setSelectedId] = useState('')
  const [environmentId, setEnvironmentId] = useState('')
  const selected = chatbotCases.find(test => String(test.id) === selectedId) || chatbotCases[0]
  const config = normalizeChatbotConfig(selected?.configuracion_chatbot || {})
  const isReady = Boolean(config.connection?.endpoint && config.conversation?.turns?.length)

  return <Card className="border-0 shadow-sm rounded-3 mb-3"><Card.Body className="p-3">
    <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
      <div><h5 className="fw-bold mb-1 d-flex align-items-center gap-2"><Bot size={20} className="text-primary" /> {t('motorIa.chatbotCardTitle')}</h5><div className="small text-muted">{t('motorIa.chatbotCardDescription')}</div></div>
      <Badge bg="light" text="dark" className="border">{t('motorIa.chatbotCasesCount', { count: chatbotCases.length })}</Badge>
    </div>
    {!chatbotCases.length ? <Alert variant="info" className="mb-0 small">{t('motorIa.noChatbotCases')}</Alert> : <Row className="g-3">
      <Col md={5}><Form.Label className="small fw-semibold">{t('motorIa.chatbotCase')}</Form.Label><Form.Select aria-label={t('motorIa.ariaSelectChatbotCase')} value={selected ? String(selected.id) : ''} onChange={event => setSelectedId(event.target.value)}>{chatbotCases.map(test => <option key={test.id} value={test.id}>{test.code || test.codigo} · {test.title || test.titulo}</option>)}</Form.Select><Form.Label className="small fw-semibold mt-2">{t('motorIa.testEnvironment')}</Form.Label><Form.Select aria-label={t('motorIa.ariaSelectTestEnvironment')} value={environmentId} onChange={event => setEnvironmentId(event.target.value)}><option value="">{t('motorIa.useRunEnvironment')}</option>{environments.map(environment => <option key={environment.id} value={environment.id}>{environment.name || environment.nombre} · {environment.url}</option>)}</Form.Select></Col>
      <Col md={7}><div className="border rounded-3 p-3 h-100 bg-light bg-opacity-50"><div className="d-flex justify-content-between align-items-start gap-2"><div><div className="fw-bold">{selected?.code || selected?.codigo} · {selected?.title || selected?.titulo}</div><div className="small text-muted mt-1">{config.connection?.endpoint || t('motorIa.pendingEndpoint')}</div></div><Badge bg={isReady ? 'success' : 'warning'}>{isReady ? t('motorIa.ready') : t('motorIa.incomplete')}</Badge></div><div className="d-flex flex-wrap gap-2 small text-muted mt-3"><span>{t('motorIa.turnsCount', { count: config.conversation?.turns?.length || 0 })}</span><span>·</span><span>{t('motorIa.toolsCount', { count: config.tools?.length || 0 })}</span><span>·</span><span><ShieldCheck size={14} /> {t('motorIa.security')}</span></div><div className="small text-muted mt-2">{t('motorIa.messagesEvaluatedInOrder')} {t('motorIa.userProfile')}: {config.profile?.name || t('motorIa.undefinedProfile')}</div><div className="d-flex gap-2 mt-3"><Button size="sm" variant="outline-primary" onClick={() => onOpenCase?.(selected)} className="d-inline-flex align-items-center gap-1"><ExternalLink size={14} /> {t('motorIa.editContract')}</Button><Button size="sm" variant="primary" disabled={!isReady} onClick={() => onExecuteCase?.(selected)} className="d-inline-flex align-items-center gap-1"><Play size={14} /> {t('motorIa.executeEvaluation')}</Button></div><div className="x-small text-muted mt-2">{t('motorIa.snapshotPreserved')}</div></div></Col>
    </Row>}
  </Card.Body></Card>
}
