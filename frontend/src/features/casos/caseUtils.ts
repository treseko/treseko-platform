import { formatDateTime } from '../../shared/utils/dateTime'

export const formatDatasetForInput = (dataset: any) => {
  if (!Array.isArray(dataset)) return dataset || ''
  if (dataset.length === 1 && dataset[0]?.key === 'contexto') return dataset[0]?.value || ''
  return dataset
    .map(item => item?.key ? `${item.key}=${item.value ?? ''}` : Object.entries(item || {}).map(([key, value]) => `${key}=${value}`).join(' / '))
    .join('\n')
}

export const parseDatasetInput = (value: string) => {
  const text = value.trim()
  if (!text) return []
  const normalizeValue = (itemValue: any) => typeof itemValue === 'string' ? itemValue : JSON.stringify(itemValue)
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.flatMap(item => item?.key
        ? [{ key: String(item.key), value: normalizeValue(item.value ?? '') }]
        : Object.entries(item || {}).map(([key, itemValue]) => ({ key, value: normalizeValue(itemValue) }))
      )
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([key, itemValue]) => ({ key, value: normalizeValue(itemValue) }))
    }
  } catch {
    // Texto libre: se parsea abajo como key=value o contexto.
  }
  const parts = text.split(/\r?\n|\s+\/\s+/).map(part => part.trim()).filter(Boolean)
  if (parts.length > 0 && parts.every(part => part.includes('='))) {
    return parts.map(part => {
      const separator = part.indexOf('=')
      return { key: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
    }).filter(item => item.key)
  }
  return [{ key: 'contexto', value: text }]
}

export const backendTestTypeToEditor = (value: any) => {
  if (value === 'Automatizada' || value === 'AUTOMATIZADA') return 'Automatizada'
  if (value === 'AI Agent' || value === 'AUTOMATIZADA_AI') return 'AI Agent'
  return 'Manual'
}

export const editorTestTypeToBackend = (value: any) => {
  if (value === 'Automatizada') return 'AUTOMATIZADA'
  if (value === 'AI Agent') return 'AUTOMATIZADA_AI'
  return 'MANUAL'
}

export const languageOptionsByFramework: Record<string, string[]> = {
  playwright: ['javascript', 'typescript', 'python', 'java', 'csharp'],
  cypress: ['javascript', 'typescript'],
  puppeteer: ['javascript', 'typescript'],
  selenium: ['java', 'python', 'csharp', 'javascript', 'typescript', 'ruby']
}

export const defaultLanguageForFramework = (framework: string) =>
  languageOptionsByFramework[framework]?.[0] || 'javascript'

export const normalizeAutomationLanguage = (language: any) => {
  const raw = String(language || '').trim().toLowerCase()
  const aliases: Record<string, string> = {
    js: 'javascript',
    node: 'javascript',
    nodejs: 'javascript',
    ts: 'typescript',
    py: 'python',
    dotnet: 'csharp',
    '.net': 'csharp',
    'c#': 'csharp',
    'c# (.net)': 'csharp',
    'csharp (.net)': 'csharp',
    cs: 'csharp'
  }
  return aliases[raw] || raw
}

export const languageLabel = (language: string) => {
  const normalized = normalizeAutomationLanguage(language)
  const labels: Record<string, string> = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    java: 'Java',
    csharp: 'C# (.NET)',
    ruby: 'Ruby'
  }
  return labels[normalized] || language
}

export const splitFrameworkLanguage = (value: any) => {
  const raw = String(value || 'playwright').trim().toLowerCase()
  const [frameworkPart, languagePart] = raw.split(':', 2)
  const framework = (frameworkPart || 'playwright').split('@', 1)[0] || 'playwright'
  const options = languageOptionsByFramework[framework] || ['javascript']
  const normalizedLanguage = normalizeAutomationLanguage(languagePart)
  const language = normalizedLanguage && options.includes(normalizedLanguage)
    ? normalizedLanguage
    : defaultLanguageForFramework(framework)
  return { framework, language }
}

