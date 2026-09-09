import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Form, Row } from 'react-bootstrap'
import { Code2, Plus, Trash2 } from 'lucide-react'
import {
  API_ASSERTION_OPERATORS,
  API_ASSERTION_SOURCES,
  API_ASSERTION_TYPES,
  API_VALUE_TYPES,
  assertionNeedsValue,
  defaultExpectedForType,
  expectedToText,
  parseExpected,
  type ApiAssertion,
} from './apiAssertions'
import {
  assertionForKind,
  GUIDED_ASSERTION_KINDS,
  guidedAssertionKind,
  normalizeJsonPath,
  readableJsonPath,
  type GuidedAssertionKind,
} from './apiAssertionGuidance'

type Props = {
  assertions: ApiAssertion[]
  onChange: (assertions: ApiAssertion[]) => void
  advancedText: string
  onAdvancedTextChange: (value: string) => void
  onAdvancedBlur: () => void
  advancedDirty: boolean
  onAdvancedDirtyChange: (value: boolean) => void
  advancedError?: string
  t: (key: string, params?: Record<string, string | number>) => string
}

type Translate = Props['t']

const JSON_VALUE_OPERATORS = API_ASSERTION_OPERATORS.filter(item => [
  'equals', 'not_equals', 'contains', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'array_length_equals', 'array_length_greater_or_equal', 'array_length_less_or_equal',
].includes(item.value))

