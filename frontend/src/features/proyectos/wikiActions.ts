import type { Dispatch, SetStateAction } from 'react'
import { API_BASE } from '../../app/constants'
import { mapBackendWikiToItem } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'
import { formatDateTime } from '../../shared/utils/dateTime'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'
type ConfirmAction = (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>

type WikiMode = 'list' | 'view' | 'edit' | 'history'

type CreateWikiActionsParams = {
  projectsSource: 'local' | 'backend'
  managingProjectId: string | null
  selectedWiki: any
  wikiFormData: { title: string; content: string }
  wikiPages: any[]
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  setWikiPages: Dispatch<SetStateAction<any[]>>
  setSelectedWiki: Dispatch<SetStateAction<any>>
  setWikiMode: Dispatch<SetStateAction<WikiMode>>
  setProjectSyncMessage: (message: string) => void
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
  confirmAction: ConfirmAction
}

export function createWikiActions({
  projectsSource,
  managingProjectId,
  selectedWiki,
  wikiFormData,
  wikiPages,
  fetchWithAuth,
  setWikiPages,
  setSelectedWiki,
  setWikiMode,
  setProjectSyncMessage,
  showFeedback,
  confirmAction
}: CreateWikiActionsParams) {
  const loadWikiForProject = async (projectId: string) => {
    if (!projectId || !isValidUUID(projectId) || projectsSource !== 'backend') return
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/wiki/`)
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || `Backend respondió ${response.status}`)
      }

      const pages = await response.json()
      const mapped = pages.map(mapBackendWikiToItem)
      setWikiPages(prev => [
        ...prev.filter(page => page.projectId !== projectId),
        ...mapped
      ])
    } catch (error: any) {
      setProjectSyncMessage(`No se pudo cargar wiki: ${error.message}.`)
    }
  }

  const handleSaveWikiPage = async () => {
    if (!wikiFormData.title || !wikiFormData.content || !managingProjectId) {
      showFeedback('Campos obligatorios', 'El título y el contenido son obligatorios.', 'warning')
      return
    }

    const now = formatDateTime(new Date().toISOString(), { dateStyle: 'short', timeStyle: 'short' })
    const localPage = {
      id: selectedWiki?.id || `w${Date.now()}`,
      projectId: managingProjectId,
      title: wikiFormData.title,
      content: wikiFormData.content,
      lastEditedBy: 'Admin QA',
      lastEditedAt: now,
      history: selectedWiki ? [{ date: now, author: 'Admin QA', action: 'Edición de contenido' }, ...selectedWiki.history] : [{ date: now, author: 'Admin QA', action: 'Creación del documento' }]
    }

    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(selectedWiki ? `${API_BASE}/wiki/${selectedWiki.id}` : `${API_BASE}/wiki/`, {
          method: selectedWiki ? 'PATCH' : 'POST',
          body: JSON.stringify(selectedWiki ? {
            titulo: wikiFormData.title,
            contenido: wikiFormData.content,
            comentario_cambio: 'Edición desde frontend'
          } : {
            proyecto_id: managingProjectId,
            titulo: wikiFormData.title,
            contenido: wikiFormData.content
          })
        })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
        const page = await response.json()
        const mapped = mapBackendWikiToItem(page)
        setWikiPages(selectedWiki ? wikiPages.map(wiki => wiki.id === mapped.id ? mapped : wiki) : [...wikiPages, mapped])
        setProjectSyncMessage('Wiki guardada y persistida en backend.')
      } catch (error: any) {
        setWikiPages(selectedWiki ? wikiPages.map(wiki => wiki.id === localPage.id ? localPage : wiki) : [...wikiPages, localPage])
        setProjectSyncMessage(`No se pudo persistir wiki: ${error.message}. Cambio aplicado localmente.`)
      }
    } else {
      setWikiPages(selectedWiki ? wikiPages.map(wiki => wiki.id === localPage.id ? localPage : wiki) : [...wikiPages, localPage])
    }
    setSelectedWiki(null)
    setWikiMode('list')
  }

  const handleDeleteWikiPage = async (pageId: string) => {
    const page = wikiPages.find(wiki => wiki.id === pageId)
    const confirmed = await confirmAction({
      title: 'Eliminar documento',
      message: `Se eliminará "${page?.title || 'documento'}". Esta acción no se puede deshacer.`,
      variant: 'danger',
      confirmLabel: 'Eliminar documento'
    })
    if (!confirmed) return
    if (projectsSource === 'backend') {
      try {
        const response = await fetchWithAuth(`${API_BASE}/wiki/${pageId}`, { method: 'DELETE' })
        if (!response.ok) {
          const error = await response.json().catch(() => null)
          throw new Error(error?.detail || `Backend respondió ${response.status}`)
        }
      } catch (error: any) {
        setProjectSyncMessage(`No se pudo eliminar wiki: ${error.message}.`)
        return
      }
    }
    setWikiPages(wikiPages.filter(wiki => wiki.id !== pageId))
  }

  return {
    loadWikiForProject,
    handleSaveWikiPage,
    handleDeleteWikiPage
  }
}
