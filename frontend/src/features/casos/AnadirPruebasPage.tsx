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
import { AutomationFunctionsModal } from './AutomationFunctionsModal'
import { AutomationVariablesModal } from './AutomationVariablesModal'
import { defaultLanguageForFramework, languageLabel, languageOptionsByFramework, normalizeAutomationLanguage, normalizeCaseTags } from './caseUtils'

type AnadirPruebasPageProps = any

type ScriptValidationDetails = {
  valid: boolean
  hasWarnings: boolean
  message: string
  error?: string
  warnings: string[]
  checks: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uuidOrNull(value: any) {
  const text = String(value || '')
  return UUID_RE.test(text) ? text : null
}

function formatValidationText(text: string) {
  return text
    .replace(/^Script y prueba validos$/i, 'El script y la prueba son validos.')
    .replace(/^Script valido con advertencias$/i, 'El script es valido, pero hay advertencias para revisar.')
    .replace(/^Sintaxis JavaScript valida\.$/i, 'La sintaxis JavaScript es valida.')
    .replace(/^Sintaxis Python valida\.$/i, 'La sintaxis Python es valida.')
    .replace(/^Funciones detectadas en el script:\s*/i, 'Funciones detectadas: ')
    .replace(/^Framework reconocido:\s*/i, 'Framework reconocido: ')
    .replace(/^Formato detectado: Playwright Test Runner$/i, 'Formato detectado: Playwright Test Runner.')
    .replace(/^Formato detectado: Funcion worker$/i, 'Formato detectado: funcion del worker.')
    .replace(/^Formato detectado: Spec Cypress$/i, 'Formato detectado: spec Cypress.')
    .replace(/^Formato detectado: Script Node\/Puppeteer$/i, 'Formato detectado: script Node/Puppeteer.')
    .replace(/^Formato detectado: Script Python\/Selenium$/i, 'Formato detectado: script Python/Selenium.')
}

function suiteBreadcrumb(suites: any[], suiteId: string): string {
  const walk = (nodes: any[], path: string[]): string[] | null => {
    for (const suite of nodes) {
      const nextPath = [...path, suite.nombre]
      if (suite.id === suiteId) return nextPath
      const childPath = walk(suite.children || [], nextPath)
      if (childPath) return childPath
    }
    return null
  }
  return walk(suites, [])?.join(' / ') || 'Sin carpeta seleccionada'
}

function ScriptValidationModal({
  validation,
  onHide
}: {
  validation: ScriptValidationDetails | null
  onHide: () => void
}) {
  const [showLog, setShowLog] = useState(false)
  if (!validation) return null

  const functionCheck = validation.checks.find((check) => /^Funciones detectadas en el script:/i.test(check))
  const otherChecks = validation.checks.filter((check) => check !== functionCheck)
  const variant = !validation.valid ? 'danger' : validation.hasWarnings ? 'warning' : 'success'
  const title = !validation.valid
    ? 'Script invalido'
    : validation.hasWarnings
      ? 'Script valido con advertencias'
      : 'Script valido'
  const logLines = [
    'Validacion estatica completada.',
    '',
    'No se ejecuto ningun navegador ni se envio ningun job al worker.',
    'Este detalle corresponde al chequeo de sintaxis, placeholders, contexto y funciones disponibles.',
    '',
    `Resultado: ${title}`,
    validation.error ? `Error detectado: ${validation.error}` : '',
    validation.warnings.length ? `Advertencias detectadas: ${validation.warnings.length}` : '',
    validation.checks.length ? `Chequeos correctos: ${validation.checks.length}` : '',
    functionCheck ? formatValidationText(functionCheck) : ''
  ].filter(Boolean).join('\n')

  return (
    <Modal show={Boolean(validation)} onHide={onHide} centered size="lg">
      <Modal.Header closeButton className={`border-0 ${variant === 'danger' ? 'bg-danger text-white' : variant === 'warning' ? 'bg-warning text-dark' : 'bg-success text-white'}`}>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          {variant === 'success' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />} {title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 text-dark">
        <div className="border rounded-3 p-3 mb-3 bg-light">
          <div className="text-uppercase text-muted small fw-bold mb-1">Resultado</div>
          <div className="fw-semibold">{formatValidationText(validation.error || validation.message || title)}</div>
        </div>

        {validation.warnings.length > 0 && (
          <div className="border border-warning rounded-3 p-3 mb-3 bg-warning bg-opacity-10">
            <div className="text-uppercase small fw-bold mb-2 d-flex align-items-center gap-2">
              <AlertTriangle size={16} /> Advertencias
            </div>
            <ul className="mb-0 ps-3">
              {validation.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{formatValidationText(warning)}</li>
              ))}
            </ul>
          </div>
        )}

        {functionCheck && (
          <div className="border rounded-3 p-3 mb-3">
            <div className="text-uppercase text-muted small fw-bold mb-2 d-flex align-items-center gap-2">
              <Code size={16} /> Funciones detectadas
            </div>
            <div>{formatValidationText(functionCheck)}</div>
          </div>
        )}

        {otherChecks.length > 0 && (
          <div className="border rounded-3 p-3 mb-3">
            <div className="text-uppercase text-muted small fw-bold mb-2 d-flex align-items-center gap-2">
              <ListChecks size={16} /> Chequeos realizados
            </div>
            <ul className="mb-0 ps-3">
              {otherChecks.map((check, index) => (
                <li key={`${check}-${index}`}>{formatValidationText(check)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border rounded-3 p-3 mb-3 small bg-info bg-opacity-10">
          <strong>No se ejecuto ningun navegador.</strong> Esta validacion solo revisa sintaxis, placeholders, contexto y funciones disponibles.
          Para ver resultados reales del script, usa Dry-run con worker o ejecuta la prueba automatizada desde Ejecutar Pruebas.
        </div>

        <Button
          variant="outline-secondary"
          size="sm"
          className="fw-bold d-inline-flex align-items-center gap-2"
          onClick={() => setShowLog((current) => !current)}
        >
          <Terminal size={15} /> {showLog ? 'Ocultar detalle tecnico' : 'Ver detalle tecnico'}
        </Button>
        {showLog && (
          <pre className="mt-3 mb-0 bg-dark text-light rounded-3 p-3 small overflow-auto" style={{ maxHeight: 260, whiteSpace: 'pre-wrap' }}>
            {logLines}
          </pre>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant={variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'success'} className="fw-bold rounded-pill px-4" onClick={onHide}>
          Entendido
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

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
    canSaveCaseEditor,
    caseEditorSaving,
    hasUnsavedCaseChanges,
    environments,
    setEnvironments,
    setComponentsList,
    canAccessCapability
  } = props
  const canUseCapability = canAccessCapability || (() => true)
  const canEditSuites = canUseCapability('crear_pruebas.suites', 'edit')
  const canEditCases = canUseCapability('crear_pruebas.casos', 'edit')
  const canEditSteps = canUseCapability('crear_pruebas.pasos', 'edit')
  const canEditAttachments = canUseCapability('crear_pruebas.adjuntos', 'edit')
  const canEditScripts = canUseCapability('crear_pruebas.scripts', 'edit')
  const canUseIaDryRun = canUseCapability('ejecutar.ia', 'edit')
  const canSaveCurrentCase = canSaveCaseEditor && canEditCases

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
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(true)

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
    showFeedback('Funcion insertada', 'Se agrego la llamada sugerida al final del script.', 'success')
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
      showFeedback('Destino invalido', 'Selecciona una suite del mismo componente para copiar la prueba.', 'warning')
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

  return (
    <div className="authoring-page mobile-stack d-flex h-100 overflow-hidden animate__animated animate__fadeIn text-dark">

          {/* PANEL IZQUIERDO: Árbol Lateral Explorador */}
          <div className={`authoring-sidebar border-end bg-light shadow-sm text-start d-flex flex-column z-1 position-relative ${mobileExplorerOpen ? 'is-open' : ''}`} style={{ width: `${suiteExplorerWidth}px`, minWidth: '260px', maxWidth: '560px', flexShrink: 0 }}>
            <div className="p-3 bg-white border-bottom fw-bold text-muted small d-flex flex-column gap-3 shadow-sm">
              <div className="d-flex justify-content-between align-items-center">
                <span className="text-uppercase" style={{ letterSpacing: '0.5px' }}>Explorador de Suites</span>
                <div className="d-flex align-items-center gap-2">
                  <Dropdown align="end">
                    <Dropdown.Toggle
                      variant="link"
                      size="sm"
                      className="p-0 text-decoration-none x-small fw-bold text-secondary hover-text-primary d-flex align-items-center gap-1 shadow-none border-0"
                      title="Filtrar pruebas"
                    >
                      <Filter size={13} />
                      {caseArchiveView === 'archived' ? 'Archivadas' : caseArchiveView === 'all' ? 'Todas' : 'Activas'}
                    </Dropdown.Toggle>
                    <Dropdown.Menu className="shadow-sm border-light-subtle" style={{ fontSize: '0.85rem' }}>
                      {[
                        ['active', 'Activas', caseArchiveCounts.active],
                        ['archived', 'Archivadas', caseArchiveCounts.archived],
                        ['all', 'Todas', caseArchiveCounts.all]
                      ].map(([value, label, count]: any) => (
                        <Dropdown.Item
                          key={value}
                          active={caseArchiveView === value}
                          onClick={() => setCaseArchiveView?.(value)}
                          className="d-flex align-items-center justify-content-between gap-3"
                        >
                          <span>{label}</span>
                          <span className="badge bg-light text-secondary border">{count}</span>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                  <Button variant="link" size="sm" className="p-0 text-decoration-none x-small fw-bold text-secondary hover-text-primary" onClick={() => {
                    setSelectedSubSuiteId(null); setTestSearchQuery(''); setCaseEditorOpen(false); setEditingCasoMasterId(null); setSelectedTest(null);
                  }}>Limpiar</Button>
                </div>
              </div>
              <div className="input-group input-group-sm">
                <span className="input-group-text bg-light border-end-0 text-muted"><Search size={14} /></span>
                <Form.Control type="text" placeholder="Buscar carpetas, pruebas o etiquetas..." className="bg-light border-start-0 shadow-none ps-0" value={testSearchQuery} onChange={(e) => setTestSearchQuery(e.target.value)} />
              </div>
              {canEditSuites && (
                <Button variant="primary" size="sm" className="w-100 fw-bold d-flex justify-content-center align-items-center gap-2 shadow-sm rounded-pill" onClick={() => openCreateSuiteModal()}>
                  <FolderPlus size={16} /> Nueva Suite Raíz
                </Button>
              )}
            </div>

            <div className="p-3 overflow-auto flex-grow-1 pb-5">
              {authoringInitialLoading ? (
                <div className="text-center text-muted p-4 small"><div className="spinner-border spinner-border-sm text-primary mb-2"></div><br/>Cargando estructura...</div>
              ) : visibleSuiteTree.length === 0 ? (
                <div className="text-center text-muted p-4 small border rounded-3 border-dashed bg-white">
                  <Folders size={24} className="mb-2 opacity-50"/>
                  <p className="mb-2">El repositorio está vacío.</p>
                  {canEditSuites && <Button size="sm" variant="outline-primary" className="rounded-pill px-3" onClick={() => openCreateSuiteModal()}>Crear primera Suite</Button>}
                </div>
              ) : (
                <>
                  {authoringRefreshing && (
                    <div className="d-flex align-items-center gap-2 text-primary x-small fw-bold mb-2">
                      <RefreshCw size={12} className="animate-pulse" />
                      Actualizando...
                    </div>
                  )}
                  {renderAuthoringSuiteTree(
                    visibleSuiteTree,
                    canEditCases ? openCloneCaseModal : undefined,
                    canEditSuites ? openCloneSuiteModal : undefined,
                    canEditCases ? openMoveCaseModal : undefined,
                  )}
                </>
              )}
            </div>
            <div
              onMouseDown={startSuiteExplorerResize}
              title="Arrastrar para cambiar ancho"
              style={{ position: 'absolute', top: 0, right: -4, width: 8, height: '100%', cursor: 'col-resize', zIndex: 5 }}
            />
          </div>

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
                  <h5 className="fw-bold text-dark mb-2">Selecciona una acción del árbol</h5>
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
                <PlusCircle size={26} /> {editingCasoMasterId ? 'Editar Caso de Prueba' : 'Redactar Caso de Prueba'}
              </h4>
              <div className="mt-2 d-flex align-items-center gap-2 flex-wrap small text-muted">
                <span className="d-inline-flex align-items-center gap-1 text-dark fw-semibold text-break">
                  <Folders size={15} className="text-primary" /> Carpeta: {currentSuiteBreadcrumb}
                </span>
                {canEditCases && (
                  <Button type="button" variant="outline-primary" size="sm" className="rounded-pill fw-bold py-0 px-3" onClick={() => setShowLocationModal(true)}>
                    Cambiar
                  </Button>
                )}
              </div>
              </div>
            </div>

            <Form onSubmit={handleSaveTest}>
              {false && (
              <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
                <div 
                  className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center"
                  onClick={() => setCollapsedSections(prev => ({ ...prev, location: !prev.location }))}
                  style={{ cursor: 'pointer' }}
                >
                  <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                    <Folders size={18} className="text-primary"/> 1. Ubicación en el Repositorio
                  </h6>
                  {collapsedSections.location ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </div>
                {!collapsedSections.location && (
                <Card.Body className="p-3">
                  <Row className="g-2">
                    <Col md={12}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted">CARPETA DESTINO</Form.Label>
                        <Form.Select
                          value={newTestSuiteSub || newTestSuite}
                          onChange={(e) => selectSuiteTarget(e.target.value)}
                          className="bg-light border-light-subtle shadow-none text-dark fw-bold"
                          required
                        >
                          <option value="">-- Seleccionar carpeta --</option>
                          {flattenSuites(suitesTree).map(s => (
                            <option key={s.id} value={s.id}>
                              {'- '.repeat(getSuiteDepth(s.id))}{s.nombre}
                            </option>
                          ))}
                        </Form.Select>
                        <div className="x-small text-muted mt-2">
                          Puedes seleccionar cualquier nivel del árbol. El caso se guarda en esa carpeta exacta.
                        </div>
                      </Form.Group>
                    </Col>
                  </Row>
                </Card.Body>
                )}
              </Card>
              )}

              <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
                <div
                  className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center cursor-pointer"
                  onClick={() => setCollapsedSections(prev => ({ ...prev, metadata: !prev.metadata }))}
                  style={{ cursor: 'pointer' }}
                >
                  <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                    <FileText size={18} className="text-primary"/> 1. Definición del Caso
                  </h6>
                  {collapsedSections.metadata ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                </div>
                {!collapsedSections.metadata && (
                <Card.Body className="p-3">
                  <Row className="g-2">
                    <Col md={8}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>TITULO PRINCIPAL</RequiredLabel></Form.Label>
                        <Form.Control type="text" placeholder="Ej. Validar descarga de reporte PDF en perfil de usuario" value={newTestTitle} onChange={(e) => setNewTestTitle(e.target.value)} required className="bg-light border-light-subtle shadow-none fw-bold text-primary fs-6" />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted d-flex align-items-center gap-1">
                          <Tag size={13} /> ETIQUETAS
                        </Form.Label>
                        <div className="bg-light border border-light-subtle rounded-2 p-2 d-flex flex-wrap align-items-center gap-2">
                          {newTestTags.map((tag: string) => (
                            <Badge key={tag} bg="primary" className="d-inline-flex align-items-center gap-1 rounded-pill px-2 py-1">
                              {tag}
                              <button type="button" className="btn btn-link btn-sm p-0 text-white lh-1" onClick={() => removeTag(tag)} title={`Quitar ${tag}`}>
                                <X size={12} />
                              </button>
                            </Badge>
                          ))}
                          <Form.Control
                            value={tagDraft}
                            onChange={(event) => setTagDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ',') {
                                event.preventDefault()
                                commitTagDraft()
                              }
                            }}
                            onBlur={commitTagDraft}
                            placeholder={newTestTags.length ? 'Agregar otra...' : 'Ej. smoke, login, regresion'}
                            className="border-0 bg-transparent shadow-none p-0 flex-grow-1 small"
                            style={{ minWidth: 120 }}
                          />
                        </div>
                      </Form.Group>
                    </Col>
                    <Col md={12}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted">DESCRIPCIÓN / OBJETIVO</Form.Label>
                        <Form.Control as="textarea" rows={1} placeholder="Objetivo del caso o alcance funcional..." value={newTestDescription} onChange={(e) => setNewTestDescription(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark" />
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>PRIORIDAD</RequiredLabel></Form.Label>
                        <Form.Select required value={newTestPriority} onChange={(e) => setNewTestPriority(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                          <option value="ALTA">Alta</option>
                          <option value="MEDIA">Media</option>
                          <option value="BAJA">Baja</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted">CRITICIDAD</Form.Label>
                        <Form.Select value={newTestCriticality} onChange={(e) => setNewTestCriticality(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                          <option value="CRITICA">Crítica</option>
                          <option value="ALTA">Alta</option>
                          <option value="MEDIA">Media</option>
                          <option value="BAJA">Baja</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted">ESTADO</Form.Label>
                        <Form.Select value={newTestStatus} onChange={(e) => setNewTestStatus(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                          <option value="ACTIVO">Draft / Activo</option>
                          <option value="EN_REVISION">Review</option>
                          <option value="DEPRECADO">Deprecado</option>
                          {newTestStatus === 'ARCHIVADO' && <option value="ARCHIVADO">Archivado</option>}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>MÉTODO EJECUCIÓN</RequiredLabel></Form.Label>
                        <Form.Select required value={newTestType} onChange={(e) => setNewTestType(e.target.value)} className="bg-primary bg-opacity-10 border-primary text-primary fw-bold shadow-none">
                          <option value="AI Agent">AI Agent (No-Code)</option>
                          <option value="Automatizada">Automatizada (Playwright/Selenium/Cypress/Puppeteer)</option>
                          <option value="Manual">Manual Step-by-Step</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted">PRECONDICIONES</Form.Label>
                        <Form.Control type="text" placeholder="Ej. El usuario debe estar logueado previamente" value={newTestPre} onChange={(e) => setNewTestPre(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark" />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label className="fw-bold x-small text-muted">POSTCONDICIONES</Form.Label>
                        <Form.Control type="text" placeholder="Ej. Orden generada, usuario bloqueado..." value={newTestPost} onChange={(e) => setNewTestPost(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark" />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <div className="d-flex justify-content-between align-items-center">
                          <Form.Label className="fw-bold x-small text-muted mb-1">DATOS ESPECIFICOS DEL CASO</Form.Label>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="p-0 text-primary shadow-none"
                            title="Ver formatos de dataset"
                            onClick={() => showFeedback('Datos especificos del caso', 'Estos valores personalizan el caso. El ambiente y dataset se eligen al ejecutar; aqui puedes definir valores con key=value, JSON o placeholders como usuario={{DATASET.usuario}}.', 'info')}
                          >
                            <Info size={14} />
                          </Button>
                        </div>
                        <Form.Control type="text" placeholder="Ej. usuario={{DATASET.usuario}} / perfil=admin" value={newTestData} onChange={(e) => setNewTestData(e.target.value)} className="bg-light border-light-subtle shadow-none font-monospace text-dark x-small" />
                      </Form.Group>
                    </Col>
                  </Row>
                </Card.Body>
                )}
              </Card>

              <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
                <div
                  className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center"
                  onClick={() => setCollapsedSections(prev => ({ ...prev, steps: !prev.steps }))}
                  style={{ cursor: 'pointer' }}
                >
                  <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                    <LayoutList size={18} className="text-primary"/> 2. Secuencia de Pasos
                  </h6>
                  <div className="d-flex align-items-center gap-2">
                    {!collapsedSections.steps && canEditSteps && (
                      <Button variant="outline-primary" size="sm" onClick={(e) => { e.stopPropagation(); addStepInput() }} className="fw-bold rounded-pill px-3 shadow-none bg-white">
                        <Plus size={14} className="me-1" /> Agregar Paso
                      </Button>
                    )}
                    {collapsedSections.steps ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                  </div>
                </div>
                {!collapsedSections.steps && (
                <Card.Body className="p-4 bg-light">
                  {/* Header de Columnas */}
                  <div className="case-step-grid-header mb-2 px-2 text-muted fw-bold text-uppercase">
                    <div>#</div>
                    <div>Acción / Directiva NLP <span className="text-danger">*</span></div>
                    <div>Datos (Input Data)</div>
                    <div>Resultado Esperado <span className="text-danger">*</span></div>
                    <div></div>
                  </div>

                  {newTestSteps.length === 0 && (
                    <div className="text-center py-4 text-muted bg-white rounded-3 border border-light-subtle">
                      <LayoutList size={22} className="mb-2 opacity-50" />
                      <div className="small fw-bold">Sin pasos definidos todavía</div>
                      <div className="x-small">Puedes guardar el caso ahora y completar los pasos más adelante.</div>
                    </div>
                  )}

                  {newTestSteps.map((step, idx) => (
                    <div key={idx} className="case-step-grid mb-3 animate__animated animate__fadeIn bg-white p-2 rounded-3 border border-light-subtle shadow-sm">
                      <div className="case-step-number-cell">
                        <span className="case-step-index">#{idx + 1}</span>
                      </div>
                      <div className="d-flex flex-column">
                        <Form.Control required as="textarea" rows={2} placeholder="Describí la acción a realizar..." value={step.action} onChange={(e) => handleStepInputChange(idx, 'action', e.target.value)} className="border-light-subtle shadow-none small text-dark mb-2 flex-grow-1" style={{ resize: 'none' }} disabled={!canEditSteps} />
                        <EvidenceUpload
                          compact
                          iconOnly
                          label="Imagen de acción"
                          uploadScope="CASE_STEP_REFERENCE"
                          maxFileSize={attachmentConfig.max_file_size_mb}
                          enablePaste={attachmentConfig.enable_clipboard_paste}
                          currentAttachments={step.actionAttachments || []}
                          currentEvidence={step.actionImg}
                          onUploadComplete={(attachment) => updateStepAttachments(idx, 'actionAttachments', [...(step.actionAttachments || []), attachment])}
                          onRemoveAttachment={(attachment) => updateStepAttachments(idx, 'actionAttachments', (step.actionAttachments || []).filter(item => item.id !== attachment.id))}
                          disabled={!canEditAttachments}
                        />
                      </div>
                      <div className="d-flex flex-column">
                        <Form.Control as="textarea" rows={2} placeholder="Variables a inyectar" value={step.data} onChange={(e) => handleStepInputChange(idx, 'data', e.target.value)} className="border-light-subtle shadow-none font-monospace small text-primary mb-2 flex-grow-1" style={{ resize: 'none' }} disabled={!canEditSteps} />
                      </div>
                      <div className="d-flex flex-column">
                        <Form.Control required as="textarea" rows={2} placeholder="Criterio de validación..." value={step.expected} onChange={(e) => handleStepInputChange(idx, 'expected', e.target.value)} className="border-light-subtle shadow-none small text-dark mb-2 flex-grow-1" style={{ resize: 'none' }} disabled={!canEditSteps} />
                        <EvidenceUpload
                          compact
                          iconOnly
                          label="Imagen esperada"
                          uploadScope="CASE_STEP_REFERENCE"
                          maxFileSize={attachmentConfig.max_file_size_mb}
                          enablePaste={attachmentConfig.enable_clipboard_paste}
                          currentAttachments={step.expectedAttachments || []}
                          currentEvidence={step.expectedImg}
                          onUploadComplete={(attachment) => updateStepAttachments(idx, 'expectedAttachments', [...(step.expectedAttachments || []), attachment])}
                          onRemoveAttachment={(attachment) => updateStepAttachments(idx, 'expectedAttachments', (step.expectedAttachments || []).filter(item => item.id !== attachment.id))}
                          disabled={!canEditAttachments}
                        />
                      </div>
                      <div className="case-step-actions-cell">
                        {canEditSteps && (
                          <>
                          <Button variant="light" className="case-step-action-btn text-secondary border shadow-none hover-text-primary transition-all" onClick={() => moveStepInput(idx, 'up')} disabled={idx === 0} title="Mover paso arriba" aria-label="Mover paso arriba">
                            <ArrowUp size={15} />
                          </Button>
                          <Button variant="light" className="case-step-action-btn text-secondary border shadow-none hover-text-primary transition-all" onClick={() => moveStepInput(idx, 'down')} disabled={idx === newTestSteps.length - 1} title="Mover paso abajo" aria-label="Mover paso abajo">
                            <ArrowDown size={15} />
                          </Button>
                          <Button variant="light" className="case-step-action-btn text-secondary border shadow-none hover-text-primary transition-all" onClick={() => duplicateStepInput(idx)} title="Copiar paso" aria-label="Copiar paso">
                            <Copy size={15} />
                          </Button>
                          <Button variant="light" className="case-step-action-btn text-danger border shadow-none hover-bg-danger hover-text-white transition-all" onClick={() => removeStepInput(idx)} title="Eliminar paso" aria-label="Eliminar paso">
                            <Trash2 size={16} />
                          </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </Card.Body>
                )}
              </Card>

              {newTestType === 'Automatizada' && canEditScripts && (
                <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
                  <div
                    className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center"
                    onClick={() => setCollapsedSections(prev => ({ ...prev, script: !prev.script }))}
                    style={{ cursor: 'pointer' }}
                  >
                    <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                      <Code size={18} className="text-success"/> 3. Script de Automatización
                    </h6>
                    <div className="d-flex align-items-center gap-2">
                      {!collapsedSections.script && (
                        <Form.Select
                          value={newTestFramework}
                          onChange={(e) => {
                            const nextFramework = e.target.value
                            setNewTestFramework(nextFramework)
                            if (!languageOptionsByFramework[nextFramework]?.includes(newTestLanguage)) {
                              setNewTestLanguage(defaultLanguageForFramework(nextFramework))
                            }
                          }}
                          size="sm"
                          onClick={(e) => e.stopPropagation()}
                          className="border-light-subtle shadow-none bg-white text-dark fw-bold"
                          style={{ width: '140px' }}
                        >
                          <option value="playwright">Playwright</option>
                          <option value="selenium">Selenium</option>
                          <option value="cypress">Cypress</option>
                          <option value="puppeteer">Puppeteer</option>
                        </Form.Select>
                      )}
                      {!collapsedSections.script && (
                        <Form.Select
                          value={newTestLanguage}
                          onChange={(e) => setNewTestLanguage(e.target.value)}
                          size="sm"
                          onClick={(e) => e.stopPropagation()}
                          className="border-light-subtle shadow-none bg-white text-dark fw-bold"
                          style={{ width: '130px' }}
                        >
                          {(languageOptionsByFramework[newTestFramework] || ['javascript']).map(language => (
                            <option key={language} value={language}>{languageLabel(language)}</option>
                          ))}
                        </Form.Select>
                      )}
                      {collapsedSections.script ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
                    </div>
                  </div>
                  {!collapsedSections.script && (
                  <Card.Body className="p-4 bg-light">
                    {!newTestScript.trim() && (
                      <div className="border border-warning bg-warning bg-opacity-10 text-dark rounded-3 p-3 mb-3 small">
                        <strong>Este caso requiere un script para ejecutarse con worker.</strong>
                      </div>
                    )}
                    <ScriptEditor
                      value={newTestScript}
                      onChange={setNewTestScript}
                      framework={newTestFramework}
                      language={newTestLanguage}
                      projectId={currentProjectId}
                      suiteId={newTestSuite}
                      confirmAction={confirmAction}
                    />
                    {!workerSupportsSelectedLanguage && (
                      <div className="border border-warning bg-warning bg-opacity-10 text-dark rounded-3 p-2 mt-3 small">
                        No hay worker compatible para {newTestFramework} + {selectedLanguageLabel}. Puedes guardar el caso, pero el dry-run y la ejecucion quedaran bloqueados hasta vincular un worker con esa capacidad.
                      </div>
                    )}
                    <div className="d-flex justify-content-between align-items-center mt-3">
                      <div className="d-flex gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          className="fw-bold shadow-none"
                          onClick={() => setShowFunctionsModal(true)}
                        >
                          Ver funciones disponibles
                        </Button>
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          className="fw-bold shadow-none"
                          onClick={() => setShowVariablesModal(true)}
                        >
                          Ver variables configuradas
                        </Button>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <Form.Check
                          type="switch"
                          id="dry-run-debug-mode"
                          checked={dryRunDebugMode}
                          onChange={event => setDryRunDebugMode(event.target.checked)}
                          label="Ver navegador"
                          className="small text-muted"
                          title="Abre el navegador visible en la maquina donde corre el worker compatible"
                        />
                        {scriptTestResult && (
                          <Badge bg={scriptTestResult === 'success' ? 'success' : 'danger'} className="x-small">
                            {scriptTestResult === 'success' ? 'Script valido' : 'Error en script'}
                          </Badge>
                        )}
                        <Button
                          variant={scriptTestResult === 'success' ? 'success' : scriptTestResult === 'error' ? 'danger' : 'warning'}
                          size="sm"
                          className="fw-bold shadow-none"
                          disabled={scriptTesting || !newTestScript.trim()}
                          title="Valida sintaxis, placeholders y contexto; no ejecuta navegador ni envia jobs al worker"
                          onClick={async () => {
                            setScriptTesting(true)
                            setScriptTestResult(null)
                            try {
                              const defaultEnvironment = environments?.find?.((environment: any) => uuidOrNull(environment?.id)) || null
                              const defaultDataset = defaultEnvironment?.datasets?.find?.((dataset: any) => (dataset.es_default || dataset.isDefault) && uuidOrNull(dataset?.id))
                                || defaultEnvironment?.datasets?.find?.((dataset: any) => uuidOrNull(dataset?.id))
                                || null
                              const response = await fetchWithAuth(`${API_BASE}/scripts/validate/`, {
                                method: 'POST',
                                body: JSON.stringify({
                                  script: newTestScript,
                                  framework: `${newTestFramework}:${newTestLanguage}`,
                                  tipo_prueba: newTestType,
                                  titulo: newTestTitle,
                                  datos_caso: newTestData,
                                  proyecto_id: currentProjectId,
                                  component_id: newTestComponent || null,
                                  entorno_id: uuidOrNull(defaultEnvironment?.id),
                                  dataset_id: uuidOrNull(defaultDataset?.id),
                                  pasos: newTestSteps.map((step: any, idx: number) => ({
                                    numero_paso: idx + 1,
                                    accion: step.action || '',
                                    datos: step.data || '',
                                    resultado_esperado: step.expected || ''
                                  }))
                                })
                              })
                              const result = await response.json().catch(() => null)
                              const isValid = response.ok && result?.valid === true
                              const warnings = Array.isArray(result?.warnings) ? result.warnings : []
                              const checks = Array.isArray(result?.checks) ? result.checks : []
                              setScriptTestResult(isValid ? 'success' : 'error')
                              setScriptValidationDetails({
                                valid: isValid,
                                hasWarnings: warnings.length > 0,
                                message: result?.message || (isValid ? 'Script y prueba validos' : 'No se pudo validar la prueba.'),
                                error: isValid ? undefined : (result?.detail || result?.error || 'No se pudo validar la prueba.'),
                                warnings,
                                checks
                              })
                            } catch (error: any) {
                              setScriptTestResult('error')
                              setScriptValidationDetails({
                                valid: false,
                                hasWarnings: false,
                                message: 'Error de conexion al validar.',
                                error: error?.message || 'Error de conexion al validar.',
                                warnings: [],
                                checks: []
                              })
                            } finally {
                              setScriptTesting(false)
                              setTimeout(() => setScriptTestResult(null), 5000)
                            }
                          }}
                        >
                          {scriptTesting ? <><RefreshCw size={14} className="me-1 animate-pulse" /> Validando...</> : <><PlayCircle size={14} className="me-1" /> Validar sintaxis/contexto</>}
                        </Button>
                        <Button
                          variant="outline-success"
                          size="sm"
                          className="fw-bold shadow-none"
                          disabled={!newTestScript.trim() || !workerSupportsSelectedLanguage}
                          title="Ejecuta temporalmente el script actual con un worker compatible, sin guardar historial ni requerir build"
                          onClick={() => {
                            const defaultEnvironment = environments?.find?.((environment: any) => uuidOrNull(environment?.id)) || null
                            const defaultDataset = defaultEnvironment?.datasets?.find?.((dataset: any) => (dataset.es_default || dataset.isDefault) && uuidOrNull(dataset?.id))
                              || defaultEnvironment?.datasets?.find?.((dataset: any) => uuidOrNull(dataset?.id))
                              || null
                            onRunSavedAutomatedCase?.({
                              script_automatizado: newTestScript,
                              framework: newTestFramework || 'playwright',
                              lenguaje: newTestLanguage || defaultLanguageForFramework(newTestFramework || 'playwright'),
                              proyecto_id: uuidOrNull(currentProjectId) || currentProjectId,
                              componente_id: uuidOrNull(newTestComponent),
                              titulo: newTestTitle || 'Prueba temporal del editor',
                              codigo: 'DRY-RUN',
                              datos_caso: newTestData || '',
                              entorno_id: uuidOrNull(defaultEnvironment?.id),
                              dataset_id: uuidOrNull(defaultDataset?.id),
                              debug_mode: dryRunDebugMode,
                              pasos: newTestSteps.map((step: any, index: number) => ({
                                numero_paso: index + 1,
                                accion: step.action || '',
                                datos: step.data || '',
                                resultado_esperado: step.expected || ''
                              }))
                            })
                          }}
                        >
                          <Terminal size={14} className="me-1" /> Dry-run con worker
                        </Button>
                      </div>
                    </div>
                  </Card.Body>
                  )}
                </Card>
              )}

              {newTestType !== 'Automatizada' && canUseIaDryRun && (
                <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3">
                  <Card.Body className="p-3 d-flex justify-content-between align-items-center">
                    <div>
                      <div className="fw-bold text-dark d-flex align-items-center gap-2">
                        <Cpu size={18} className="text-primary" /> Testear prueba manual con IA
                      </div>
                      <div className="small text-muted">
                        Ejecuta un dry-run temporal con el Motor IA. No guarda historial, evidencias ni cambios del caso.
                      </div>
                    </div>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      className="fw-bold shadow-none"
                      disabled={!newTestTitle.trim() || newTestSteps.length === 0}
                      onClick={() => {
                        const defaultEnvironment = environments?.find?.((environment: any) => uuidOrNull(environment?.id)) || null
                        const defaultDataset = defaultEnvironment?.datasets?.find?.((dataset: any) => (dataset.es_default || dataset.isDefault) && uuidOrNull(dataset?.id))
                          || defaultEnvironment?.datasets?.find?.((dataset: any) => uuidOrNull(dataset?.id))
                          || null
                        onRunAiDryRunFromEditor?.({
                          proyecto_id: uuidOrNull(currentProjectId) || currentProjectId,
                          componente_id: uuidOrNull(newTestComponent),
                          titulo: newTestTitle || 'Prueba temporal con IA',
                          codigo: 'AI-DRY-RUN',
                          descripcion: newTestDescription || '',
                          precondiciones: newTestPre || '',
                          postcondiciones: newTestPost || '',
                          datos_caso: newTestData || '',
                          entorno_id: uuidOrNull(defaultEnvironment?.id),
                          dataset_id: uuidOrNull(defaultDataset?.id),
                          debug_mode: true,
                          pasos: newTestSteps.map((step: any, index: number) => ({
                            numero_paso: index + 1,
                            accion: step.action || '',
                            datos: step.data || '',
                            resultado_esperado: step.expected || ''
                          }))
                        })
                      }}
                    >
                      <PlayCircle size={14} className="me-1" /> Dry-run IA
                    </Button>
                  </Card.Body>
                </Card>
              )}

              <div className="text-end mb-5">
                <Button
                  variant={canSaveCurrentCase ? 'primary' : 'secondary'}
                  type="submit"
                  disabled={!canSaveCurrentCase}
                  className="px-5 fw-bold shadow py-3 rounded-pill fs-6 d-inline-flex align-items-center gap-2"
                >
                  {caseEditorSaving ? <RefreshCw size={20} className="animate-pulse" /> : <Save size={20} />}
                  {caseEditorSaving
                    ? 'Guardando...'
                    : !hasUnsavedCaseChanges && editingCasoMasterId
                      ? 'Sin cambios'
                      : editingCasoMasterId ? 'Guardar cambios' : 'Finalizar y guardar caso'}
                </Button>
              </div>
            </Form>
              </>
            )}
          </div>
          <Modal show={showLocationModal} onHide={() => setShowLocationModal(false)} centered fullscreen="sm-down">
            <Modal.Header closeButton className="bg-light border-bottom text-dark">
              <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
                <Folders size={18} className="text-primary" /> Cambiar carpeta destino
              </Modal.Title>
            </Modal.Header>
            <Modal.Body className="text-start">
              <div className="small text-muted mb-2">Carpeta actual</div>
              <div className="fw-semibold text-dark border rounded-2 bg-light p-2 mb-3 text-break">{currentSuiteBreadcrumb}</div>
              <Form.Group>
                <Form.Label className="fw-bold x-small text-muted">NUEVA CARPETA</Form.Label>
                <Form.Select
                  value={currentSuiteId}
                  onChange={(event) => selectSuiteTarget(event.target.value)}
                  className="bg-light border-light-subtle shadow-none text-dark fw-bold"
                  required
                >
                  <option value="">-- Seleccionar carpeta --</option>
                  {flattenSuites(suitesTree).map(suite => (
                    <option key={suite.id} value={suite.id}>
                      {'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Modal.Body>
            <Modal.Footer className="border-0 pt-0">
              <Button variant="primary" className="fw-bold rounded-pill px-4" onClick={() => setShowLocationModal(false)}>
                Usar carpeta
              </Button>
            </Modal.Footer>
          </Modal>
          <Modal show={Boolean(cloneSourceCase)} onHide={() => setCloneSourceCase(null)} centered fullscreen="sm-down">
            <Modal.Header closeButton className="bg-light border-bottom text-dark">
              <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
                <FileText size={18} className="text-primary" /> Copiar como nueva prueba
              </Modal.Title>
            </Modal.Header>
            <Modal.Body className="text-start">
              <div className="border rounded-3 bg-light p-3 mb-3">
                <div className="font-monospace x-small fw-bold text-secondary">{cloneSourceCase?.code || cloneSourceCase?.id}</div>
                <div className="fw-bold text-dark">{cloneSourceCase?.title}</div>
                <div className="small text-muted mt-1">La copia sera un caso nuevo, sin historial ni asignacion automatica a builds.</div>
              </div>
              <Form.Group>
                <Form.Label className="fw-bold x-small text-muted">SUITE DESTINO</Form.Label>
                <Form.Select
                  value={cloneTargetSuiteId}
                  onChange={(event) => setCloneTargetSuiteId(event.target.value)}
                  className="bg-light border-light-subtle shadow-none text-dark fw-bold"
                >
                  {cloneDestinationSuites.map((suite: any) => (
                    <option key={suite.id} value={suite.id}>
                      {suite.id === cloneSourceCase?.suiteId ? 'Misma suite - ' : ''}{'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              {cloneDestinationSuites.length === 0 && (
                <div className="small text-danger mt-2">No hay suites disponibles en el componente de este caso.</div>
              )}
              {cloneDestinationSuites.length > 0 && !cloneTargetSuiteValid && (
                <div className="small text-danger mt-2">Selecciona una suite valida del mismo componente.</div>
              )}
            </Modal.Body>
            <Modal.Footer className="border-0 pt-0">
              <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={() => setCloneSourceCase(null)}>
                Cancelar
              </Button>
              <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!cloneTargetSuiteValid} onClick={confirmCloneCase}>
                Copiar prueba
              </Button>
            </Modal.Footer>
          </Modal>
          <Modal show={Boolean(moveSourceCase)} onHide={() => setMoveSourceCase(null)} centered fullscreen="sm-down">
            <Modal.Header closeButton className="bg-light border-bottom text-dark">
              <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
                <FileText size={18} className="text-primary" /> Mover prueba
              </Modal.Title>
            </Modal.Header>
            <Modal.Body className="text-start">
              <div className="border rounded-3 bg-light p-3 mb-3">
                <div className="font-monospace x-small fw-bold text-secondary">{moveSourceCase?.code || moveSourceCase?.id}</div>
                <div className="fw-bold text-dark">{moveSourceCase?.title}</div>
                <div className="small text-muted mt-1">La prueba se movera sin cambiar builds, ejecuciones ni historial.</div>
              </div>
              <Form.Group>
                <Form.Label className="fw-bold x-small text-muted">SUITE DESTINO</Form.Label>
                <Form.Select
                  value={moveTargetSuiteId}
                  onChange={(event) => setMoveTargetSuiteId(event.target.value)}
                  className="bg-light border-light-subtle shadow-none text-dark fw-bold"
                >
                  <option value="">-- Seleccionar suite --</option>
                  {moveCaseDestinationSuites.map((suite: any) => (
                    <option key={suite.id} value={suite.id} disabled={suite.id === moveSourceCase?.suiteId}>
                      {suite.id === moveSourceCase?.suiteId ? 'Actual - ' : ''}{'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              {moveCaseDestinationSuites.length === 0 && (
                <div className="small text-danger mt-2">No hay suites disponibles en el componente de esta prueba.</div>
              )}
            </Modal.Body>
            <Modal.Footer className="border-0 pt-0">
              <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={() => setMoveSourceCase(null)}>
                Cancelar
              </Button>
              <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!moveTargetSuiteValid} onClick={confirmMoveCase}>
                Mover prueba
              </Button>
            </Modal.Footer>
          </Modal>
          <Modal show={Boolean(cloneSourceSuite)} onHide={() => setCloneSourceSuite(null)} centered fullscreen="sm-down">
            <Modal.Header closeButton className="bg-light border-bottom text-dark">
              <Modal.Title className="fw-bold fs-6 d-flex align-items-center gap-2">
                <Folders size={18} className="text-primary" /> Copiar suite completa
              </Modal.Title>
            </Modal.Header>
            <Modal.Body className="text-start">
              <div className="border rounded-3 bg-light p-3 mb-3">
                <div className="small text-muted">Suite origen</div>
                <div className="fw-bold text-dark">{cloneSourceSuite?.nombre}</div>
                <div className="small text-muted mt-1">
                  Se copiaran {cloneSuiteIds.size} suite(s) y {cloneSuiteCasesCount} caso(s). No se copian builds, ejecuciones ni evidencias.
                </div>
              </div>
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold x-small text-muted">NOMBRE DE LA COPIA</Form.Label>
                <Form.Control
                  value={cloneSuiteName}
                  onChange={(event) => setCloneSuiteName(event.target.value)}
                  className="bg-light border-light-subtle shadow-none text-dark fw-bold"
                  placeholder="Copia de suite"
                />
              </Form.Group>
              <Form.Group>
                <Form.Label className="fw-bold x-small text-muted">SUITE PADRE DESTINO</Form.Label>
                <Form.Select
                  value={cloneSuiteParentId}
                  onChange={(event) => setCloneSuiteParentId(event.target.value)}
                  className="bg-light border-light-subtle shadow-none text-dark fw-bold"
                >
                  <option value="">Raiz del componente</option>
                  {cloneSuiteDestinationSuites.map((suite: any) => (
                    <option key={suite.id} value={suite.id}>
                      {'- '.repeat(getSuiteDepth(suite.id))}{suite.nombre}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Modal.Body>
            <Modal.Footer className="border-0 pt-0">
              <Button variant="outline-secondary" className="fw-bold rounded-pill px-4" onClick={() => setCloneSourceSuite(null)}>
                Cancelar
              </Button>
              <Button variant="primary" className="fw-bold rounded-pill px-4" disabled={!cloneSuiteName.trim()} onClick={confirmCloneSuite}>
                Copiar suite
              </Button>
            </Modal.Footer>
          </Modal>
          <AutomationFunctionsModal
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