const TEXT_OPERATORS = API_ASSERTION_OPERATORS.filter(item => ['contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'matches'].includes(item.value))

function inferredType(assertion: ApiAssertion) {
  if (assertion.operator === 'type_is') return 'type'
  if (assertion.expected_type && assertion.expected_type !== 'type') return assertion.expected_type
  if (typeof assertion.expected === 'number') return 'number'
  if (typeof assertion.expected === 'boolean') return 'boolean'
  if (typeof assertion.expected === 'object' && assertion.expected !== null) return 'json'
  return 'text'
}

function expectedLabel(assertion: ApiAssertion, t: Translate) {
  if (assertion.operator === 'type_is') {
    const type = API_VALUE_TYPES.find(item => item.value === assertion.expected)
    return type ? t(type.labelKey) : String(assertion.expected ?? '')
  }
  if (assertion.operator === 'exists') return t('casos.apiAssertionExpectedExists')
  if (assertion.operator === 'not_exists') return t('casos.apiAssertionExpectedNotExists')
  return expectedToText(assertion.expected, inferredType(assertion)) || t('casos.apiAssertionExpectedIncomplete')
}

function ruleSummary(assertion: ApiAssertion, t: Translate) {
  const kind = guidedAssertionKind(assertion)
  const field = readableJsonPath(assertion.selector) || t('casos.apiAssertionResponseField')
  const operator = API_ASSERTION_OPERATORS.find(item => item.value === assertion.operator)
  const operatorLabel = operator ? t(operator.labelKey) : assertion.operator
  const expected = expectedLabel(assertion, t)
  if (kind === 'status') return t('casos.apiAssertionSummaryStatus', { operator: operatorLabel, expected })
  if (kind === 'text') return t('casos.apiAssertionSummaryText', { operator: operatorLabel, expected })
  if (kind === 'json-value') return t('casos.apiAssertionSummaryField', { field, operator: operatorLabel, expected })
  if (kind === 'json-type') return t('casos.apiAssertionSummaryType', { field, expected })
  if (kind === 'json-exists') return t('casos.apiAssertionSummaryExists', { field, expected })
  if (kind === 'response-time') return t('casos.apiAssertionSummaryResponseTime', { expected })
  if (kind === 'json-schema') return t('casos.apiAssertionSummarySchema')
  const source = API_ASSERTION_SOURCES.find(item => item.value === assertion.source)
  return t('casos.apiAssertionSummaryAdvanced', { source: source ? t(source.labelKey) : assertion.source, operator: operatorLabel })
}

function ExpectedValue({ assertion, index, update, t }: { assertion: ApiAssertion; index: number; update: (changes: Partial<ApiAssertion>) => void; t: Translate }) {
  const valueType = inferredType(assertion)
  return (
    <Row className="g-2 align-items-end">
      <Col md={4}>
        <Form.Label htmlFor={`api-assertion-type-${index}`} className="small mb-1">{t('casos.apiAssertionValueTypeLabel')}</Form.Label>
        <Form.Select id={`api-assertion-type-${index}`} size="sm" value={valueType} onChange={event => update({ expected: defaultExpectedForType(event.target.value), expected_type: event.target.value as ApiAssertion['expected_type'] })}>
          {API_ASSERTION_TYPES.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
        </Form.Select>
      </Col>
      <Col md={8}>
        <Form.Label htmlFor={`api-assertion-expected-${index}`} className="small mb-1">{t('casos.apiAssertionExpectedValueLabel')}</Form.Label>
        {valueType === 'boolean' ? (
          <Form.Select id={`api-assertion-expected-${index}`} size="sm" value={String(assertion.expected)} onChange={event => update({ expected: event.target.value === 'true', expected_type: 'boolean' })}>
            <option value="true">{t('casos.apiAssertionBooleanTrue')} (true)</option><option value="false">{t('casos.apiAssertionBooleanFalse')} (false)</option>
          </Form.Select>
        ) : (
          <Form.Control
            id={`api-assertion-expected-${index}`}
            size="sm"
            type={valueType === 'number' ? 'number' : 'text'}
            inputMode={valueType === 'number' ? 'decimal' : undefined}
            value={expectedToText(assertion.expected, valueType)}
            onChange={event => update({ expected: parseExpected(event.target.value, valueType), expected_type: valueType as ApiAssertion['expected_type'] })}
            placeholder={valueType === 'number' ? t('casos.apiAssertionExpectedNumberPlaceholder') : valueType === 'json' ? t('casos.apiAssertionExpectedJsonPlaceholder') : t('casos.apiAssertionExpectedTextPlaceholder')}
            className={valueType === 'json' ? 'font-monospace' : ''}
            autoComplete="off"
          />
        )}
      </Col>
    </Row>
  )
}

function GuidedRuleFields({ assertion, index, update, t }: { assertion: ApiAssertion; index: number; update: (changes: Partial<ApiAssertion>) => void; t: Translate }) {
  const kind = guidedAssertionKind(assertion)
  const [schemaDraft, setSchemaDraft] = useState(expectedToText(assertion.expected, 'json'))
  const [schemaError, setSchemaError] = useState('')

  useEffect(() => {
    if (kind === 'json-schema') setSchemaDraft(expectedToText(assertion.expected, 'json'))
  }, [assertion.expected, kind])

  if (kind === 'status') return (
    <Row className="g-2 align-items-end">
      <Col md={5}><Form.Label htmlFor={`api-status-operator-${index}`} className="small mb-1">{t('casos.apiAssertionHttpStatusLabel')}</Form.Label><Form.Select id={`api-status-operator-${index}`} size="sm" value={assertion.operator} onChange={event => update({ operator: event.target.value })}><option value="equals">{t('casos.apiAssertionMustBe')}</option><option value="not_equals">{t('casos.apiAssertionMustNotBe')}</option></Form.Select></Col>
      <Col md={7}><Form.Label htmlFor={`api-status-value-${index}`} className="small mb-1">{t('casos.apiAssertionExpectedCodeLabel')}</Form.Label><Form.Control id={`api-status-value-${index}`} size="sm" type="number" inputMode="numeric" value={Number(assertion.expected ?? 200)} onChange={event => update({ expected: Number(event.target.value), expected_type: 'number' })} placeholder={t('casos.apiAssertionExpectedNumberPlaceholder')} autoComplete="off" /></Col>
    </Row>
  )

  if (kind === 'text') return (
    <Row className="g-2 align-items-end">
      <Col md={4}><Form.Label htmlFor={`api-text-operator-${index}`} className="small mb-1">{t('casos.apiAssertionResponseLabel')}</Form.Label><Form.Select id={`api-text-operator-${index}`} size="sm" value={assertion.operator} onChange={event => update({ operator: event.target.value })}>{TEXT_OPERATORS.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}</Form.Select></Col>
      <Col md={8}><Form.Label htmlFor={`api-text-value-${index}`} className="small mb-1">{t('casos.apiAssertionExpectedTextLabel')}</Form.Label><Form.Control id={`api-text-value-${index}`} size="sm" value={String(assertion.expected ?? '')} onChange={event => update({ expected: event.target.value, expected_type: 'text' })} placeholder={t('casos.apiAssertionExpectedTextPlaceholder')} autoComplete="off" /></Col>
    </Row>
  )

  if (['json-value', 'json-type', 'json-exists'].includes(kind)) return (
    <>
      <Row className="g-2 align-items-end mb-2">
        <Col md={kind === 'json-value' ? 5 : 7}>
          <Form.Label htmlFor={`api-json-path-${index}`} className="small mb-1">{t('casos.apiAssertionJsonFieldLabel')}</Form.Label>
          <Form.Control id={`api-json-path-${index}`} size="sm" value={readableJsonPath(assertion.selector)} onChange={event => update({ selector: normalizeJsonPath(event.target.value) })} placeholder={t('casos.apiAssertionJsonPathPlaceholder')} className="font-monospace" autoComplete="off" spellCheck={false} />
          <Form.Text>{t('casos.apiAssertionJsonPathHelp')} <code>$.</code> {t('casos.apiAssertionJsonPathHelpSuffix')}</Form.Text>
        </Col>
        {kind === 'json-value' && <Col md={7}><Form.Label htmlFor={`api-json-operator-${index}`} className="small mb-1">{t('casos.apiAssertionFieldLabel')}</Form.Label><Form.Select id={`api-json-operator-${index}`} size="sm" value={assertion.operator} onChange={event => update({ operator: event.target.value })}>{JSON_VALUE_OPERATORS.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}</Form.Select></Col>}
        {kind === 'json-type' && <Col md={5}><Form.Label htmlFor={`api-json-type-${index}`} className="small mb-1">{t('casos.apiAssertionTypeRequirementLabel')}</Form.Label><Form.Select id={`api-json-type-${index}`} size="sm" value={String(assertion.expected || 'string')} onChange={event => update({ expected: event.target.value, expected_type: 'type' })}>{API_VALUE_TYPES.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}</Form.Select></Col>}
        {kind === 'json-exists' && <Col md={5}><Form.Label htmlFor={`api-json-exists-${index}`} className="small mb-1">{t('casos.apiAssertionFieldLabel')}</Form.Label><Form.Select id={`api-json-exists-${index}`} size="sm" value={assertion.operator} onChange={event => update({ operator: event.target.value, expected: undefined, expected_type: undefined })}><option value="exists">{t('casos.apiAssertionMustExist')}</option><option value="not_exists">{t('casos.apiAssertionMustNotExist')}</option></Form.Select></Col>}
      </Row>
      {kind === 'json-value' && <ExpectedValue assertion={assertion} index={index} update={update} t={t} />}
    </>
  )

  if (kind === 'response-time') return <div className="api-inline-field"><Form.Label htmlFor={`api-time-value-${index}`} className="small mb-1">{t('casos.apiAssertionMaxResponseTimeLabel')}</Form.Label><div className="input-group input-group-sm"><Form.Control id={`api-time-value-${index}`} type="number" min={1} inputMode="numeric" value={Number(assertion.expected ?? 500)} onChange={event => update({ operator: 'less_or_equal', expected: Number(event.target.value), expected_type: 'number' })} autoComplete="off" /><span className="input-group-text">ms</span></div></div>

  if (kind === 'json-schema') return (
    <div>
      <Form.Label htmlFor={`api-schema-${index}`} className="small mb-1">{t('casos.apiAssertionJsonSchemaLabel')}</Form.Label>
      <Form.Control id={`api-schema-${index}`} as="textarea" rows={5} value={schemaDraft} onChange={event => { setSchemaDraft(event.target.value); setSchemaError('') }} onBlur={() => { try { update({ expected: JSON.parse(schemaDraft), expected_type: 'json' }); setSchemaError('') } catch { setSchemaError(t('casos.apiAssertionJsonSchemaInvalid')) } }} className={`font-monospace ${schemaError ? 'is-invalid' : ''}`} spellCheck={false} />
      {schemaError ? <div className="invalid-feedback d-block" role="alert">{schemaError}</div> : <Form.Text>{t('casos.apiAssertionJsonSchemaHelp')}</Form.Text>}
    </div>
  )

  const needsSelector = ['response.body', 'response.headers', 'response.cookies'].includes(String(assertion.source))
  const needsValue = assertionNeedsValue(assertion.operator)
  return (
    <Row className="g-2 align-items-end">
      <Col md={4}><Form.Label htmlFor={`api-advanced-source-${index}`} className="small mb-1">{t('casos.apiAssertionTechnicalDataLabel')}</Form.Label><Form.Select id={`api-advanced-source-${index}`} size="sm" value={assertion.source} onChange={event => update({ source: event.target.value })}>{API_ASSERTION_SOURCES.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}</Form.Select></Col>
      {needsSelector && <Col md={4}><Form.Label htmlFor={`api-advanced-selector-${index}`} className="small mb-1">{t('casos.apiAssertionSelectorLabel')}</Form.Label><Form.Control id={`api-advanced-selector-${index}`} size="sm" value={assertion.selector || ''} onChange={event => update({ selector: event.target.value })} placeholder={t('casos.apiAssertionSelectorPlaceholder')} className="font-monospace" autoComplete="off" spellCheck={false} /></Col>}
      <Col md={4}><Form.Label htmlFor={`api-advanced-operator-${index}`} className="small mb-1">{t('casos.apiAssertionConditionLabel')}</Form.Label><Form.Select id={`api-advanced-operator-${index}`} size="sm" value={assertion.operator} onChange={event => update({ operator: event.target.value })}>{API_ASSERTION_OPERATORS.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}</Form.Select></Col>
      {needsValue && <Col md={12} className="mt-2"><ExpectedValue assertion={assertion} index={index} update={update} t={t} /></Col>}
    </Row>
  )
}

export function ApiAssertionBuilder({ assertions, onChange, advancedText, onAdvancedTextChange, onAdvancedBlur, advancedDirty, onAdvancedDirtyChange, advancedError = '', t }: Props) {
  const [advanced, setAdvanced] = useState(false)
  const [newKind, setNewKind] = useState<GuidedAssertionKind>('status')
  const [expandedId, setExpandedId] = useState<string | null>(assertions.length ? assertions[0]?.id || 'assertion-0' : null)
  const newKindDescription = useMemo(() => {
    const kind = GUIDED_ASSERTION_KINDS.find(item => item.value === newKind)
    return kind ? t(kind.descriptionKey) : ''
  }, [newKind, t])

  const replace = (index: number, assertion: ApiAssertion) => onChange(assertions.map((item, currentIndex) => currentIndex === index ? assertion : item))
  const update = (index: number, changes: Partial<ApiAssertion>) => replace(index, { ...assertions[index], ...changes })
  const remove = (index: number) => onChange(assertions.filter((_, currentIndex) => currentIndex !== index))
  const add = () => {
    const assertion = assertionForKind(newKind, assertions.length)
    onChange([...assertions, assertion])
    setExpandedId(assertion.id)
  }

  return (
    <div className="api-assertion-builder">
      <div className="d-flex align-items-start gap-2 mb-3">
        <div>
          <Form.Label className="small fw-semibold mb-1">{t('casos.apiAssertionChecksTitle')}</Form.Label>
          <div className="small text-muted">{t('casos.apiAssertionChecksHelp')}</div>
        </div>
        <Button type="button" variant="link" size="sm" className="ms-auto text-nowrap p-0" onClick={() => setAdvanced(previous => !previous)}>
          <Code2 size={14} className="me-1" /> {advanced ? t('casos.apiAssertionGuidedMode') : t('casos.apiAssertionAdvancedMode')}
        </Button>
      </div>

      {advanced ? (
        <div>
          <Form.Label htmlFor="api-assertions-advanced" className="small fw-semibold">{t('casos.apiAssertionTechnicalDefinition')}</Form.Label>
          <Form.Control id="api-assertions-advanced" name="api-assertions-advanced" as="textarea" rows={8} value={advancedText} onChange={event => { onAdvancedDirtyChange(true); onAdvancedTextChange(event.target.value) }} onBlur={() => advancedDirty && onAdvancedBlur()} className={`font-monospace bg-white ${advancedError ? 'is-invalid' : ''}`} spellCheck={false} />
          {advancedError ? <div className="invalid-feedback d-block" role="alert">{advancedError}</div> : <Form.Text>{t('casos.apiAssertionAdvancedHelp')}</Form.Text>}
        </div>
      ) : (
        <>
          <div className="api-check-adder">
            <div className="api-check-picker">
              <Form.Label htmlFor="api-new-check-kind" className="small fw-semibold mb-1">{t('casos.apiAssertionWhatToCheck')}</Form.Label>
              <div className="api-check-picker-row">
                <Form.Select id="api-new-check-kind" value={newKind} onChange={event => setNewKind(event.target.value as GuidedAssertionKind)}>
                  {GUIDED_ASSERTION_KINDS.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
                </Form.Select>
                <Button type="button" variant="primary" onClick={add}><Plus size={15} className="me-1" aria-hidden="true" /> {t('casos.apiAssertionAdd')}</Button>
              </div>
              <Form.Text>{newKindDescription}</Form.Text>
            </div>
          </div>

          {assertions.length === 0 && <Alert variant="secondary" className="small py-2 mt-3 mb-0">{t('casos.apiAssertionEmpty')}</Alert>}
          <div className="api-check-list mt-3">
            {assertions.map((assertion, index) => {
              const kind = guidedAssertionKind(assertion)
              const ruleId = assertion.id || `assertion-${index}`
              return (
                <details key={ruleId} className="api-assertion-rule" open={expandedId === ruleId} onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) setExpandedId(ruleId); else if (expandedId === ruleId) setExpandedId(null) }}>
                  <summary>
                    <Badge bg={assertion.severity === 'warning' ? 'warning' : 'primary'} text={assertion.severity === 'warning' ? 'dark' : undefined}>{t('casos.apiAssertionNumber', { count: index + 1 })}</Badge>
                    <span><strong>{ruleSummary(assertion, t)}</strong><small>{assertion.severity === 'warning' ? t('casos.apiAssertionWarningSummary') : t('casos.apiAssertionRequiredSummary')}</small></span>
                  </summary>
                  <div className="api-assertion-rule-body">
                    <div className="api-rule-toolbar mb-3">
                      <div className="flex-grow-1">
                        <Form.Label htmlFor={`api-check-kind-${index}`} className="small mb-1">{t('casos.apiAssertionCheckType')}</Form.Label>
                        <Form.Select id={`api-check-kind-${index}`} size="sm" value={kind} onChange={event => replace(index, assertionForKind(event.target.value as GuidedAssertionKind, index, assertion))}>
                          {GUIDED_ASSERTION_KINDS.map(item => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
                        </Form.Select>
                      </div>
                      <Button type="button" variant="outline-danger" size="sm" aria-label={t('casos.apiAssertionRemove', { count: index + 1 })} onClick={() => remove(index)}><Trash2 size={15} aria-hidden="true" /></Button>
                    </div>
                    <GuidedRuleFields assertion={assertion} index={index} update={changes => update(index, changes)} t={t} />
                    <details className="api-rule-options mt-3">
                      <summary>{t('casos.apiAssertionOrganizationOptions')}</summary>
                      <Row className="g-2 mt-1">
                        <Col md={8}><Form.Label htmlFor={`api-check-name-${index}`} className="small mb-1">{t('casos.apiAssertionInternalName')}</Form.Label><Form.Control id={`api-check-name-${index}`} size="sm" value={assertion.name || ''} onChange={event => update(index, { name: event.target.value })} placeholder={t('casos.apiAssertionNamePlaceholder')} autoComplete="off" /></Col>
                        <Col md={4}><Form.Label htmlFor={`api-check-severity-${index}`} className="small mb-1">{t('casos.apiAssertionIfNotMet')}</Form.Label><Form.Select id={`api-check-severity-${index}`} size="sm" value={assertion.severity || 'must'} onChange={event => update(index, { severity: event.target.value as ApiAssertion['severity'] })}><option value="must">{t('casos.apiAssertionFailCase')}</option><option value="warning">{t('casos.apiAssertionWarnOnly')}</option></Form.Select></Col>
                      </Row>
                    </details>
                  </div>
                </details>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
