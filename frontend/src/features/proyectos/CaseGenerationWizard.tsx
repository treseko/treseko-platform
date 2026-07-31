import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Form, Modal, ProgressBar, Spinner } from "react-bootstrap";
import { Sparkles } from "lucide-react";
import { API_BASE } from "../../app/constants";
import { flattenSuites } from "../../testRepositoryUtils";
import { useI18n } from '../../i18n'
import { CaseGenerationWizardView } from './CaseGenerationWizardView'

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
  const { t } = useI18n()
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
        parts.unshift(current.nombre || t('proyectos.caseGenerationSuiteLabel'));
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
          setError(t('proyectos.caseGenerationErrorLoadLocations'));
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
    if (!suiteById[suiteId]) return t('proyectos.caseGenerationErrorSuiteNotFound');
    const destinationSuite = suiteById[suiteId];
    if (!componentId) return t('proyectos.caseGenerationErrorSelectComponent');
    if (destinationSuite.componente_id && destinationSuite.componente_id !== componentId) {
      return t('proyectos.caseGenerationErrorSuiteWrongComponent');
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
      setError(t('proyectos.caseGenerationErrorSelectDestination'));
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
    ? t('proyectos.caseGenerationBusyAnalyzing')
    : step === 2
      ? t('proyectos.caseGenerationBusyUpdating')
      : step === 3
        ? t('proyectos.caseGenerationBusyDrafting')
        : t('proyectos.caseGenerationBusyCreating');

  return <CaseGenerationWizardView options={{
    t, step, busy, busyMessage, elapsedSeconds, error, run, duplicateReviewOpen,
    onClose, story, structured, components, componentId, setSelectedComponent,
    availableSuites, suiteId, setSelectedSuite, suitePathById, selectedSuite,
    selectedComponent, instructions, setInstructions, answers, setAnswers,
    plannedScenarios, selectedScenarioIds, toggleScenario, toggle, duplicateSignals,
    setDuplicateDetail, duplicateReasons, setDuplicateReasons, requiresDuplicateDecision,
    failReasons, setFailReasons, estimate, confirm, generate, apply, duplicateDetail,
  }} />
}
