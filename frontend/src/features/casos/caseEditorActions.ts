import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AttachmentMeta } from '../../EvidenceUpload'
import { API_BASE } from '../../app/constants'
import { buildCaseEditorSnapshot } from '../../app/mappers'
import { isValidUUID } from '../../app/validation'
import { backendTestTypeToEditor, composeFrameworkLanguage, editorTestTypeToBackend, formatDatasetForInput, normalizeCaseTags, parseDatasetInput, splitFrameworkLanguage } from './caseUtils'

type FeedbackVariant = 'success' | 'danger' | 'warning' | 'info'

type CreateCaseEditorActionsParams = {
  newTestSteps: any[]
  newTestTitle: string
  newTestSuite: string
  newTestSuiteSub: string
  newTestComponent: string
  newTestDescription: string
  newTestPre: string
  newTestPost: string
  newTestData: string
  newTestTags: string[]
  newTestPriority: string
  newTestCriticality: string
  newTestStatus: string
  newTestType: string
  newTestScript: string
  newTestFramework: string
  newTestLanguage: string
  caseEditorSaving: boolean
  editingCasoMasterId: string | null
  selectedTest: any
  projectsSource: string
  currentProjectId: string
  currentCompId: string
  componentsList: any[]
  casosList: any[]
  currentCaseEditorSnapshot: any
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  handleCreateCaso: (payload: any) => Promise<any>
  handleUpdateCaso: (masterId: string, payload: any) => Promise<any>
  selectSuiteTarget: (suiteId: string) => void
  setExpandedSuites: Dispatch<SetStateAction<Record<string, boolean>>>
  setNewTestSteps: Dispatch<SetStateAction<any[]>>
  setNewTestTitle: (value: string) => void
  setNewTestDescription: (value: string) => void
  setNewTestPre: (value: string) => void
  setNewTestPost: (value: string) => void
  setNewTestData: (value: string) => void
  setNewTestTags: Dispatch<SetStateAction<string[]>>
  setNewTestPriority: (value: string) => void
  setNewTestCriticality: (value: string) => void
  setNewTestStatus: (value: string) => void
  setNewTestType: (value: string) => void
  setNewTestComponent: (value: string) => void
  setNewTestScript: (value: string) => void
  setNewTestFramework: (value: string) => void
  setNewTestLanguage: (value: string) => void
  setCaseEditorOpen: (open: boolean) => void
  setEditingCasoMasterId: (masterId: string | null) => void
  setSelectedTest: Dispatch<SetStateAction<any>>
  setCaseEditorBaseline: Dispatch<SetStateAction<any>>
  setAddTestSuccess: (success: boolean) => void
  setProjectSyncMessage: (message: string) => void
  setCurrentCompId: (componentId: string) => void
  setActiveTab: (tab: string) => void
  setCaseEditorSaving: (saving: boolean) => void
  setCasosList: Dispatch<SetStateAction<any[]>>
  showFeedback: (title: string, message: string, variant?: FeedbackVariant) => void
}

