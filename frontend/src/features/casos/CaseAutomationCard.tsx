import { Badge, Button, Card, Form } from "react-bootstrap";
import { ChevronDown, ChevronRight, Code, PlayCircle, RefreshCw, Terminal } from "lucide-react";
import { ScriptEditor } from "../../ScriptEditor";
import { API_BASE } from "../../app/constants";

type Props = { context: any };

export function CaseAutomationCard({ context }: Props) {
  const {
    t, newTestType, canEditScripts, collapsedSections, setCollapsedSections,
    newTestFramework, setNewTestFramework, newTestLanguage, setNewTestLanguage,
    languageOptionsByFramework, defaultLanguageForFramework, languageLabel, newTestScript,
    setNewTestScript, currentProjectId, newTestSuite, confirmAction, workerSupportsSelectedLanguage,
    selectedLanguageLabel, setShowFunctionsModal, setShowVariablesModal, projectEnvironments,
    selectedDryRunEnvironment, setDryRunEnvironmentId, setDryRunDatasetId, dryRunDatasets,
    selectedDryRunDataset, dryRunDebugMode, setDryRunDebugMode, scriptTestResult, scriptTesting,
    setScriptTesting, setScriptTestResult, fetchWithAuth, newTestTitle, newTestData, newTestComponent,
    newTestSteps, setScriptValidationDetails, onRunSavedAutomatedCase, uuidOrNull,
  } = context;
  return (
    <>
    {newTestType === 'Automatizada' && canEditScripts && (
      <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
        <div
          className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center"
          onClick={() => setCollapsedSections(prev => ({ ...prev, script: !prev.script }))}
          style={{ cursor: 'pointer' }}
        >
          <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
            <Code size={18} className="text-success"/> 3. {t('casos.automationScript')}
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
                {t('casos.availableFunctions')}
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                className="fw-bold shadow-none"
                onClick={() => setShowVariablesModal(true)}
              >
                {t('casos.configuredVariables')}
              </Button>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Form.Select
                size="sm"
                value={selectedDryRunEnvironment?.id || ''}
                onChange={event => {
                  setDryRunEnvironmentId(event.target.value)
                  setDryRunDatasetId('')
                }}
                aria-label="Ambiente para dry-run"
                title="Ambiente y URL que usara la prueba"
                className="w-auto"
              >
                <option value="">Sin ambiente</option>
                {projectEnvironments.map((environment: any) => (
                  <option key={environment.id} value={environment.id}>{environment.name || environment.nombre}</option>
                ))}
              </Form.Select>
              <Form.Select
                size="sm"
                value={selectedDryRunDataset?.id || ''}
                onChange={event => setDryRunDatasetId(event.target.value)}
                aria-label="Dataset para dry-run"
                title="Dataset que usara la prueba"
                className="w-auto"
                disabled={!selectedDryRunEnvironment || !dryRunDatasets.length}
              >
                <option value="">Sin dataset</option>
                {dryRunDatasets.map((dataset: any) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.nombre || dataset.name}</option>
                ))}
              </Form.Select>
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
                        entorno_id: uuidOrNull(selectedDryRunEnvironment?.id),
                        dataset_id: uuidOrNull(selectedDryRunDataset?.id),
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
                  onRunSavedAutomatedCase?.({
                    script_automatizado: newTestScript,
                    framework: newTestFramework || 'playwright',
                    lenguaje: newTestLanguage || defaultLanguageForFramework(newTestFramework || 'playwright'),
                    proyecto_id: uuidOrNull(currentProjectId) || currentProjectId,
                    componente_id: uuidOrNull(newTestComponent),
                    titulo: newTestTitle || 'Prueba temporal del editor',
                    codigo: 'DRY-RUN',
                    datos_caso: newTestData || '',
                    entorno_id: uuidOrNull(selectedDryRunEnvironment?.id),
                    dataset_id: uuidOrNull(selectedDryRunDataset?.id),
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
    </>
  );
}
