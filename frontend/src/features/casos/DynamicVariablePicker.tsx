import { useEffect, useMemo, useState } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { Badge, Button, Form, Modal } from 'react-bootstrap'
import { API_BASE } from '../../app/constants'
import { useI18n } from '../../i18n'

type DynamicVariable = {
  name: string
  expression: string
  description?: string
  example?: string
}

type Props = {
  value?: string
  onChange: (value: string) => void
  fetchWithAuth?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

const FALLBACK_VARIABLES: DynamicVariable[] = [
  '$randomUUID', '$timestamp', '$isoTimestamp', '$randomInt', '$randomBoolean',
  '$randomEmail', '$randomFirstName', '$randomLastName', '$randomFullName',
  '$randomPhoneNumber', '$randomCompanyName', '$randomUrl', '$randomDateFuture',
  '$randomDatePast', '$randomUserName', '$randomPassword'
].map(name => ({
  name,
  expression: `{{${name}}}`,
  description: name.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2')
}))

function appendExpression(current: string, expression: string) {
  const source = String(current || '')
  if (!source.trim()) return expression
  return `${source}${/[\s\n]$/.test(source) ? '' : ' '}${expression}`
}

export function DynamicVariablePicker({ value = '', onChange, fetchWithAuth }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<DynamicVariable[]>(FALLBACK_VARIABLES)

  useEffect(() => {
    if (!open || typeof fetchWithAuth !== 'function') return
    let cancelled = false
    void fetchWithAuth(`${API_BASE}/dynamic-variables/catalog`)
      .then(async response => {
        if (!response.ok) return
        const payload = await response.json().catch(() => null)
        const items = Array.isArray(payload?.items) ? payload.items : []
        if (!cancelled && items.length) setCatalog(items)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [fetchWithAuth, open])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return catalog
    return catalog.filter(item => `${item.name} ${item.description || ''} ${item.example || ''}`.toLowerCase().includes(normalized))
  }, [catalog, query])

  return (
    <>
      <Button
        type="button"
        variant="outline-primary"
        size="sm"
        className="d-inline-flex align-items-center gap-1 mt-1"
        onClick={() => setOpen(true)}
        title={t('casos.insertDynamicVariable')}
      >
        <Sparkles size={14} aria-hidden="true" /> {t('casos.dynamicVariables')}
      </Button>
      <Modal show={open} onHide={() => setOpen(false)} centered scrollable size="lg">
        <Modal.Header closeButton closeLabel={t('casos.close')}>
          <Modal.Title className="d-flex align-items-center gap-2">
            <Sparkles size={19} className="text-primary" /> {t('casos.dynamicVariables')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted mb-3">
            {t('casos.dynamicVariablesHelp')}
          </p>
          <div className="position-relative mb-3">
            <Search size={16} className="position-absolute text-muted" style={{ left: 10, top: 10 }} aria-hidden="true" />
            <Form.Control
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('casos.searchDynamicVariable')}
              aria-label={t('casos.searchDynamicVariableAria')}
              className="ps-4"
              autoFocus
            />
          </div>
          <div className="border rounded-2 overflow-auto" style={{ maxHeight: 360 }}>
            {filtered.map(item => (
              <div key={item.name} className="d-flex align-items-center justify-content-between gap-3 border-bottom p-2">
                <div className="min-width-0">
                  <div className="font-monospace fw-semibold text-primary text-break">{item.expression || `{{${item.name}}}`}</div>
                  <div className="small text-muted text-break">{item.description || t('casos.generatedByTreseko')}{item.example ? ` · ${t('casos.example')}: ${item.example}` : ''}</div>
                </div>
                <Button
                  type="button"
                  variant="outline-primary"
                  size="sm"
                  className="flex-shrink-0"
                  onClick={() => {
                    onChange(appendExpression(value, item.expression || `{{${item.name}}}`))
                    setOpen(false)
                  }}
                >
                  {t('casos.insert')}
                </Button>
              </div>
            ))}
            {!filtered.length && <div className="p-3 small text-muted">{t('casos.noMatchingDynamicVariables')}</div>}
          </div>
          <div className="small text-muted mt-2">
            <Badge bg="light" text="dark" className="border me-1">{t('casos.caseExecutionSeed')}</Badge>
            {t('casos.reproducibleGeneratedValues')}
          </div>
        </Modal.Body>
      </Modal>
    </>
  )
}
