import { useEffect, useState } from 'react'
import { API_BASE } from '../../app/constants'

export function useProjectBugIssues(options: any) {
  const { managingProjectId, projectInnerTab, fetchWithAuth, showFeedback, t } = options
  const [bugIssues, setBugIssues] = useState<any[]>([])
  const [bugsLoading, setBugsLoading] = useState(false)
  const [bugForm, setBugForm] = useState({ titulo: '', descripcion: '', severidad: 'MEDIA', prioridad: 'MEDIA', componente_id: '', build_id: '' })
  const loadProjectBugs = async () => {
    if (!managingProjectId || !fetchWithAuth) return
    setBugsLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${managingProjectId}/bugs`)
      if (!response.ok) throw new Error(await response.text())
      const payload = await response.json()
      setBugIssues(Array.isArray(payload) ? payload : (payload.items || []))
    } catch (error: any) {
      showFeedback?.(t('proyectos.couldNotLoadBugs'), error?.message || t('proyectos.checkProjectPermissions'), 'danger')
    } finally { setBugsLoading(false) }
  }
  useEffect(() => { if (projectInnerTab === 'tickets') loadProjectBugs() }, [projectInnerTab, managingProjectId])
  const createBugIssue = async (event: any) => {
    event.preventDefault()
    if (!bugForm.titulo.trim() || !managingProjectId) return
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proyecto_id: managingProjectId, componente_id: bugForm.componente_id || null, build_id: bugForm.build_id || null, titulo: bugForm.titulo.trim(), descripcion: bugForm.descripcion.trim(), severidad: bugForm.severidad, prioridad: bugForm.prioridad, origen: 'manual' }) })
      if (!response.ok) throw new Error(await response.text())
      setBugForm({ titulo: '', descripcion: '', severidad: 'MEDIA', prioridad: 'MEDIA', componente_id: '', build_id: '' })
      showFeedback?.(t('proyectos.bugCreated'), t('proyectos.bugAssociated'), 'success')
      await loadProjectBugs()
    } catch (error: any) { showFeedback?.(t('proyectos.couldNotCreateBug'), error?.message || t('proyectos.checkData'), 'danger') }
  }
  const updateBugIssue = async (bug: any, changes: any) => {
    try {
      const response = await fetchWithAuth(`${API_BASE}/bugs/${bug.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
      if (!response.ok) throw new Error(await response.text())
      await loadProjectBugs()
    } catch (error: any) { showFeedback?.(t('proyectos.couldNotUpdate'), error?.message || t('proyectos.checkPermissions'), 'danger') }
  }
  return { bugIssues, bugsLoading, bugForm, setBugForm, loadProjectBugs, createBugIssue, updateBugIssue }
}