export const composeFrameworkLanguage = (framework: string, language: string) => {
  const baseFramework = framework || 'playwright'
  const normalizedLanguage = normalizeAutomationLanguage(language)
  const validLanguage = languageOptionsByFramework[baseFramework]?.includes(normalizedLanguage)
    ? normalizedLanguage
    : defaultLanguageForFramework(baseFramework)
  return `${baseFramework}:${validLanguage}`
}

export const normalizeCaseTags = (tags: any): string[] => {
  const rawTags = Array.isArray(tags)
    ? tags
    : String(tags || '').split(/[,;\n]/)
  const seen = new Set<string>()
  return rawTags
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .filter(tag => {
      const key = tag.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export const mapBackendCasoToTest = (caso: any, componentsSnapshot: any[] = [], fallbackProjectId = '') => {
  const componentId = caso.componente_id || ''
  const component = componentsSnapshot.find(c => String(c.id) === String(componentId))
  const componentName = component?.name || component?.nombre || caso.componente_nombre || caso.component_name || caso.modulo_funcional
  const hasStepsCount = caso.steps_count !== undefined && caso.steps_count !== null
  return {
    id: caso.id,
    projectId: caso.proyecto_id || fallbackProjectId,
    code: caso.codigo || `TC-${String(caso.id).slice(0, 4).toUpperCase()}`,
    masterId: caso.master_id,
    suiteId: caso.suite_id || '',
    subSuiteId: caso.suite_id || '',
    title: caso.titulo,
    status: 'none',
    type: backendTestTypeToEditor(caso.tipo_prueba),
    component: componentName || (componentId ? 'Componente no encontrado' : 'Sin componente asignado'),
    componentId,
    description: caso.descripcion || '',
    pre: caso.precondiciones || '',
    post: caso.postcondiciones || '',
    data: formatDatasetForInput(caso.dataset),
    tags: normalizeCaseTags(caso.etiquetas),
    version: caso.version,
    latestVersion: caso.latest_version ?? caso.version,
    latestCaseId: caso.latest_case_id || caso.id,
    isOutdatedVersion: Boolean(caso.is_outdated_version),
    isHistoricalBuildVersion: Boolean(caso.is_outdated_version),
    priority: caso.prioridad,
    criticality: caso.criticidad,
    caseStatus: caso.estado_caso,
    stepsCount: Array.isArray(caso.pasos) ? caso.pasos.length : (hasStepsCount ? caso.steps_count : null),
    globalLastResult: caso.ultimo_resultado ?? null,
    globalLastExecutedBy: caso.ultima_ejecucion_por_nombre ?? caso.ultima_ejecucion_por_email ?? null,
    globalLastExecutedAt: caso.ultima_ejecucion_fecha ? formatDateTime(caso.ultima_ejecucion_fecha) : null,
    lastResult: null,
    lastExecutedBy: null,
    lastExecutedAt: null,
    lastExecutedVersion: null,
    history: []
  }
}

export const mergeCasesById = (baseCases: any[], extraCases: any[]) => {
  const merged = new Map(baseCases.map(test => [test.id, test]))
  const preserveIfMissing = ['stepsCount', 'lastResult', 'lastExecutedAt', 'lastExecutedBy', 'lastExecutedVersion', 'history']
  const mergeCase = (existing: any, incoming: any) => {
    if (!existing) return incoming
    const next = { ...existing, ...incoming }
    preserveIfMissing.forEach(key => {
      const incomingValue = incoming?.[key]
      const existingValue = existing?.[key]
      const incomingMissing = incomingValue === null || incomingValue === undefined || (Array.isArray(incomingValue) && incomingValue.length === 0)
      const existingHasValue = existingValue !== null && existingValue !== undefined && (!Array.isArray(existingValue) || existingValue.length > 0)
      if (incomingMissing && existingHasValue) next[key] = existingValue
    })
    return next
  }
  extraCases.forEach(test => {
    const existing = merged.get(test.id)
    merged.set(test.id, mergeCase(existing, test))
  })
  return Array.from(merged.values())
}
