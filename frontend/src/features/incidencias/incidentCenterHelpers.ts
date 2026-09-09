export const INCIDENT_STATUSES = [
  'ABIERTO', 'TRIAGE', 'ASIGNADO', 'EN_PROGRESO', 'BLOQUEADO',
  'REABIERTO', 'LISTO_PARA_RETEST', 'EN_RETEST', 'RESUELTO', 'CERRADO',
  'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE',
]

export const INCIDENT_SEVERITIES = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA']
export const INCIDENT_PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4']

export const INCIDENT_STATUS_KEYS: Record<string, string> = {
  ABIERTO: 'statusOpen', TRIAGE: 'statusTriage', ASIGNADO: 'statusAssigned',
  EN_PROGRESO: 'statusInProgress', BLOQUEADO: 'statusBlocked', REABIERTO: 'statusReopened',
  LISTO_PARA_RETEST: 'statusReadyRetest', EN_RETEST: 'statusRetest', RESUELTO: 'statusResolved',
  CERRADO: 'statusClosed', DUPLICADO: 'statusDuplicate', NO_REPRODUCIBLE: 'statusNotReproducible',
  NO_CORRESPONDE: 'statusNotApplicable',
}

export const INCIDENT_SEVERITY_KEYS: Record<string, string> = {
  CRITICA: 'severityCritical', ALTA: 'severityHigh', MEDIA: 'severityMedium', BAJA: 'severityLow',
}

export const INCIDENT_PRIORITY_KEYS: Record<string, string> = {
  P0: 'priorityP0', P1: 'priorityP1', P2: 'priorityP2', P3: 'priorityP3', P4: 'priorityP4',
}

export const itemName = (item: any, fallback = '') =>
  item?.name || item?.nombre || item?.title || item?.titulo || item?.display_name || item?.nombre_completo || fallback

export const incidentCaseLabel = (bug: any) => bug?.case_title || bug?.case_name || bug?.case_code || bug?.caso_id || ''
export const incidentBuildLabel = (bug: any) => bug?.build_name || bug?.build_code || bug?.build_id || ''
export const incidentComponentLabel = (bug: any) => bug?.component_name || bug?.componentName || bug?.componente_id || ''
export const incidentOrganizationLabel = (item: any, fallback = 'Solución sin nombre') => itemName(item, item?.orgName || item?.organizacion_nombre || item?.organization_name || fallback)

export const userLabel = (user: any) => itemName(user, user?.email || user?.id || '')

export const isOpenIncident = (status: string) => !['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'].includes(String(status || '').toUpperCase())

export const normalizeIncidentPayload = (payload: any) => ({
  items: Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [],
  total: Number(payload?.total ?? (Array.isArray(payload) ? payload.length : 0)),
  skip: Number(payload?.skip || 0),
  limit: Number(payload?.limit || 50),
  summary: payload?.summary || {},
})

export const incidentFilterParams = (filters: Record<string, string>, limit = 50) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (!value) return
    if (key === 'desde' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return params.set(key, `${value}T00:00:00`)
    if (key === 'hasta' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return params.set(key, `${value}T23:59:59`)
    params.set(key, value)
  })
  params.set('limit', String(limit))
  return params
}

export const incidentErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await response.json()
    const detail = typeof payload?.detail === 'string' ? payload.detail : ''
    const safeDetail = detail.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    return safeDetail ? `${fallback} (${response.status}): ${safeDetail}` : `${fallback} (${response.status})`
  } catch {
    return `${fallback} (${response.status})`
  }
}

export const filteredIncidents = (items: any[], mineOnly: boolean, currentUserId?: string) => {
  if (!mineOnly || !currentUserId) return items
  return items.filter(item => String(item.asignado_a || '') === String(currentUserId))
}

export const incidentActionRequest = (action: 'assign' | 'transition' | 'solution' | 'comment', body: Record<string, any>) => ({
  method: action === 'transition' || action === 'comment' ? 'POST' : 'PATCH',
  path: action === 'transition' ? '/transition/' : action === 'comment' ? '/comments/' : '',
  body,
} as const)

export const normalizeIncidentDetail = (payload: { comments?: any[]; history?: any[]; attachments?: any[] } = {}) => ({
  comments: Array.isArray(payload.comments) ? payload.comments : [],
  history: Array.isArray(payload.history) ? payload.history : [],
  attachments: Array.isArray(payload.attachments) ? payload.attachments.map(item => {
    const attachment = item?.attachment || item
    if (!attachment) return null
    return { ...attachment, id: attachment.id || item?.attachment_id || item?.id, attachment_id: item?.attachment_id || attachment.id }
  }).filter(Boolean) : [],
})

export const incidentAttachmentLinkRequest = (attachmentId: string) => ({
  method: 'POST' as const,
  path: '/attachments/',
  body: { attachment_id: attachmentId, tipo: 'BUG_EVIDENCE' },
})
