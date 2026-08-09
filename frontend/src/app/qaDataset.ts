export type QaDatasetEntry = {
  key: string
  value: string
}

const TECHNICAL_PREFIXES = ['ENV.', 'COMPONENT.', 'INTERNAL.', 'SYSTEM.']
const TECHNICAL_KEYS = new Set([
  'ID', 'URL', 'BASE_URL', 'STATUS', 'VERSION',
  'ENV_ID', 'ENV_URL', 'ENV_NAME', 'COMPONENT_ID', 'COMPONENT_URL',
  'COMPONENT_NAME', 'COMPONENT_CODE',
])

const isTechnicalDatasetKey = (key: string) => {
  const normalized = key.trim().toUpperCase()
  return TECHNICAL_KEYS.has(normalized) ||
    TECHNICAL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

const stringifyDatasetValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Converts the different dataset shapes returned by execution endpoints into
 * the small, user-facing QA dataset contract. Environment/component context
 * is deliberately excluded; it belongs to the technical trace, not the bug
 * reproduction data shown to testers.
 */
export const normalizeQaDatasetEntries = (value: unknown): QaDatasetEntry[] => {
  const entries: QaDatasetEntry[] = []
  const add = (key: unknown, rawValue: unknown) => {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey || isTechnicalDatasetKey(normalizedKey)) return
    entries.push({ key: normalizedKey, value: stringifyDatasetValue(rawValue) })
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const record = item as Record<string, unknown>
      add(record.key ?? record.name, record.value ?? record.valor)
    })
  } else if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, rawValue]) => add(key, rawValue))
  }

  return entries.filter((entry, index, all) => all.findIndex((item) => item.key === entry.key) === index)
}

export const qaDatasetEntriesFromBug = (bug: any): QaDatasetEntry[] => {
  const metadata = bug?.metadata_json || {}
  const canonical = normalizeQaDatasetEntries(metadata.dataset_resolved_values)
  if (canonical.length > 0) return canonical
  return normalizeQaDatasetEntries(metadata.dataset_variables)
}

export const qaDatasetVariables = (entries: QaDatasetEntry[]) => Object.fromEntries(
  entries.map((entry) => [entry.key, entry.value]),
)
