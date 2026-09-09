import { useEffect, useRef, useState } from 'react'
import { Button, Form } from 'react-bootstrap'
import { Plus, Trash2 } from 'lucide-react'

export type ApiKeyValueItem = Record<string, any> & {
  key?: string
  name?: string
  value?: unknown
  description?: string
  enabled?: boolean
}

type Props = {
  items: ApiKeyValueItem[]
  onChange: (items: ApiKeyValueItem[]) => void
  fieldName: string
  fieldLabel?: string
  emptyText: string
  addLabel?: string
  keyPlaceholder: string
  keySuggestions?: string[]
  keyListId?: string
  valuePlaceholder: string
  secretValues?: boolean
  t: (key: string) => string
}

function normalizedKey(item: ApiKeyValueItem) {
  return String(item.key ?? item.name ?? '')
}

export function ApiKeyValueEditor({
  items,
  onChange,
  fieldName,
  fieldLabel,
  emptyText,
  addLabel,
  keyPlaceholder,
  keySuggestions = [],
  keyListId,
  valuePlaceholder,
  secretValues = false,
  t,
}: Props) {
  const [rows, setRows] = useState(items)
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null)
  const keyInputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    setRows(items)
  }, [items])

  useEffect(() => {
    if (pendingFocusIndex == null) return
    keyInputs.current[pendingFocusIndex]?.focus()
    setPendingFocusIndex(null)
  }, [pendingFocusIndex, rows.length])

  const commit = (nextRows: ApiKeyValueItem[]) => {
    setRows(nextRows)
    onChange(nextRows)
  }

  const update = (index: number, changes: ApiKeyValueItem) => {
    commit(rows.map((item, currentIndex) => currentIndex === index ? { ...item, ...changes } : item))
  }

  const updateKey = (index: number, value: string) => {
    const item = { ...rows[index], key: value }
    delete item.name
    commit(rows.map((current, currentIndex) => currentIndex === index ? item : current))
  }

  const add = () => {
    const nextRows = [...rows, { key: '', value: '', description: '', enabled: true }]
    commit(nextRows)
    setPendingFocusIndex(nextRows.length - 1)
  }
  const remove = (index: number) => commit(rows.filter((_, currentIndex) => currentIndex !== index))
  const accessibleFieldLabel = fieldLabel || fieldName

  return (
    <div>
      {rows.length === 0 && <div className="small text-muted py-3 text-center border rounded-2 bg-light-subtle">{emptyText}</div>}
      {rows.length > 0 && (
        <div className="api-pair-head" aria-hidden="true">
          <span>{t('casos.apiUse')}</span><span>{keyPlaceholder}</span><span>{valuePlaceholder}</span><span>{t('casos.apiDescription')}</span><span />
        </div>
      )}
      {rows.map((item, index) => (
        <div className="api-pair-row" key={`${fieldName}-${index}`}>
          <Form.Check
            name={`${fieldName}-${index}-enabled`}
            aria-label={`${t('casos.apiEnable')} ${accessibleFieldLabel} ${index + 1}`}
            checked={item.enabled !== false}
            onChange={event => update(index, { enabled: event.target.checked })}
          />
          <Form.Control
            ref={element => { keyInputs.current[index] = element }}
            name={`${fieldName}-${index}-key`}
            size="sm"
            aria-label={`${keyPlaceholder} ${t('casos.apiFieldAriaOf')} ${accessibleFieldLabel} ${index + 1}`}
            value={normalizedKey(item)}
            onChange={event => updateKey(index, event.target.value)}
            placeholder={`${keyPlaceholder}…`}
            autoComplete="off"
            list={keyListId}
            className="font-monospace"
          />
          <Form.Control
            size="sm"
            name={`${fieldName}-${index}-value`}
            type={secretValues ? 'password' : 'text'}
            aria-label={`${valuePlaceholder} ${t('casos.apiFieldAriaOf')} ${accessibleFieldLabel} ${index + 1}`}
            value={String(item.value ?? '')}
            onChange={event => update(index, { value: event.target.value })}
            placeholder={`${valuePlaceholder}…`}
            className="font-monospace"
          />
          <Form.Control
            size="sm"
            name={`${fieldName}-${index}-description`}
            aria-label={`${t('casos.apiDescription')} ${accessibleFieldLabel} ${index + 1}`}
            value={String(item.description ?? '')}
            onChange={event => update(index, { description: event.target.value })}
            placeholder={`${t('casos.apiOptionalDescription')}…`}
          />
          <Button type="button" variant="outline-danger" size="sm" aria-label={`${t('casos.apiRemove')} ${accessibleFieldLabel} ${index + 1}`} onClick={() => remove(index)}>
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        </div>
      ))}
      {keyListId && keySuggestions.length > 0 && (
        <datalist id={keyListId}>
          {keySuggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}
        </datalist>
      )}
      <Button type="button" variant="outline-primary" size="sm" className="mt-2" onClick={add}>
        <Plus size={14} className="me-1" aria-hidden="true" /> {addLabel || t('casos.apiAddRow')}
      </Button>
    </div>
  )
}
