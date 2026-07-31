import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Col, Dropdown, Form, Modal, Row } from 'react-bootstrap'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Cpu,
  FileText,
  Filter,
  FolderPlus,
  Folders,
  Info,
  LayoutList,
  ListChecks,
  PlayCircle,
  Plus,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Tag,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { EvidenceUpload } from '../../EvidenceUpload'
import { ScriptEditor } from '../../ScriptEditor'
import { flattenSuites } from '../../testRepositoryUtils'
import { API_BASE } from '../../app/constants'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'
import { WorkspaceContextEmptyState } from '../../shared/components/WorkspaceContextEmptyState'
import { AutomationFunctionsModal } from './AutomationFunctionsModal'
import { AutomationVariablesModal } from './AutomationVariablesModal'
import { CaseTraceabilitySection } from './CaseTraceabilitySection'
import { useI18n } from '../../i18n'
import { CaseSuiteExplorer } from './CaseSuiteExplorer'
import { CaseMetadataCard } from './CaseMetadataCard'
import { CaseStepsCard } from './CaseStepsCard'
import { CaseAutomationCard } from './CaseAutomationCard'
import { CaseIaDryRunCard } from './CaseIaDryRunCard'
import { CaseManagementModals } from './CaseManagementModals'
import { ScriptValidationModal } from './ScriptValidationModal'
import type { ScriptValidationDetails } from './ScriptValidationModal'
import { suiteBreadcrumb, uuidOrNull } from './caseAuthoringUtils'
import { defaultLanguageForFramework, languageLabel, languageOptionsByFramework, normalizeAutomationLanguage, normalizeCaseTags } from './caseUtils'

type AnadirPruebasPageProps = any

