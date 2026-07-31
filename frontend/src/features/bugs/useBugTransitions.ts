import { useState } from 'react'
import { API_BASE } from '../../app/constants'

const CLOSED = new Set(['RESUELTO', 'CERRADO', 'DUPLICADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'])
const CORRECTED = new Set(['RESUELTO', 'CERRADO'])
const errorMessage = async (response: Response) => {
  const text = await response.text()
  try { const payload = JSON.parse(text); return payload?.detail || payload?.message || text } catch { return text }
}

export function useBugTransitions(options: any) {
  const { buildsList, currentBuildId, selectedBug, fetchWithAuth, showFeedback, setBugs,
    setSelectedBug, hydrateDetailEditState, loadBugs, onBugsChanged, t } = options
  const [quickTransitioningBugId, setQuickTransitioningBugId] = useState<string | null>(null)
  const [transitionTarget, setTransitionTarget] = useState<{ bug: any; estado: string } | null>(null)
  const [transitionForm, setTransitionForm] = useState({ resolution_build_id: '', resolucion: '', motivo_cierre: '' })
  const compatibleBuilds = (bug: any) => buildsList.filter((build: any) => {
    const componentId = build.componente_id || build.component_id
    return build.activo !== false && (!bug?.componente_id || !componentId || String(componentId) === String(bug.componente_id))
  })
  const perform = async (bug: any, estado: string, extra: Record<string, any> = {}) => {
    setQuickTransitioningBugId(bug.id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}/transition/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado, ...extra }),
      })
      if (!response.ok) throw new Error(await errorMessage(response))
      const updated = await response.json()
      setBugs((current: any[]) => current.map((item) => item.id === bug.id ? { ...item, ...updated } : item))
      if (selectedBug?.id === bug.id) { setSelectedBug(updated); hydrateDetailEditState(updated) }
      showFeedback(t('bugs.statusUpdated'), t('bugs.statusUpdatedMessage', { bug: updated.codigo || bug.codigo, status: updated.estado || estado }), 'success')
      onBugsChanged?.(); void loadBugs({ silent: true }); return true
    } catch (error: any) {
      showFeedback(t('bugs.pageTitle'), error?.message || t('bugs.transitionError'), 'danger'); return false
    } finally { setQuickTransitioningBugId(null) }
  }
  const requestTransition = (bug: any, estado: string) => {
    if (!bug?.id || estado === bug.estado) return
    const reopening = CLOSED.has(String(bug.estado || '').toUpperCase()) && estado === 'REABIERTO'
    if (!CLOSED.has(estado) && !reopening) { void perform(bug, estado); return }
    const choices = compatibleBuilds(bug)
    const defaultBuild = choices.find((item: any) => String(item.id) === String(currentBuildId)) || choices[0]
    setTransitionForm({ resolution_build_id: (CORRECTED.has(estado) || reopening) ? (bug.resolved_build_id || defaultBuild?.id || '') : '',
      resolucion: bug.resolucion || '', motivo_cierre: bug.motivo_cierre || '' })
    setTransitionTarget({ bug, estado })
  }
  const confirmTransition = async () => {
    if (!transitionTarget) return
    const reopening = transitionTarget.estado === 'REABIERTO'
    if ((CORRECTED.has(transitionTarget.estado) || reopening) && !transitionForm.resolution_build_id) {
      showFeedback(t('bugs.buildRequired'), reopening ? t('bugs.selectReappearanceBuild') : t('bugs.selectCorrectionBuild'), 'warning'); return
    }
    if (await perform(transitionTarget.bug, transitionTarget.estado, transitionForm)) setTransitionTarget(null)
  }
  return { quickTransitioningBugId, transitionTarget, transitionForm, setTransitionForm, setTransitionTarget,
    compatibleBuilds, requestTransition, confirmTransition, isCorrected: (status: string) => CORRECTED.has(status) }
}
