import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Modal, Table } from 'react-bootstrap'

type VariableSource = 'environment' | 'component' | 'dataset' | 'case' | 'unknown'

type VariableReferenceHintsProps = {
  value?: string
  caseData?: string
  environments?: any[]
  selectedEnvironment?: any
  selectedDataset?: any
  component?: any
  triggerLabel?: string
  t: (key: `${string}.${string}`, params?: Record<string, string | number>) => string
}

type VariableReference = {
  token: string
  key: string
  source: VariableSource
  sourceName: string
  value: string | null
  masked: boolean
  alternatives: Array<{ context: string; value: string | null; selected?: boolean }>
}

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g
const VARIABLE_ACCESS_PATTERN = /\bvariables\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g

function parseAssignments(value: string | undefined) {
  return String(value || '').split(/\r?\n|\s+\/\s+/).reduce<Record<string, string>>((result, part) => {
    const separator = part.indexOf('=')
    if (separator === -1) return result
    const key = part.slice(0, separator).trim()
    if (key) result[key] = part.slice(separator + 1).trim()
    return result
  }, {})
}

function isSensitiveKey(key: string) {
  return /password|secret|token|api[_-]?key|private|credential/i.test(key)
}

function visibleValue(value: string | null, masked: boolean) {
  if (value === null || value === undefined || value === '') return '—'
  return masked ? '••••••••' : value
}

function environmentVariables(environment: any) {
  if (!environment) return {}
  const rawVariables = Object.fromEntries(Object.entries(environment.variables || {}).map(([key, value]) => [key, String(value)]))
  return {
    'ENV.ID': String(environment.id || ''),
    'ENV.NAME': String(environment.name || environment.nombre || ''),
    'ENV.BASE_URL': String(environment.url || ''),
    'ENV.VERSION': String(environment.version || ''),
    'ENV.STATUS': String(environment.status || ''),
    ...rawVariables,
    ...Object.fromEntries(Object.entries(rawVariables).map(([key, value]) => [`ENV.${key}`, value]))
  }
}

function componentVariables(component: any) {
  if (!component) return {}
  const rawVariables = Object.fromEntries(Object.entries(component.variables || {}).map(([key, value]) => [key, String(value)]))
  return {
    'COMPONENT.ID': String(component.id || ''),
    'COMPONENT.CODE': String(component.codigo || component.code || ''),
    'COMPONENT.NAME': String(component.nombre || component.name || ''),
    ...rawVariables,
    ...Object.fromEntries(Object.entries(rawVariables).map(([key, value]) => [`COMPONENT.${key}`, value]))
  }
}

function datasetVariables(dataset: any) {
  const rawVariables = Object.fromEntries(Object.entries(dataset?.variables || {}).map(([key, value]) => [key, String(value)]))
  return {
    ...rawVariables,
    ...Object.fromEntries(Object.entries(rawVariables).map(([key, value]) => [`DATASET.${key}`, value]))
  }
}

function findValue(map: Record<string, string>, key: string) {
  const exact = map[key]
  if (exact !== undefined) return exact
  const matchingKey = Object.keys(map).find(item => item.toLowerCase() === key.toLowerCase())
  return matchingKey ? map[matchingKey] : undefined
}

function sourceLabel(source: VariableSource, t: VariableReferenceHintsProps['t']) {
  const labels: Record<VariableSource, string> = {
    environment: t('casos.variableSourceEnvironment'),
    component: t('casos.variableSourceComponent'),
    dataset: t('casos.variableSourceDataset'),
    case: t('casos.variableSourceCase'),
    unknown: t('casos.variableSourceUnknown')
  }
  return labels[source]
}

function resolveReference(
  token: string,
  environments: any[],
  selectedEnvironment: any,
  selectedDataset: any,
  component: any,
  caseVariables: Record<string, string>,
  t: VariableReferenceHintsProps['t']
): VariableReference {
  const [prefix, ...parts] = token.split('.')
  const isPrefixed = ['ENV', 'COMPONENT', 'DATASET'].includes(prefix.toUpperCase())
  const key = isPrefixed ? parts.join('.') : token
  const envMap = environmentVariables(selectedEnvironment)
  const componentMap = componentVariables(component)
  const datasetMap = datasetVariables(selectedDataset)
  const sourceMaps: Array<{ source: VariableSource; map: Record<string, string>; sourceName: string }> = [
    { source: 'case', map: caseVariables, sourceName: t('casos.variableContextCase') },
    { source: 'dataset', map: datasetMap, sourceName: selectedDataset?.nombre || selectedDataset?.name || t('casos.variableContextSelectedDataset') },
    { source: 'component', map: componentMap, sourceName: component?.nombre || component?.name || t('casos.variableContextComponent') },
    { source: 'environment', map: envMap, sourceName: selectedEnvironment?.nombre || selectedEnvironment?.name || t('casos.variableContextSelectedEnvironment') }
  ]
  const prefixedSource: Record<string, VariableSource> = { ENV: 'environment', COMPONENT: 'component', DATASET: 'dataset' }
  const preferredSource = prefixedSource[prefix.toUpperCase()]
  const orderedMaps = preferredSource ? sourceMaps.filter(item => item.source === preferredSource) : sourceMaps
  const resolved = orderedMaps.find(item => findValue(item.map, preferredSource ? token : key) !== undefined)
  const source = resolved?.source || 'unknown'
  const value = resolved ? (findValue(resolved.map, preferredSource ? token : key) ?? null) : null
  const lookupKey = preferredSource ? token : key
  const alternatives: VariableReference['alternatives'] = []

  if (source === 'dataset' || preferredSource === 'dataset') {
    for (const environment of environments) {
      for (const dataset of environment.datasets || []) {
        const datasetValue = findValue(datasetVariables(dataset), lookupKey.startsWith('DATASET.') ? lookupKey : `DATASET.${lookupKey}`)
        if (datasetValue !== undefined) alternatives.push({
          context: `${environment.name || environment.nombre} / ${dataset.name || dataset.nombre}`,
          value: datasetValue,
          selected: String(dataset.id) === String(selectedDataset?.id)
        })
      }
    }
  } else if (source === 'environment' || preferredSource === 'environment') {
    for (const environment of environments) {
      const environmentValue = findValue(environmentVariables(environment), lookupKey.startsWith('ENV.') ? lookupKey : key)
      if (environmentValue !== undefined) alternatives.push({
        context: environment.name || environment.nombre,
        value: environmentValue,
        selected: String(environment.id) === String(selectedEnvironment?.id)
      })
    }
  } else if (source === 'component') {
    alternatives.push({ context: component?.nombre || component?.name || t('casos.variableContextComponent'), value, selected: true })
  } else if (source === 'case') {
    alternatives.push({ context: t('casos.variableContextCase'), value, selected: true })
  }

  const rawKey = preferredSource ? parts.join('.') : key
  return {
    token,
    key: rawKey,
    source,
    sourceName: resolved?.sourceName || t('casos.variableSourceUnavailable'),
    value,
    masked: isSensitiveKey(rawKey),
    alternatives
  }
}

