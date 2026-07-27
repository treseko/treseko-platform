import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Form, Modal, ProgressBar, Spinner } from "react-bootstrap";
import { Sparkles } from "lucide-react";
import { API_BASE } from "../../app/constants";
import { flattenSuites } from "../../testRepositoryUtils";

type Props = {
  story: any;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onApplied: (count: number) => void;
};

const readJson = async (response: Response) => {
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(value?.detail || "No se pudo completar la operación.");
  }
  return value;
};

export function CaseGenerationWizard({ story, fetchWithAuth, onClose, onApplied }: Props) {
  const [run, setRun] = useState<any>(null);
  const [instructions, setInstructions] = useState("");
  const [suites, setSuites] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [suiteId, setSuiteId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [failReasons, setFailReasons] = useState<Record<string, string>>({});
  const [duplicateReasons, setDuplicateReasons] = useState<Record<string, string>>({});
  const [duplicateDetail, setDuplicateDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");

  const step =
    !run
      ? 1
      : ["ESPERANDO_ACLARACIONES", "BLOQUEADA"].includes(run.estado)
        ? 2
        : run.estado === "LISTA_PARA_GENERAR"
          ? 3
          : run.estado === "LISTA_PARA_REVISION"
            ? 4
            : 5;

  const request = async (url: string, body: any) =>
    readJson(await fetchWithAuth(`${API_BASE}${url}`, { method: "POST", body: JSON.stringify(body) }));

  const structured =
    story.criterios_estructuracion_estado === "STRUCTURED" &&
    Number(story.criterios_estructurados_count || 0) > 0;

  const plannedScenarios = Array.isArray(run?.estimacion?.scenarios) ? run.estimacion.scenarios : [];

  const suiteTree = suites;
  const flattenedSuites = useMemo(() => flattenSuites(suiteTree), [suiteTree]);
  const suiteById = useMemo(() => {
    const map: Record<string, any> = {};
    for (const item of flattenedSuites) {
      map[item.id] = item;
    }
    return map;
  }, [flattenedSuites]);

  const selectedSuite = suiteById[suiteId];
  const selectedComponent = useMemo(
    () => components.find((item) => item.id === componentId),
    [components, componentId],
  );

  const availableSuites = useMemo(
    () => flattenedSuites.filter((item) => !componentId || !item.componente_id || item.componente_id === componentId),
    [flattenedSuites, componentId],
  );

  const suitePathById = useMemo(() => {
    const result: Record<string, string> = {};
    for (const suite of flattenedSuites) {
      const parts: string[] = [];
      const seen = new Set<string>();
      let current: any = suite;
      while (current && current.id && !seen.has(current.id)) {
        seen.add(current.id);
        parts.unshift(current.nombre || "Suite");
        const parentId = current.parent_id;
        current = parentId ? suiteById[parentId] : null;
      }
      result[suite.id] = parts.join(" / ");
    }
    return result;
  }, [flattenedSuites, suiteById]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchWithAuth(`${API_BASE}/proyectos/${story.proyecto_id}/suites/`).then(readJson),
      fetchWithAuth(`${API_BASE}/proyectos/${story.proyecto_id}/componentes/`).then(readJson),
    ])
      .then(([nextSuites, nextComponents]) => {
        if (cancelled) return;
        const loadedSuites = Array.isArray(nextSuites) ? nextSuites : [];
        const loadedComponents = Array.isArray(nextComponents) ? nextComponents : [];

        setSuites(loadedSuites);
        setComponents(loadedComponents);

        const flat = flattenSuites(loadedSuites);
        const suiteMap: Record<string, any> = {};
        for (const item of flat) {
          suiteMap[item.id] = item;
        }

        if (componentId && !loadedComponents.some((item) => item.id === componentId)) {
          setComponentId("");
        }

        const currentSuite = suiteId && suiteMap[suiteId] ? suiteMap[suiteId] : null;
        if (suiteId && !currentSuite) {
          setSuiteId("");
          return;
        }
        if (currentSuite && currentSuite.componente_id && componentId && currentSuite.componente_id !== componentId) {
          setSuiteId("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("No se pudieron cargar las ubicaciones disponibles para los casos.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, story.proyecto_id]);

  const setSelectedComponent = (nextComponentId: string) => {
    setComponentId(nextComponentId);
    if (suiteId && suiteById[suiteId] && suiteById[suiteId].componente_id && suiteById[suiteId].componente_id !== nextComponentId) {
      setSuiteId("");
    }
  };

  const setSelectedSuite = (nextSuiteId: string) => {
    setSuiteId(nextSuiteId);
    const suite = nextSuiteId ? suiteById[nextSuiteId] : null;
    if (suite?.componente_id) {
      setComponentId(String(suite.componente_id));
    }
  };

  const getSuiteError = () => {
    if (!suiteId) return null;
    if (!suiteById[suiteId]) return "La suite seleccionada ya no existe. Seleccioná una nueva.";
    const destinationSuite = suiteById[suiteId];
    if (!componentId) return "Seleccioná un componente antes de analizar.";
    if (destinationSuite.componente_id && destinationSuite.componente_id !== componentId) {
      return "La suite seleccionada pertenece a otro componente. Ajustá destino y continuá.";
    }
    return null;
  };

  const estimate = async () => {
    const suiteError = getSuiteError();
    if (suiteError) {
      setError(suiteError);
      return;
    }
    if (!componentId) {
      setError("Seleccioná una suite y un componente destino antes de analizar.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const next = await request(`/historias/${story.id}/generaciones-casos/estimar`, {
        instrucciones: instructions,
        focus_categories: [],
        suite_id: suiteId,
        componente_id: componentId,
      });
      setRun(next);
      setSelectedScenarioIds((next.estimacion?.scenarios || []).map((item: any) => item.local_id).filter(Boolean));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      setRun(await request(`/generaciones-casos/${run.id}/supuestos`, {
        assumption_ids: (run.analysis?.proposed_assumptions || []).map((item: any) => item.id),
        question_answers: Object.entries(answers)
          .filter(([, value]) => value.trim())
          .map(([question, answer]) => ({ question, answer })),
        continuation_mode: "MANUAL",
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      setRun(await request(`/generaciones-casos/${run.id}/generar`, {
        max_casos: selectedScenarioIds.length,
        scenario_ids: selectedScenarioIds,
        question_answers: [],
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const duplicateSignals = (item: any) =>
    Array.isArray(item.duplicate_candidates) ? item.duplicate_candidates : [];

  const requiresDuplicateDecision = (item: any) =>
    duplicateSignals(item).some((signal: any) => signal.severity === "HIGH");

  const duplicateReviewOpen = Boolean(duplicateDetail)

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const cases = (run.propuestas || []).filter((item: any) => item.selected).map((item: any) => ({
        ...item,
        ...(item.quality?.testability === "FAIL" ? { quality_override_accepted: true, quality_override_reason: failReasons[item.local_id] || "" } : {}),
        ...(requiresDuplicateDecision(item)
          ? { duplicate_override_accepted: true, duplicate_override_reason: duplicateReasons[item.local_id] || "" }
          : {}),
      }));
      const result = await request(`/generaciones-casos/${run.id}/aplicar`, {
        casos: cases,
        excluded_criteria_reasons: {},
      });
      onApplied(result.casos?.length || 0);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (index: number) =>
    setRun({
      ...run,
      propuestas: run.propuestas.map((item: any, current: number) =>
        current === index
          ? { ...item, selected: !item.selected }
          : item,
      ),
    });

  const toggleScenario = (id: string) =>
    setSelectedScenarioIds((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );

  useEffect(() => {
    if (!busy) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const busyMessage = !run
    ? "Analizando la historia y sus criterios estructurados."
    : step === 2
      ? "Actualizando el análisis con las decisiones proporcionadas."
      : step === 3
        ? "Redactando los casos seleccionados del plan de cobertura."
        : "Creando los casos aprobados y sus vínculos de trazabilidad.";

  return (
    <Modal show={!duplicateReviewOpen} onHide={onClose} size="xl" scrollable centered>
      <Modal.Header closeButton className="border-0 pb-2">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          Generar casos con IA
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex gap-2 small mb-3" aria-label={`Paso ${step} de 5`}>
          {["Contexto", "Análisis", "Cobertura", "Casos", "Aplicar"].map((label, i) => (
            <span
              key={label}
              className={`border rounded px-2 py-1 ${i + 1 === step
                ? "bg-primary text-white border-primary"
                : i + 1 < step
                  ? "bg-light text-muted"
                  : "text-muted"}`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {busy && (
          <div className="border rounded bg-light px-3 py-2 mb-3" aria-live="polite">
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" variant="primary" size="sm" role="status">
                <span className="visually-hidden">Procesando</span>
              </Spinner>
              <div className="flex-grow-1">
                <span className="fw-semibold">La IA está trabajando</span>
                <span className="text-muted small ms-2">{busyMessage}</span>
              </div>
              <span className="small text-muted">{elapsedSeconds}s</span>
            </div>
            <ProgressBar now={100} striped animated className="mt-2" visuallyHidden />
          </div>
        )}

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        {!run && (
          <>
            <p className="text-muted">{story.codigo} — {story.titulo}. Se crearán sólo propuestas manuales para revisión; la IA no crea casos por sí sola.</p>
            <div className="border rounded p-3 mb-3 bg-light">
              <div className="d-flex justify-content-between gap-2">
                <strong>Criterios de aceptación</strong>
                <Badge bg={structured ? "success" : "warning"} text={structured ? undefined : "dark"}>
                  {structured ? "Estructurados" : "Pendientes de estructurar"}
                </Badge>
              </div>
              <p className="mb-0 mt-2 small">
                {structured
                  ? `${story.criterios_estructurados_count} criterios estructurados disponibles para trazabilidad.`
                  : "La historia tiene texto descriptivo, pero todavía no contiene criterios Given/When/Then con resultado observable. Editá la historia y estructuralos antes de pedir propuestas a la IA."}
              </p>
            </div>
            {!structured && (
              <Alert variant="warning" className="small">
                No se puede analizar esta historia todavía: los casos deben vincularse a criterios estructurados, no sólo a una descripción libre.
              </Alert>
            )}

            <div className="border rounded p-3 mb-3">
              <div className="fw-semibold mb-1">Destino obligatorio de los casos</div>
              <p className="small text-muted mb-3">
                Definí el componente y la suite antes de analizar. La ubicación queda registrada y no se modifica al editar el caso.
              </p>
              <div className="row g-3">
                <div className="col-md-6">
                  <Form.Label>Componente <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    value={componentId}
                    onChange={(event) => setSelectedComponent(event.target.value)}
                    required>
                    <option value="">Seleccionar componente…</option>
                    {components.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                  </Form.Select>
                </div>
                <div className="col-md-6">
                  <Form.Label>Suite <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    value={suiteId}
                    onChange={(event) => setSelectedSuite(event.target.value)}
                    required>
                    <option value="">Seleccionar suite…</option>
                    {availableSuites.map((item) => (
                      <option key={item.id} value={item.id}>
                        {suitePathById[item.id] || item.nombre}
                      </option>
                    ))}
                  </Form.Select>
                </div>
              </div>
              <div className="small text-muted mt-2">
                Destino: <strong>{selectedSuite ? (suitePathById[selectedSuite.id] || selectedSuite.nombre) : "Pendiente"}</strong>
                {selectedComponent ? ` · ${selectedComponent.nombre}` : " · componente pendiente"}.
              </div>
            </div>

            <Form.Group>
              <Form.Label>Foco o exclusiones <span className="text-muted">(opcional)</span></Form.Label>
              <Form.Control
                as="textarea"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                maxLength={4000}
                placeholder="Por ejemplo: priorizar inicio de sesión y excluir integraciones externas."
              />
            </Form.Group>
          </>
        )}

        {run && step === 2 && (
          <>
            <h6>Análisis y decisiones</h6>
            <p>{run.analysis?.readiness === "BLOCKED" ? "El alcance está bloqueado." : "Respondé las preguntas y confirmá los supuestos para continuar."}</p>
            {(run.analysis?.questions || []).map((question: string) => (
              <Form.Group key={question} className="mb-2">
                <Form.Label>{question}</Form.Label>
                <Form.Control
                  value={answers[question] || ""}
                  onChange={(event) => setAnswers({ ...answers, [question]: event.target.value })}
                />
              </Form.Group>
            ))}
            {(run.analysis?.proposed_assumptions || []).map((item: any) => (
              <div key={item.id} className="small border rounded p-2 mb-2">
                <Badge bg="warning" text="dark">{item.risk}</Badge> {item.text}
              </div>
            ))}
          </>
        )}

        {run && step === 3 && (
          <>
            <h6>Plan de cobertura sugerido</h6>
            <p className="text-muted">Elegí los títulos que querés desarrollar. Podés expandir cada uno para ver su objetivo y trazabilidad antes de redactar los pasos.</p>
            {plannedScenarios.length
              ? plannedScenarios.map((item: any) => (
                <details key={item.local_id} className="border rounded p-2 mb-2">
                  <summary className="d-flex align-items-center gap-2">
                    <Form.Check
                      aria-label={`Seleccionar ${item.title}`}
                      checked={selectedScenarioIds.includes(item.local_id)}
                      onChange={() => toggleScenario(item.local_id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <strong>{item.title}</strong>
                    <Badge bg="secondary">{item.category}</Badge>
                  </summary>
                  <div className="small mt-2 ms-4">
                    {item.objective || "Sin objetivo adicional."}
                    <br />
                    Criterios vinculados: {(item.criterion_refs || []).join(", ") || "Pendiente de validar"}
                  </div>
                </details>
              ))
              : <Alert variant="warning">La IA no pudo proponer un plan de cobertura verificable. Volvé al análisis y ajustá el contexto.</Alert>}
          </>
        )}

        {run && step === 4 && (
          <>
            <h6>Previsualización de casos manuales</h6>
            <p className="text-muted small">Revisá el contenido completo antes de crear los casos. Podés excluir una propuesta desmarcándola.</p>
            {(run.propuestas || []).map((item: any, index: number) => (
              <details open className="border rounded mb-3 bg-white" key={item.local_id}>
                <summary className="p-3 d-flex align-items-center gap-2">
                  <Form.Check
                    aria-label={`Incluir ${item.title}`}
                    checked={Boolean(item.selected)}
                    onChange={() => toggle(index)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <strong className="flex-grow-1">{item.title}</strong>
                  <Badge bg="secondary">{item.category}</Badge>
                  <Badge bg="light" text="dark" className="border">Prioridad {item.priority}</Badge>
                  <Badge bg="light" text="dark" className="border">{item.criticality}</Badge>
                  <Badge bg={item.quality?.testability === "FAIL" ? "danger" : item.quality?.testability === "PASS" ? "success" : "warning"}>
                    {item.quality?.testability || "WARN"}
                  </Badge>
                  {duplicateSignals(item).length ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={duplicateSignals(item).some((signal: any) => signal.severity === "EXACT") ? "danger" : "warning"}
                      className="py-0"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDuplicateDetail(item);
                      }}
                    >
                      {duplicateSignals(item).some((signal: any) => signal.severity === "EXACT") ? "DUPLICADO" : "POSIBLE DUPLICADO"}
                    </Button>
                  ) : null}
                </summary>
                <div className="border-top p-3 small">
                  <div className="mb-3">
                    <div className="text-uppercase text-muted fw-semibold small">Objetivo</div>
                    <div>{item.objective || "Sin objetivo especificado."}</div>
                  </div>
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <div className="text-uppercase text-muted fw-semibold small mb-1">Precondiciones</div>
                      {item.preconditions?.length
                        ? <ul className="mb-0 ps-3">{item.preconditions.map((value: string, itemIndex: number) => <li key={itemIndex}>{value}</li>)}</ul>
                        : <span className="text-muted">No requiere precondiciones adicionales.</span>}
                    </div>
                    <div className="col-md-6">
                      <div className="text-uppercase text-muted fw-semibold small mb-1">Datos de prueba</div>
                      {item.test_data?.length
                        ? <ul className="mb-0 ps-3">{item.test_data.map((data: any, itemIndex: number) => <li key={itemIndex}><strong>{data.key}:</strong> {data.value}</li>)}</ul>
                        : <span className="text-muted">Sin datos específicos.</span>}
                    </div>
                  </div>
                  <div className="text-uppercase text-muted fw-semibold small mb-1">Pasos y resultados esperados</div>
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered mb-3">
                      <thead className="table-light">
                        <tr>
                          <th style={{ width: "56px" }}>#</th>
                          <th>Acción</th>
                          <th>Datos</th>
                          <th>Resultado esperado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.steps?.map((caseStep: any) => (
                          <tr key={caseStep.number}>
                            <td>{caseStep.number}</td>
                            <td>{caseStep.action}</td>
                            <td>{caseStep.data || "—"}</td>
                            <td>{caseStep.expected_result}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-uppercase text-muted fw-semibold small mb-1">Trazabilidad</div>
                  <div>{item.criterion_refs?.length || 0} criterio(s) de aceptación vinculado(s).</div>
                  {item.selected && requiresDuplicateDecision(item) ? (
                    <Form.Group className="mt-3">
                      <Form.Label className="small">Justificación auditada para conservar este caso similar</Form.Label>
                      <Form.Control
                        required
                        value={duplicateReasons[item.local_id] || ""}
                        onChange={(event) => setDuplicateReasons({ ...duplicateReasons, [item.local_id]: event.target.value })}
                      />
                    </Form.Group>
                  ) : null}
                  {item.quality?.warnings?.length ? (
                    <Alert variant={item.quality?.testability === "FAIL" ? "danger" : "warning"} className="small mt-3 mb-0">
                      {item.quality.warnings.join(" · ")}
                    </Alert>
                  ) : null}
                  {item.selected && item.quality?.testability === "FAIL" ? (
                    <Form.Group className="mt-3">
                      <Form.Label className="small">Justificación auditada para aceptar la advertencia crítica</Form.Label>
                      <Form.Control
                        required
                        value={failReasons[item.local_id] || ""}
                        onChange={(event) => setFailReasons({ ...failReasons, [item.local_id]: event.target.value })}
                      />
                    </Form.Group>
                  ) : null}
                </div>
              </details>
            ))}
          </>
        )}

        {run && step === 5 && (
          <p>La operación ya fue aplicada. Los casos quedan versionables y trazables como casos normales.</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        {!run && (
          <Button onClick={estimate} disabled={busy || !structured || !suiteId || !componentId}>
            {busy ? "Analizando…" : "Analizar y sugerir plan"}
          </Button>
        )}
        {run && step === 2 && (
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Guardando…" : "Confirmar decisiones"}
          </Button>
        )}
        {run && step === 3 && (
          <Button onClick={generate} disabled={busy || !selectedScenarioIds.length}>
            {busy ? "Redactando…" : `Redactar ${selectedScenarioIds.length} casos seleccionados`}
          </Button>
        )}
        {run && step === 4 && (
          <Button
            onClick={apply}
            disabled={busy
              || !(run.propuestas || []).some((item: any) => item.selected)
              || (run.propuestas || []).some((item: any) => item.selected && duplicateSignals(item).some((signal: any) => signal.severity === "EXACT"))
              || (run.propuestas || []).some((item: any) => item.selected && item.quality?.testability === "FAIL" && !String(failReasons[item.local_id] || "").trim())
              || (run.propuestas || []).some((item: any) => item.selected && requiresDuplicateDecision(item) && !String(duplicateReasons[item.local_id] || "").trim())}
          >
            {busy ? "Aplicando…" : `Crear ${(run.propuestas || []).filter((item: any) => item.selected).length} casos`}
          </Button>
        )}
      </Modal.Footer>
      <Modal show={Boolean(duplicateDetail)} onHide={() => setDuplicateDetail(null)} centered>
        <Modal.Header closeButton><Modal.Title>Revisión de posible duplicado</Modal.Title></Modal.Header>
        <Modal.Body>
          {duplicateDetail && (
            <>
              <p className="mb-3"><strong>Propuesta:</strong> {duplicateDetail.title}</p>
              {duplicateSignals(duplicateDetail).map((signal: any) => (
                <div key={signal.master_id} className={`border rounded p-3 mb-2 ${signal.severity === "EXACT" ? "border-danger bg-danger-subtle" : signal.severity === "HIGH" ? "border-warning bg-warning-subtle" : "border-info bg-info-subtle"}`}>
                  <div className="d-flex justify-content-between gap-2">
                    <strong>{signal.code} · {signal.title}</strong>
                    <Badge bg={signal.severity === "EXACT" ? "danger" : signal.severity === "HIGH" ? "warning" : "info"}>
                      {Math.round(signal.score * 100)}%
                    </Badge>
                  </div>
                  <div className="small mt-2">Coincidencias: {signal.reasons.join("; ")}</div>
                  <div className="small mt-2 fw-semibold">
                    {signal.severity === "EXACT"
                      ? "Este caso debe excluirse de la creación."
                      : signal.severity === "HIGH"
                        ? "Podés conservarlo sólo con una justificación auditada."
                        : "Revisalo antes de decidir si ambos escenarios aportan cobertura distinta."}
                  </div>
                </div>
              ))}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDuplicateDetail(null)}>Entendido</Button>
        </Modal.Footer>
      </Modal>
    </Modal>
  );
}
