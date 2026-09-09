import { Badge, Button, Card, Form } from "react-bootstrap";
import { ChevronDown, ChevronRight, Code, PlayCircle, RefreshCw, Terminal } from "lucide-react";
import { ScriptEditor } from "../../ScriptEditor";
import { API_BASE } from "../../app/constants";
import { VariableReferenceHints } from "./VariableReferenceHints";

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
    newTestSteps, setScriptValidationDetails, onRunSavedAutomatedCase, uuidOrNull, componentsList,
  } = context;
  return (
    <>
    {newTestType === 'Automatizada' && canEditScripts && (
      <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
        <div
          className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center"
          style={{ cursor: 'pointer' }}
        >
          <h6
            className="fw-bold text-dark m-0 d-flex align-items-center gap-2"
            role="button"
            tabIndex={0}
            aria-expanded={!collapsedSections.script}
            aria-controls={!collapsedSections.script ? 'case-automation-script-body' : undefined}
            onClick={() => setCollapsedSections(prev => ({ ...prev, script: !prev.script }))}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCollapsedSections(prev => ({ ...prev, script: !prev.script })) } }}
          >
            <Code size={18} className="text-success"/> 3. {t('casos.automationScript')}
          </h6>
          <div className="d-flex align-items-center gap-2">
            {!collapsedSections.script && (
              <Form.Select name="a11y-caseautomationcardtsx-34" aria-label={t('casos.framework')}
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
              <Form.Select name="a11y-caseautomationcardtsx-55" aria-label={t('casos.language')}
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
        <Card.Body id="case-automation-script-body" className="p-4 bg-light">
          {!newTestScript.trim() && (
            <div className="border border-warning bg-warning bg-opacity-10 text-dark rounded-3 p-3 mb-3 small">
              <strong>{t('automatizacion.scriptRequired')}</strong>
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
          <VariableReferenceHints
            value={newTestScript}
            caseData={newTestData}
            environments={projectEnvironments}
            selectedEnvironment={selectedDryRunEnvironment}
            selectedDataset={selectedDryRunDataset}
            component={componentsList?.find((item: any) => String(item.id) === String(newTestComponent))}
            triggerLabel={t('casos.variableDetected')}
            t={t}
          />
          {!workerSupportsSelectedLanguage && (
            <div className="border border-warning bg-warning bg-opacity-10 text-dark rounded-3 p-2 mt-3 small">
              {t('automatizacion.noCompatibleWorker', { framework: newTestFramework, language: selectedLanguageLabel })}
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
                aria-label={t('automatizacion.dryRunEnvironment')}
                title={t('automatizacion.dryRunEnvironmentTitle')}
                className="w-auto"
              >
                <option value="">{t('automatizacion.noEnvironment')}</option>
                {projectEnvironments.map((environment: any) => (
                  <option key={environment.id} value={environment.id}>{environment.name || environment.nombre}</option>
                ))}
              </Form.Select>
              <Form.Select
                size="sm"
                value={selectedDryRunDataset?.id || ''}
                onChange={event => setDryRunDatasetId(event.target.value)}
                aria-label={t('automatizacion.dryRunDataset')}
                title={t('automatizacion.dryRunDatasetTitle')}
                className="w-auto"
                disabled={!selectedDryRunEnvironment || !dryRunDatasets.length}
              >
                <option value="">{t('automatizacion.noDataset')}</option>
                {dryRunDatasets.map((dataset: any) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.nombre || dataset.name}</option>
                ))}
              </Form.Select>
              <Form.Check name="a11y-caseautomationcardtsx-142" aria-label={t('automatizacion.showBrowser')}
                type="switch"
                id="dry-run-debug-mode"
                checked={dryRunDebugMode}
                onChange={event => setDryRunDebugMode(event.target.checked)}
                label={t('automatizacion.showBrowser')}
                className="small text-muted"
                title={t('automatizacion.showBrowserTitle')}
              />
              {scriptTestResult && (
                <Badge bg={scriptTestResult === 'success' ? 'success' : 'danger'} className="x-small">
                  {scriptTestResult === 'success' ? t('automatizacion.scriptValid') : t('automatizacion.scriptError')}
                </Badge>
              )}
              <Button
                variant={scriptTestResult === 'success' ? 'success' : scriptTestResult === 'error' ? 'danger' : 'warning'}
                size="sm"
                className="fw-bold shadow-none"
                disabled={scriptTesting || !newTestScript.trim()}
                title={t('automatizacion.validateScriptTitle')}
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
                        message: result?.message || (isValid ? t('automatizacion.scriptAndCaseValid') : t('automatizacion.validationFailed')),
                        error: isValid ? undefined : (result?.detail || result?.error || t('automatizacion.validationFailed')),
                      warnings,
                      checks
                    })
                  } catch (error: any) {
                    setScriptTestResult('error')
                    setScriptValidationDetails({
                      valid: false,
                      hasWarnings: false,
                      message: t('automatizacion.validationConnectionError'),
                      error: error?.message || t('automatizacion.validationConnectionError'),
                      warnings: [],
                      checks: []
                    })
                  } finally {
                    setScriptTesting(false)
                    setTimeout(() => setScriptTestResult(null), 5000)
                  }
                }}
              >
                {scriptTesting ? <><RefreshCw size={14} className="me-1 animate-pulse" /> {t('automatizacion.validating')}</> : <><PlayCircle size={14} className="me-1" /> {t('automatizacion.validateScript')}</>}
              </Button>
              <Button
                variant="outline-success"
                size="sm"
                className="fw-bold shadow-none"
                disabled={!newTestScript.trim() || !workerSupportsSelectedLanguage}
                title={t('automatizacion.dryRunTitle')}
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
                <Terminal size={14} className="me-1" /> {t('automatizacion.dryRun')}
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
