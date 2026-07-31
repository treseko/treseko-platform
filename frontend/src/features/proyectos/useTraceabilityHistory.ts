import { useMemo, useState } from 'react'
import { API_BASE } from '../../app/constants'

type HistoryKind = 'requisitos' | 'historias'

export function useTraceabilityHistory(options: any) {
  const { t, tx, fetchWithAuth, readJson, showFeedback } = options
  const [historyEntries, setHistoryEntries] = useState<any[] | null>(null)
  const [historyKind, setHistoryKind] = useState<HistoryKind | null>(null)
  const [historyTitle, setHistoryTitle] = useState('')
  const [historyCode, setHistoryCode] = useState('')
  const [historyDiff, setHistoryDiff] = useState<any | null>(null)
  const openHistory = async (item: any, kind: HistoryKind) => {
    setHistoryKind(kind)
    setHistoryDiff(null)
    try {
      setHistoryTitle(item.titulo)
      setHistoryCode(item.codigo || '')
      setHistoryEntries(await readJson(await fetchWithAuth(`${API_BASE}/${kind}/${item.id}/history/`)))
    } catch (error: any) {
      showFeedback(t('proyectos.history'), error.message, 'danger')
    }
  }
  const historyDisplayActor = (entry: any) => {
    const fullName = String(entry?.editado_por_nombre || '').trim()
    const email = String(entry?.editado_por_email || '').trim()
    if (!fullName && !email) return tx('unknownUser')
    if (fullName && email && fullName.toLowerCase() !== email.toLowerCase()) return `${fullName} (${email})`
    return fullName || email
  }
  const historyComparableFields = (kind: HistoryKind) => kind === 'requisitos'
    ? [
      { key: 'titulo', label: tx('title') }, { key: 'descripcion_markdown', label: tx('description') },
      { key: 'estado', label: tx('historyState') }, { key: 'prioridad', label: tx('historyPriority') },
      { key: 'external_provider', label: tx('externalProviderHistory') }, { key: 'external_reference', label: tx('externalReferenceHistory') },
      { key: 'external_url', label: tx('externalUrlHistory') },
    ]
    : [
      { key: 'titulo', label: tx('title') }, { key: 'descripcion_markdown', label: tx('description') },
      { key: 'criterios_aceptacion_markdown', label: tx('acceptanceMarkdown') }, { key: 'estado', label: tx('historyState') },
      { key: 'prioridad', label: tx('historyPriority') }, { key: 'external_provider', label: tx('externalProviderHistory') },
      { key: 'external_reference', label: tx('externalReferenceHistory') }, { key: 'external_url', label: tx('externalUrlHistory') },
    ]
  const normalizeHistoryValue = (value: any) => {
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'boolean') return value ? tx('yes') : tx('no')
    return String(value).trim()
  }
  const openHistoryDiff = (index: number) => {
    if (!historyEntries || !historyKind) return
    const current = historyEntries[index]
    if (!current) return
    setHistoryDiff({ kind: historyKind, current, previous: historyEntries[index + 1] || null })
  }
  const historyDiffRows = useMemo(() => {
    if (!historyDiff) return []
    const fields = historyComparableFields(historyDiff.kind)
    const current = historyDiff.current || {}
    const previous = historyDiff.previous || null
    return fields.map(({ key, label }) => {
      const currentValue = normalizeHistoryValue(current[key])
      const previousValue = previous ? normalizeHistoryValue(previous[key]) : ''
      if (!previous || currentValue === previousValue) return null
      return { key, label, currentValue, previousValue }
    }).filter((entry): entry is { key: string; label: string; currentValue: string; previousValue: string } => entry !== null)
  }, [historyDiff])
  return { historyEntries, historyKind, historyTitle, historyCode, historyDiff, openHistory, historyDisplayActor, openHistoryDiff, historyDiffRows, setHistoryEntries, setHistoryKind, setHistoryTitle, setHistoryCode, setHistoryDiff }
}