export function createCaseEditorActions({
  newTestSteps,
  newTestTitle,
  newTestSuite,
  newTestSuiteSub,
  newTestComponent,
  newTestDescription,
  newTestPre,
  newTestPost,
  newTestData,
  newTestTags,
  newTestPriority,
  newTestCriticality,
  newTestStatus,
  newTestType,
  newTestScript,
  newTestFramework,
  newTestLanguage,
  caseEditorSaving,
  editingCasoMasterId,
  selectedTest,
  projectsSource,
  currentProjectId,
  currentCompId,
  componentsList,
  casosList,
  currentCaseEditorSnapshot,
  fetchWithAuth,
  handleCreateCaso,
  handleUpdateCaso,
  selectSuiteTarget,
  setExpandedSuites,
  setNewTestSteps,
  setNewTestTitle,
  setNewTestDescription,
  setNewTestPre,
  setNewTestPost,
  setNewTestData,
  setNewTestTags,
  setNewTestPriority,
  setNewTestCriticality,
  setNewTestStatus,
  setNewTestType,
  setNewTestComponent,
  setNewTestScript,
  setNewTestFramework,
  setNewTestLanguage,
  setCaseEditorOpen,
  setEditingCasoMasterId,
  setSelectedTest,
  setCaseEditorBaseline,
  setAddTestSuccess,
  setProjectSyncMessage,
  setCurrentCompId,
  setActiveTab,
  setCaseEditorSaving,
  setCasosList,
  showFeedback
}: CreateCaseEditorActionsParams) {
  const addStepInput = () => {
    setNewTestSteps([...newTestSteps, {
      action: '', expected: '',
      data: '',
      actionImg: '',
      expectedImg: ''
    }])
  }

  const removeStepInput = (index: number) => {
    setNewTestSteps(newTestSteps.filter((_, i) => i !== index))
  }

  const duplicateStepInput = (index: number) => {
    const source = newTestSteps[index]
    if (!source) return
    const duplicated = {
      ...source,
      actionAttachments: [...(source.actionAttachments || [])],
      expectedAttachments: [...(source.expectedAttachments || [])]
    }
    setNewTestSteps([
      ...newTestSteps.slice(0, index + 1),
      duplicated,
      ...newTestSteps.slice(index + 1)
    ])
  }

  const moveStepInput = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newTestSteps.length) return
    const updated = [...newTestSteps]
    const current = updated[index]
    updated[index] = updated[targetIndex]
    updated[targetIndex] = current
    setNewTestSteps(updated)
  }

  const handleStepInputChange = (index: number, field: 'action' | 'data' | 'expected' | 'actionImg' | 'expectedImg', value: string) => {
    const updated = [...newTestSteps]
    updated[index][field] = value
    setNewTestSteps(updated)
  }

  const updateStepAttachments = (index: number, field: 'actionAttachments' | 'expectedAttachments', attachments: AttachmentMeta[]) => {
    setNewTestSteps(prev => prev.map((step, idx) => idx === index ? { ...step, [field]: attachments } : step))
  }

  const openCreateCaseInSuite = (suiteId: string) => {
    const projectComponents = componentsList.filter(c => c.projectId === currentProjectId)
    const componentId = isValidUUID(currentCompId)
      ? currentCompId
      : (projectComponents[0]?.id || '')

    selectSuiteTarget(suiteId)
    setExpandedSuites(prev => ({ ...prev, [suiteId]: true }))
    setEditingCasoMasterId(null)
    setCaseEditorOpen(true)
    setSelectedTest(null)
    setNewTestTitle('')
    setNewTestDescription('')
    setNewTestPre('')
    setNewTestPost('')
    setNewTestData('')
    setNewTestTags([])
    setNewTestPriority('MEDIA')
    setNewTestCriticality('MEDIA')
    setNewTestStatus('ACTIVO')
    setNewTestType('AI Agent')
    setNewTestSteps([])
    setNewTestComponent(componentId)
    setNewTestScript('')
    setNewTestFramework('playwright')
    setNewTestLanguage('javascript')
    setCaseEditorBaseline(buildCaseEditorSnapshot({
      suiteId,
      componentId,
      title: '',
      description: '',
      pre: '',
      post: '',
      data: '',
      tags: [],
      priority: 'MEDIA',
      criticality: 'MEDIA',
      status: 'ACTIVO',
      type: 'AI Agent',
      script: '',
      framework: composeFrameworkLanguage('playwright', 'javascript'),
      steps: []
    }))
    if (componentId) setCurrentCompId(componentId)
    setActiveTab('crear_pruebas')
    setProjectSyncMessage('Nuevo caso listo para crearse en la carpeta seleccionada.')
  }

  const openEditCase = async (test: any) => {
    try {
      let fullCase: any = null
      if (projectsSource === 'backend' && isValidUUID(test.id)) {
        const response = await fetchWithAuth(`${API_BASE}/casos/${test.id}`)
        if (response.ok) fullCase = await response.json()
      }
      const source = fullCase || test
      const suiteId = source.suite_id || test.suiteId
      if (suiteId) selectSuiteTarget(suiteId)
      const componentId = source.componente_id || test.componentId
      if (componentId) {
        setNewTestComponent(componentId)
        setCurrentCompId(componentId)
      }
      setEditingCasoMasterId(source.master_id || test.masterId)
      setCaseEditorOpen(true)
      setNewTestTitle(source.titulo || test.title || '')
      setNewTestDescription(source.descripcion || test.description || '')
      setNewTestPre(source.precondiciones || test.pre || '')
      setNewTestPost(source.postcondiciones || test.post || '')
      setNewTestPriority(source.prioridad || test.priority || 'MEDIA')
      setNewTestCriticality(source.criticidad || test.criticality || 'MEDIA')
      setNewTestStatus(source.estado_caso || test.caseStatus || 'ACTIVO')
      const editorType = source.tipo_prueba
        ? backendTestTypeToEditor(source.tipo_prueba)
        : backendTestTypeToEditor(test.type || 'Manual')
      setNewTestType(editorType)
      setNewTestScript(source.script_automatizado || test.script || '')
      const frameworkLanguage = splitFrameworkLanguage(source.framework || test.framework || 'playwright')
      setNewTestFramework(frameworkLanguage.framework)
      setNewTestLanguage(frameworkLanguage.language)
      const dataset = source.dataset ?? test.data
      const formattedDataset = formatDatasetForInput(dataset)
      setNewTestData(formattedDataset)
      setNewTestTags(normalizeCaseTags(source.etiquetas || test.tags))
      const pasosConAdjuntos = await Promise.all((source.pasos || []).map(async (step: any) => {
        let links: any[] = []
        try {
          const attachmentsResponse = await fetchWithAuth(`${API_BASE}/pasos/${step.id}/attachments/`)
          if (attachmentsResponse.ok) {
            links = await attachmentsResponse.json()
          }
        } catch {
          links = []
        }
        return {
          step,
          actionAttachments: links.filter(link => link.tipo === 'ACTION_REFERENCE').map(link => link.attachment),
          expectedAttachments: links.filter(link => link.tipo === 'EXPECTED_REFERENCE').map(link => link.attachment)
        }
      }))
      const editorSteps = pasosConAdjuntos.map(({ step, actionAttachments, expectedAttachments }: any) => ({
        action: step.accion || step.acción || '',
        data: step.datos || '',
        expected: step.resultado_esperado || '',
        actionImg: step.metadata_ai?.actionImg || '',
        expectedImg: step.metadata_ai?.expectedImg || '',
        actionAttachments,
        expectedAttachments
      }))
      setNewTestSteps(editorSteps)
      setCaseEditorBaseline(buildCaseEditorSnapshot({
        suiteId: suiteId || '',
        componentId: componentId || '',
        title: source.titulo || test.title || '',
        description: source.descripcion || test.description || '',
        pre: source.precondiciones || test.pre || '',
        post: source.postcondiciones || test.post || '',
        data: formattedDataset,
        tags: normalizeCaseTags(source.etiquetas || test.tags),
        priority: source.prioridad || test.priority || 'MEDIA',
        criticality: source.criticidad || test.criticality || 'MEDIA',
        status: source.estado_caso || test.caseStatus || 'ACTIVO',
        type: editorType,
        script: source.script_automatizado || test.script || '',
        framework: composeFrameworkLanguage(frameworkLanguage.framework, frameworkLanguage.language),
        steps: editorSteps
      }))
      setSelectedTest(test)
      setActiveTab('crear_pruebas')
      setProjectSyncMessage(`Editando caso ${test.code || test.id}. Al guardar se creará una nueva versión.`)
    } catch (error: any) {
      setProjectSyncMessage(`No se pudo cargar el caso para editar: ${error.message}`)
    }
  }

  const linkSavedStepAttachments = async (savedCase: any) => {
    if (!savedCase?.id) return
    const response = await fetchWithAuth(`${API_BASE}/casos/${savedCase.id}`)
    if (!response.ok) return
    const caseWithSteps = await response.json()
    const stepsByNumber = new Map((caseWithSteps.pasos || []).map((step: any) => [step.numero_paso, step]))
    for (const [index, formStep] of newTestSteps.entries()) {
      const savedStep: any = stepsByNumber.get(index + 1)
      if (!savedStep?.id) continue
      const linksByKey = new Map([
        ...(formStep.actionAttachments || []).map(attachment => ({ attachment, tipo: 'ACTION_REFERENCE' })),
        ...(formStep.expectedAttachments || []).map(attachment => ({ attachment, tipo: 'EXPECTED_REFERENCE' }))
      ].filter(link => link.attachment?.id).map(link => [`${link.attachment.id}:${link.tipo}`, link]))
      const links = Array.from(linksByKey.values())
      for (const link of links) {
        const linkResponse = await fetchWithAuth(`${API_BASE}/pasos/${savedStep.id}/attachments/`, {
          method: 'POST',
          body: JSON.stringify({ attachment_id: link.attachment.id, tipo: link.tipo })
        })
        if (!linkResponse.ok) {
          const error = await linkResponse.json().catch(() => null)
          throw new Error(error?.detail || `No se pudo vincular la evidencia "${link.attachment.filename_original || link.attachment.id}" al paso ${index + 1}. Backend respondió ${linkResponse.status}`)
        }
      }
    }
  }

  const handleSaveTest = async (e: FormEvent) => {
    e.preventDefault()
    if (!newTestTitle || caseEditorSaving) return

    const resetTestForm = () => {
      setNewTestTitle('')
      setNewTestDescription('')
      setNewTestPre('')
      setNewTestPost('')
      setNewTestData('')
      setNewTestTags([])
      setNewTestPriority('MEDIA')
      setNewTestCriticality('MEDIA')
      setNewTestStatus('ACTIVO')
      setNewTestSteps([])
      setCaseEditorOpen(false)
      setEditingCasoMasterId(null)
      setSelectedTest(null)
      setCaseEditorBaseline(buildCaseEditorSnapshot({
        suiteId: newTestSuiteSub || newTestSuite,
        componentId: newTestComponent,
        title: '',
        description: '',
        pre: '',
        post: '',
        data: '',
        tags: [],
        priority: 'MEDIA',
        criticality: 'MEDIA',
        status: 'ACTIVO',
        type: newTestType,
        script: newTestScript,
        framework: composeFrameworkLanguage(newTestFramework, newTestLanguage),
        steps: []
      }))
      setAddTestSuccess(true)
      setTimeout(() => setAddTestSuccess(false), 3000)
    }

    if (projectsSource === 'backend' && isValidUUID(currentProjectId)) {
      const selectedSuiteTarget = newTestSuiteSub || newTestSuite
      const targetSuiteId = isValidUUID(selectedSuiteTarget) ? selectedSuiteTarget : null
      const targetComponentId = isValidUUID(newTestComponent) ? newTestComponent : (isValidUUID(currentCompId) ? currentCompId : null)
      if (!targetComponentId) {
        setProjectSyncMessage('Primero crea o selecciona un componente del proyecto para agregar casos.')
        return
      }
      setCurrentCompId(targetComponentId)
      if (targetSuiteId) {
        selectSuiteTarget(targetSuiteId)
      }
      const pasosValidos = newTestSteps
        .filter(step => step.action.trim() || step.expected.trim() || step.data.trim())
        .map((step, index) => ({
          numero_paso: index + 1,
          accion: step.action.trim() || 'Pendiente de definir',
          datos: step.data.trim() || null,
          resultado_esperado: step.expected.trim() || 'Pendiente de definir',
          metadata_ai: {
            actionImg: step.actionImg || null,
            expectedImg: step.expectedImg || null
          }
        }))
      try {
        setCaseEditorSaving(true)
        const previousVersion = selectedTest?.version || 0
        const casoPayload = {
          titulo: newTestTitle,
          descripcion: newTestDescription || '',
          precondiciones: newTestPre || '',
          postcondiciones: newTestPost || '',
          prioridad: newTestPriority,
          criticidad: newTestCriticality,
          tipo_prueba: editorTestTypeToBackend(newTestType),
          estado_caso: newTestStatus,
          suite_id: targetSuiteId,
          componente_id: targetComponentId,
          dataset: parseDatasetInput(newTestData),
          etiquetas: normalizeCaseTags(newTestTags),
          script_automatizado: newTestType === 'Automatizada' ? newTestScript : null,
          framework: newTestType === 'Automatizada' ? composeFrameworkLanguage(newTestFramework, newTestLanguage) : null,
          pasos: pasosValidos
        }
        const saved = editingCasoMasterId
          ? await handleUpdateCaso(editingCasoMasterId, { ...casoPayload, proyecto_id: currentProjectId })
          : await handleCreateCaso(casoPayload)
        if (saved) {
          await linkSavedStepAttachments(saved)
          setCaseEditorBaseline(currentCaseEditorSnapshot)
          if (targetSuiteId) {
            selectSuiteTarget(targetSuiteId)
          }
          setCurrentCompId(targetComponentId)
          if (!editingCasoMasterId) {
            resetTestForm()
          } else {
            setAddTestSuccess(true)
            setTimeout(() => setAddTestSuccess(false), 3000)
          }
          showFeedback(
            saved.version && previousVersion && saved.version > previousVersion ? 'Nueva versión creada' : 'Guardado',
            saved.version && previousVersion && saved.version > previousVersion ? 'El caso tenía ejecuciones finales.' : 'Cambios guardados.',
            'success'
          )
        }
        return
      } catch (error: any) {
        setProjectSyncMessage(`Error al guardar caso: ${error.message}`)
        showFeedback('Error al guardar caso', error.message || 'No se pudo guardar el caso de prueba.', 'danger')
        return
      } finally {
        setCaseEditorSaving(false)
      }
    }

    const componentName = componentsList.find(c => c.id === newTestComponent)?.name || newTestComponent
    const newId = `t${casosList.length + 1}`
    const newCase = {
      id: newId,
      projectId: currentProjectId,
      code: `TC-${String(casosList.length + 1).padStart(3, '0')}`,
      suiteId: newTestSuite,
      subSuiteId: newTestSuiteSub,
      title: newTestTitle,
      status: 'none',
      type: newTestType,
      component: componentName,
      componentId: newTestComponent,
      pre: newTestPre || 'N/A',
      post: newTestPost || 'N/A',
      data: newTestData || 'N/A',
      tags: normalizeCaseTags(newTestTags),
      description: newTestDescription,
      priority: newTestPriority,
      criticality: newTestCriticality,
      caseStatus: newTestStatus,
      history: []
    }

    setCasosList([...casosList, newCase])
    resetTestForm()
  }

  return {
    addStepInput,
    removeStepInput,
    duplicateStepInput,
    moveStepInput,
    handleStepInputChange,
    updateStepAttachments,
    openCreateCaseInSuite,
    openEditCase,
    handleSaveTest
  }
}
