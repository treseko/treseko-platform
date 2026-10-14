import { useRef, useState } from 'react'
import { API_BASE } from '../../app/constants'

export function useTraceabilityCrud(options: any) {
  const { projectId, fetchWithAuth, readJson, showFeedback, tx, emptyRequirement, emptyStory, setRequirements, setStories } = options
  const busyRef = useRef(false)
  const [requirementForm, setRequirementForm] = useState<any>(emptyRequirement)
  const [storyForm, setStoryForm] = useState<any>(emptyStory)
  const [editingRequirement, setEditingRequirement] = useState<any>(null)
  const [editingStory, setEditingStory] = useState<any>(null)
  const [storyRequirementId, setStoryRequirementId] = useState('')
  const [showRequirementModal, setShowRequirementModal] = useState(false)
  const [showStoryModal, setShowStoryModal] = useState(false)
  const openRequirement = (item?: any) => {
    if (busyRef.current) return
    setEditingRequirement(item || null)
    setRequirementForm(item ? { ...item, componente_ids: item.componente_ids || [] } : { ...emptyRequirement, componente_ids: [] })
    setShowRequirementModal(true)
  }
  const saveRequirement = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busyRef.current) return null
    busyRef.current = true
    try {
      const url = editingRequirement ? `${API_BASE}/requisitos/${editingRequirement.id}` : `${API_BASE}/requisitos/`
      const result = await readJson(await fetchWithAuth(url, {
        method: editingRequirement ? 'PATCH' : 'POST',
        body: JSON.stringify(editingRequirement ? requirementForm : { ...requirementForm, proyecto_id: projectId }),
      }))
      setShowRequirementModal(false)
      setRequirements((previous: any[]) => editingRequirement ? previous.map((item) => item.id === result.id ? result : item) : [...previous, result])
      return { result, editing: Boolean(editingRequirement) }
    } catch (error: any) {
      showFeedback(tx('saveFailed'), error.message, 'danger')
      return null
    } finally { busyRef.current = false }
  }
  const openStory = (item?: any, requirementId?: string) => {
    if (busyRef.current) return
    setEditingStory(item || null)
    setStoryRequirementId(item?.requisito_id || requirementId || '')
    setStoryForm(item ? { ...item } : { ...emptyStory, acceptance_criteria: [{ local_id: 'AC-MANUAL-1', type: 'FUNCTIONAL', title: '', given: '', when: '', then: [], observable_result: '', mandatory: true, source_refs: [], assumption_ids: [] }] })
    setShowStoryModal(true)
  }
  const saveStory = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busyRef.current) return null
    busyRef.current = true
    try {
      const url = editingStory ? `${API_BASE}/historias/${editingStory.id}` : `${API_BASE}/historias/`
      const result = await readJson(await fetchWithAuth(url, {
        method: editingStory ? 'PATCH' : 'POST',
        body: JSON.stringify(editingStory ? { ...storyForm, expected_revision: editingStory.ultima_actualizacion } : { ...storyForm, proyecto_id: projectId, requisito_id: storyRequirementId }),
      }))
      setShowStoryModal(false)
      setStories((previous: any[]) => editingStory ? previous.map((item) => item.id === result.id ? result : item) : [...previous, result])
      return { result, editing: Boolean(editingStory) }
    } catch (error: any) {
      showFeedback(tx('saveFailed'), error.message, 'danger')
      return null
    } finally { busyRef.current = false }
  }
  return {
    requirementForm, setRequirementForm, storyForm, setStoryForm, editingRequirement, setEditingRequirement,
    editingStory, setEditingStory, storyRequirementId, setStoryRequirementId, showRequirementModal,
    setShowRequirementModal, showStoryModal, setShowStoryModal, openRequirement, saveRequirement,
    openStory, saveStory,
  }
}