export function VariableReferenceHints({
  value,
  caseData,
  environments = [],
  selectedEnvironment,
  selectedDataset,
  component,
  triggerLabel,
  t
}: VariableReferenceHintsProps) {
  const [showModal, setShowModal] = useState(false)
  const references = useMemo(() => {
    const text = String(value || '')
    const placeholderTokens = [...text.matchAll(TOKEN_PATTERN)].map(match => match[1])
    const codeTokens = [...text.matchAll(VARIABLE_ACCESS_PATTERN)].map(match => match[1])
    const uniqueTokens = [...new Set([...placeholderTokens, ...codeTokens])]
    const caseVariables = parseAssignments(caseData)
    return uniqueTokens.map(token => resolveReference(token, environments, selectedEnvironment, selectedDataset, component, caseVariables, t))
  }, [value, caseData, environments, selectedEnvironment, selectedDataset, component, t])

  if (references.length === 0) return null

  const conflictCount = references.filter(reference => reference.alternatives.length > 1).length
  const label = triggerLabel || t('casos.variableCount', { count: references.length })

  return (
    <div className="variable-reference-hints mt-1" aria-label={t('casos.variableReferencesLabel')}>
      <Button
        type="button"
        variant={conflictCount ? 'outline-warning' : 'outline-secondary'}
        size="sm"
        className="variable-reference-trigger"
        onClick={() => setShowModal(true)}
        title={t('casos.variableReferenceOpenDetails')}
        aria-label={conflictCount ? `${label}. ${t('casos.variableConflictCount', { count: conflictCount })}` : label}
      >
        {conflictCount > 0 && <AlertTriangle size={13} aria-hidden="true" />}
        <span>{label}</span>
        {conflictCount > 0 && <Badge bg="warning" text="dark">{conflictCount}</Badge>}
      </Button>
      <Modal show={showModal} onHide={() => setShowModal(false)} centered scrollable size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{t('casos.variableReferenceDetailsTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small text-muted mb-3">{t('casos.variableReferenceDetectedList')}</div>
          <Table responsive bordered hover size="sm" className="align-middle variable-reference-table mb-0">
            <thead className="table-light">
              <tr>
                <th>{t('casos.variableReferenceColumnVariable')}</th>
                <th>{t('casos.variableReferenceValue')}</th>
                <th>{t('casos.variableReferenceColumnOrigin')}</th>
                <th>{t('casos.variableReferenceColumnOtherContexts')}</th>
              </tr>
            </thead>
            <tbody>
              {references.map(reference => {
                const otherValues = reference.alternatives.filter(alternative => !alternative.selected)
                return (
                  <tr key={reference.token}>
                    <td className="font-monospace fw-bold text-break">{`{{${reference.token}}}`}</td>
                    <td className="font-monospace fw-bold text-primary text-break">
                      {visibleValue(reference.value, reference.masked)}
                      {reference.masked && <div className="text-muted fw-normal small">{t('casos.variableReferenceMasked')}</div>}
                    </td>
                    <td className="text-break">
                      <Badge bg="primary">{sourceLabel(reference.source, t)}</Badge>
                      <div className="small text-muted mt-1">{reference.sourceName}</div>
                    </td>
                    <td className="text-break">
                      {otherValues.length === 0 ? (
                        <span className="text-muted">{t('casos.variableReferenceNoOtherValues')}</span>
                      ) : (
                        <div className="d-flex flex-column gap-1">
                          {otherValues.map(alternative => (
                            <span key={`${reference.token}-${alternative.context}-${alternative.value}`} className="small">
                              <strong>{alternative.context}:</strong>{' '}
                              <span className="font-monospace">{visibleValue(alternative.value, reference.masked)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <div className="small text-muted mt-3">{t('casos.variableReferencePrecedence')}</div>
        </Modal.Body>
      </Modal>
    </div>
  )
}
