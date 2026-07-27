const CLOSED_BUG_STATES = new Set([
  'RESUELTO',
  'CERRADO',
  'DUPLICADO',
  'NO_REPRODUCIBLE',
  'NO_CORRESPONDE',
])

export function isOpenBugState(estado?: string | null) {
  return !CLOSED_BUG_STATES.has(String(estado || '').toUpperCase())
}

export function readInternalReportTokenFromLocation(location: Pick<Location, 'search' | 'pathname'> = window.location) {
  const queryToken = new URLSearchParams(location.search).get('internal_report') || ''
  if (queryToken) return queryToken
  const match = location.pathname.match(/^\/informes-internos\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

export function readStoredAuthentication(storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage, now = Date.now()) {
  if (storage.getItem('qa_session_active') !== 'true') return false
  const expiresAt = storage.getItem('qa_session_expires_at')
  if (expiresAt) {
    const expiresMs = Date.parse(expiresAt)
    if (Number.isFinite(expiresMs) && expiresMs <= now) {
      for (const key of ['qa_session_active', 'qa_session_user', 'qa_access_token', 'qa_session_expires_at']) storage.removeItem(key)
      return false
    }
  }
  return Boolean(storage.getItem('qa_access_token'))
}