export function AnadirPruebasPage(props: AnadirPruebasPageProps) {
  const {
    suiteExplorerWidth,
    setSelectedSubSuiteId,
    setTestSearchQuery,
    setCaseEditorOpen,
    setEditingCasoMasterId,
    setSelectedTest,
    testSearchQuery,
    openCreateSuiteModal,
    authoringInitialLoading,
    visibleSuiteTree,
    authoringRefreshing,
    renderAuthoringSuiteTree,
    startSuiteExplorerResize,
    loadCasosFromBackend,
    handleCloneCaso,
    handleMoveCaso,
    handleCloneSuite,
    setExpandedSuites,
    authoringCases,
    caseArchiveView = 'active',
    setCaseArchiveView,
    caseArchiveCounts = { active: 0, archived: 0, all: 0 },
    caseEditorOpen,
    editingCasoMasterId,
    handleSaveTest,
    collapsedSections,
    setCollapsedSections,
    newTestSuiteSub,
    newTestSuite,
    selectSuiteTarget,
    suitesTree,
    getSuiteDepth,
    newTestTitle,
    setNewTestTitle,
    newTestComponent,
    setNewTestComponent,
    componentsList,
    currentProjectId,
    newTestDescription,
    setNewTestDescription,
    newTestPriority,
    setNewTestPriority,
    newTestCriticality,
    setNewTestCriticality,
    newTestStatus,
    setNewTestStatus,
    newTestType,
    setNewTestType,
    newTestPre,
    setNewTestPre,
    newTestPost,
    setNewTestPost,
    newTestData,
    setNewTestData,
    newTestTags,
    setNewTestTags,
    showFeedback,
    confirmAction,
    newTestSteps,
    addStepInput,
    handleStepInputChange,
    attachmentConfig,
    updateStepAttachments,
    removeStepInput,
    duplicateStepInput,
    moveStepInput,
    newTestFramework,
    setNewTestFramework,
    newTestLanguage,
    setNewTestLanguage,
    newTestScript,
    setNewTestScript,
    scriptTestResult,
    setScriptTesting,
    setScriptTestResult,
    fetchWithAuth,
    scriptTesting,
    onRunSavedAutomatedCase,
    onRunAiDryRunFromEditor,
    aiDryRunRunning,
    canSaveCaseEditor,
    caseEditorSaving,
    hasUnsavedCaseChanges,
    environments,
    setEnvironments,
    setComponentsList,
    pendingTraceabilityStoryIds,
    setPendingTraceabilityStoryIds,
    canAccessCapability
  } = props
  const { t } = useI18n()
  const editingCaseCode = editingCasoMasterId
    ? authoringCases.find((item: any) => String(item.masterId || item.master_id || '') === String(editingCasoMasterId))?.code
    : ''
  const canUseCapability = canAccessCapability || (() => true)
  const canEditSuites = canUseCapability('crear_pruebas.suites', 'edit')
  const canEditCases = canUseCapability('crear_pruebas.casos', 'edit')
  const canEditTraceability = canUseCapability('crear_pruebas.trazabilidad', 'edit')
  const canEditSteps = canUseCapability('crear_pruebas.pasos', 'edit')
  const canEditAttachments = canUseCapability('crear_pruebas.adjuntos', 'edit')
  const canEditScripts = canUseCapability('crear_pruebas.scripts', 'edit')
  const canUseIaDryRun = canUseCapability('ejecutar.ia', 'edit')
  const [showFunctionsModal, setShowFunctionsModal] = useState(false)
  const [showVariablesModal, setShowVariablesModal] = useState(false)
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [cloneSourceCase, setCloneSourceCase] = useState<any | null>(null)
  const [cloneTargetSuiteId, setCloneTargetSuiteId] = useState('')
  const [moveSourceCase, setMoveSourceCase] = useState<any | null>(null)
  const [moveTargetSuiteId, setMoveTargetSuiteId] = useState('')
  const [cloneSourceSuite, setCloneSourceSuite] = useState<any | null>(null)
  const [cloneSuiteName, setCloneSuiteName] = useState('')
  const [cloneSuiteParentId, setCloneSuiteParentId] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [scriptValidationDetails, setScriptValidationDetails] = useState<ScriptValidationDetails | null>(null)
  const [automationRunners, setAutomationRunners] = useState<any[]>([])
  const [dryRunDebugMode, setDryRunDebugMode] = useState(false)
  const [dryRunEnvironmentId, setDryRunEnvironmentId] = useState('')
  const [dryRunDatasetId, setDryRunDatasetId] = useState('')
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(true)

  const projectEnvironments = (environments || []).filter((environment: any) => {
    const environmentProjectId = environment?.projectId || environment?.proyecto_id || environment?.project_id
    return !environmentProjectId || String(environmentProjectId) === String(currentProjectId)
  })
  const fallbackDryRunEnvironment = projectEnvironments.find((environment: any) => String(environment?.name || environment?.nombre || '').toLowerCase() === 'qa') || projectEnvironments[0]
  const selectedDryRunEnvironment = projectEnvironments.find((environment: any) => String(environment?.id) === String(dryRunEnvironmentId)) || fallbackDryRunEnvironment
  const dryRunDatasets = selectedDryRunEnvironment?.datasets || []
  const fallbackDryRunDataset = dryRunDatasets.find((dataset: any) => dataset?.es_default || dataset?.isDefault) || dryRunDatasets[0]
  const selectedDryRunDataset = dryRunDatasets.find((dataset: any) => String(dataset?.id) === String(dryRunDatasetId)) || fallbackDryRunDataset

  useEffect(() => {
    let cancelled = false
    const loadAutomationRunners = async () => {
      if (!fetchWithAuth || newTestType !== 'Automatizada') return
      try {
        const response = await fetchWithAuth('/api/automation-runners/')
        if (!response.ok) return
        const data = await response.json().catch(() => [])
        if (!cancelled) setAutomationRunners(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setAutomationRunners([])
      }
    }
    loadAutomationRunners()
    const timer = window.setInterval(loadAutomationRunners, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [fetchWithAuth, newTestType])

  const workerSupportsSelectedLanguage = useMemo(() => {
    const framework = String(newTestFramework || 'playwright').toLowerCase()
    const language = normalizeAutomationLanguage(newTestLanguage || defaultLanguageForFramework(framework))
    const fallbackLanguages: Record<string, string[]> = {
      playwright: ['javascript', 'typescript'],
      cypress: ['javascript', 'typescript'],
      puppeteer: ['javascript', 'typescript'],
      selenium: ['python']
    }
    return automationRunners.some(runner => {
      if (!runner?.activo) return false
      if (!['ONLINE', 'BUSY', 'RUNNING'].includes(runner?.estado || 'ONLINE')) return false
      const capabilities = runner.capabilities || {}
      const frameworks = Array.isArray(capabilities.frameworks)
        ? capabilities.frameworks
        : capabilities.framework
          ? [capabilities.framework]
          : capabilities.supported_frameworks || []
      if (frameworks.length && !frameworks.map((item: any) => String(item).toLowerCase()).includes(framework)) return false
      const matrix = capabilities.framework_languages || capabilities.languages || capabilities.supported_languages
      const languages = matrix?.[framework] || fallbackLanguages[framework] || []
      return Array.isArray(languages) && languages.map((item: any) => normalizeAutomationLanguage(item)).includes(language)
    })
  }, [automationRunners, newTestFramework, newTestLanguage])

  const selectedLanguageLabel = languageLabel(newTestLanguage || defaultLanguageForFramework(newTestFramework || 'playwright'))
  const currentSuiteId = newTestSuiteSub || newTestSuite
  const currentSuiteBreadcrumb = suiteBreadcrumb(suitesTree, currentSuiteId)
  const canSaveCurrentCase = canSaveCaseEditor && canEditCases
  const cloneDestinationSuites = useMemo(() => {
    if (!cloneSourceCase) return []
    return flattenSuites(suitesTree).filter((suite: any) => {
      const suiteComponentId = suite.componente_id || suite.componentId || ''
      if (!cloneSourceCase.componentId) return !suiteComponentId
      return suiteComponentId === cloneSourceCase.componentId
    })
  }, [cloneSourceCase, suitesTree])
  const cloneTargetSuiteValid = cloneDestinationSuites.some((suite: any) => suite.id === cloneTargetSuiteId)
  const moveCaseDestinationSuites = useMemo(() => {
    if (!moveSourceCase) return []
    return flattenSuites(suitesTree).filter((suite: any) => {
      const suiteComponentId = suite.componente_id || suite.componentId || ''
      if (!moveSourceCase.componentId) return !suiteComponentId
      return suiteComponentId === moveSourceCase.componentId
    })
  }, [moveSourceCase, suitesTree])
  const moveTargetSuiteValid = moveCaseDestinationSuites.some((suite: any) => suite.id === moveTargetSuiteId && suite.id !== moveSourceCase?.suiteId)
  const cloneSuiteIds = useMemo(() => {
    if (!cloneSourceSuite) return new Set<string>()
    const descendants = flattenSuites(cloneSourceSuite.children || []).map((suite: any) => suite.id)
    return new Set<string>([cloneSourceSuite.id, ...descendants])
  }, [cloneSourceSuite])
  const cloneSuiteDestinationSuites = useMemo(() => {
    if (!cloneSourceSuite) return []
    const sourceComponentId = cloneSourceSuite.componente_id || cloneSourceSuite.componentId || ''
    return flattenSuites(suitesTree).filter((suite: any) => {
      const suiteComponentId = suite.componente_id || suite.componentId || ''
      return suiteComponentId === sourceComponentId && !cloneSuiteIds.has(suite.id)
    })
  }, [cloneSourceSuite, cloneSuiteIds, suitesTree])
  const cloneSuiteCasesCount = useMemo(() => {
    if (!cloneSourceSuite) return 0
    return (authoringCases || []).filter((test: any) => cloneSuiteIds.has(test.suiteId)).length
  }, [authoringCases, cloneSourceSuite, cloneSuiteIds])
  const commitTagDraft = () => {
    const nextTags = normalizeCaseTags([...newTestTags, ...tagDraft.split(/[,;\n]/)])
    setNewTestTags(nextTags)
    setTagDraft('')
  }
  const removeTag = (tagToRemove: string) => {
    setNewTestTags((current: string[]) => current.filter(tag => tag.toLowerCase() !== tagToRemove.toLowerCase()))
  }

  const insertFunctionUsage = (snippet: string) => {
    setNewTestScript((current: string) => {
      const base = String(current || '').trimEnd()
      return `${base}${base ? '\n' : ''}${snippet}\n`
    })
    showFeedback(t('casos.functionInserted'), t('casos.functionInsertedMessage'), 'success')
  }

  const openCloneCaseModal = (test: any) => {
    setCloneSourceCase(test)
    setCloneTargetSuiteId(test.suiteId || currentSuiteId || '')
  }

  const openMoveCaseModal = (test: any) => {
    setMoveSourceCase(test)
    setMoveTargetSuiteId('')
  }

  const confirmCloneCase = async () => {
    if (!cloneSourceCase) return
    const destinationSuiteId = cloneTargetSuiteId || cloneSourceCase.suiteId || ''
    if (!cloneDestinationSuites.some((suite: any) => suite.id === destinationSuiteId)) {
      showFeedback(t('casos.invalidDestination'), t('casos.invalidDestinationMessage'), 'warning')
      return
    }
    const cloned = await handleCloneCaso?.(cloneSourceCase.id, destinationSuiteId)
    if (cloned) {
      await loadCasosFromBackend?.(currentProjectId, componentsList)
      if (destinationSuiteId) {
        setExpandedSuites?.((current: Record<string, boolean>) => ({ ...current, [destinationSuiteId]: true }))
        selectSuiteTarget(destinationSuiteId)
      }
      setCloneSourceCase(null)
      setCloneTargetSuiteId('')
    }
  }

  const confirmMoveCase = async () => {
    if (!moveSourceCase || !moveTargetSuiteValid) return
    const moved = await handleMoveCaso?.(moveSourceCase.id, moveTargetSuiteId)
    if (moved) {
      await loadCasosFromBackend?.(currentProjectId, componentsList)
      setExpandedSuites?.((current: Record<string, boolean>) => ({ ...current, [moveTargetSuiteId]: true }))
      selectSuiteTarget(moveTargetSuiteId)
      setMoveSourceCase(null)
      setMoveTargetSuiteId('')
    }
  }

  const openCloneSuiteModal = (suite: any) => {
    setCloneSourceSuite(suite)
    setCloneSuiteName(`Copia de ${suite.nombre}`)
    setCloneSuiteParentId(suite.parent_id || suite.parentId || '')
  }

  const confirmCloneSuite = async () => {
    if (!cloneSourceSuite) return
    const cloneResult = await handleCloneSuite?.(cloneSourceSuite.id, {
      nuevo_nombre: cloneSuiteName.trim() || `Copia de ${cloneSourceSuite.nombre}`,
      parent_id: cloneSuiteParentId || null,
      include_cases: true
    })
    if (cloneResult) {
      setCloneSourceSuite(null)
      setCloneSuiteName('')
      setCloneSuiteParentId('')
    }
  }

  const editorContext = {
    ...props, t, editingCaseCode, canEditSuites, canEditCases, canEditTraceability,
    canEditSteps, canEditAttachments, canEditScripts, canUseIaDryRun, projectEnvironments,
    fallbackDryRunEnvironment, selectedDryRunEnvironment, dryRunDatasets, fallbackDryRunDataset,
    selectedDryRunDataset, workerSupportsSelectedLanguage, selectedLanguageLabel, currentSuiteId,
    currentSuiteBreadcrumb, canSaveCurrentCase, cloneDestinationSuites, cloneTargetSuiteValid,
    moveCaseDestinationSuites, moveTargetSuiteValid, cloneSuiteIds, cloneSuiteDestinationSuites,
    cloneSuiteCasesCount, cloneSuiteName, setCloneSuiteName, cloneSuiteParentId, setCloneSuiteParentId,
    commitTagDraft, removeTag, insertFunctionUsage, openCloneCaseModal,
    openMoveCaseModal, confirmCloneCase, confirmMoveCase, openCloneSuiteModal, confirmCloneSuite,
    uuidOrNull,
  }

  if (!currentProjectId) {
    return (
      <WorkspaceContextEmptyState
        message={t('casos.workspaceSelectSolutionProject')}
        detail={t('casos.workspaceCasesProjectDetail')}
      />
    )
  }

  return (
    <div className="authoring-page mobile-stack d-flex h-100 overflow-hidden animate__animated animate__fadeIn text-dark">

          {/* PANEL IZQUIERDO: Árbol Lateral Explorador */}
          <CaseSuiteExplorer context={editorContext} />

          {/* PANEL DERECHO: Formulario de Creación (Limpio e Informativo) */}
          <div className="authoring-content flex-grow-1 overflow-auto p-4 bg-light">
                      <Button
                        variant="outline-primary"
              size="sm"
              className="mobile-only w-100 mb-3 align-items-center justify-content-center gap-2 fw-bold"
              onClick={() => setMobileExplorerOpen(current => !current)}
            >
              <Folders size={16} /> {mobileExplorerOpen ? 'Ocultar explorador' : 'Abrir explorador de suites'}
            </Button>
            {!caseEditorOpen ? (
              <div className="h-100 d-flex align-items-center justify-content-center text-center">
                <div className="bg-white border border-light-subtle rounded-3 shadow-sm p-5" style={{ maxWidth: '560px' }}>
                  <FileText size={42} className="text-primary mb-3" />
                  <h5 className="fw-bold text-dark mb-2">{t('casos.selectAction')}</h5>
                  <p className="text-muted small mb-0">
                    En movil, usa el boton de arriba para ver suites y casos. Toca una prueba para editarla o el menu de una carpeta para crear una nueva.
                  </p>
                </div>
              </div>
            ) : (
              <>
            <div className="d-flex justify-content-between align-items-start gap-3 mb-4 flex-wrap">
              <div className="min-w-0">
              <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
                <PlusCircle size={26} /> {editingCasoMasterId ? t('casos.editTestCase') : t('casos.writeTestCase')}
              </h4>
              <div className="mt-2 d-flex align-items-center gap-2 flex-wrap small text-muted">
                <span className="d-inline-flex align-items-center gap-1 text-dark fw-semibold text-break">
                  <Folders size={15} className="text-primary" /> {t('casos.folder')} {currentSuiteBreadcrumb}
                </span>
                {canEditCases && (
                  <Button type="button" variant="outline-primary" size="sm" className="rounded-pill fw-bold py-0 px-3" onClick={() => setShowLocationModal(true)}>
                    {t('casos.change')}
                  </Button>
                )}
              </div>
              </div>
            </div>

            <Form onSubmit={handleSaveTest}>
              <CaseMetadataCard context={editorContext} />

              <CaseTraceabilitySection
                projectId={currentProjectId}
                masterId={editingCasoMasterId}
                fetchWithAuth={fetchWithAuth}
                storyIds={pendingTraceabilityStoryIds}
                setStoryIds={setPendingTraceabilityStoryIds}
                editable={canEditCases}
                canConfirmRevision={canEditTraceability}
                showFeedback={showFeedback}
              />

              <CaseStepsCard context={editorContext} />

              <CaseAutomationCard context={editorContext} />              <CaseIaDryRunCard context={editorContext} />              <div className="text-end mb-5">
                <Button
                  variant={canSaveCurrentCase ? 'primary' : 'secondary'}
                  type="submit"
                  disabled={!canSaveCurrentCase}
                  className="px-5 fw-bold shadow py-3 rounded-pill fs-6 d-inline-flex align-items-center gap-2"
                >
                  {caseEditorSaving ? <RefreshCw size={20} className="animate-pulse" /> : <Save size={20} />}
                  {caseEditorSaving
                    ? t('casos.saving')
                    : !hasUnsavedCaseChanges && editingCasoMasterId
                      ? t('casos.noChanges')
                      : editingCasoMasterId ? t('casos.saveChanges') : t('casos.finishAndSaveCase')}
                </Button>
              </div>
            </Form>
              </>
            )}
          </div>
          <CaseManagementModals context={editorContext} />          <AutomationFunctionsModal
            show={showFunctionsModal}
            onHide={() => setShowFunctionsModal(false)}
            projectId={currentProjectId}
            componentId={newTestComponent}
            framework={newTestFramework}
            componentsList={componentsList}
            fetchWithAuth={fetchWithAuth}
            showFeedback={showFeedback}
            onInsertUsage={insertFunctionUsage}
            canEdit={canEditScripts}
          />
          <AutomationVariablesModal
            show={showVariablesModal}
            onHide={() => setShowVariablesModal(false)}
            projectId={currentProjectId}
            componentId={newTestComponent}
            componentsList={componentsList}
            environments={environments || []}
            setEnvironments={setEnvironments}
            setComponentsList={setComponentsList}
            caseDataText={newTestData}
            setCaseDataText={setNewTestData}
            fetchWithAuth={fetchWithAuth}
            showFeedback={showFeedback}
            canEdit={canEditScripts}
          />
          <ScriptValidationModal
            validation={scriptValidationDetails}
            onHide={() => setScriptValidationDetails(null)}
          />
        </div>
  )
}
