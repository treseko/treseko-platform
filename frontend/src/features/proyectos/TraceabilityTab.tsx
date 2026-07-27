import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Form,
  Modal,
  ProgressBar,
  Row,
  Spinner,
  OverlayTrigger,
  Tooltip,
  Table,
} from "react-bootstrap";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Eye,
  FilePlus2,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { API_BASE } from "../../app/constants";
import { formatDateTime } from "../../shared/utils/dateTime";
import { AcceptanceCriteriaEditor } from "./AcceptanceCriteriaEditor";
import { CaseGenerationWizard } from "./CaseGenerationWizard";
import { WikiMarkdownViewer } from "./WikiMarkdownViewer";

type Props = {
  projectId: string;
  components: any[];
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  canEdit: boolean;
  active: boolean;
  refreshToken: number;
  confirmAction: (options: {
    title: string;
    message: string;
    variant?: "danger" | "warning" | "info";
    confirmLabel?: string;
    cancelLabel?: string | null;
  }) => Promise<boolean>;
  onCreateCaseFromStory: (story: any, requirement: any) => void;
  onOpenLinkedCase: (masterId: string) => void;
  showFeedback: (title: string, message: string, variant?: any) => void;
};

type HistoryKind = "requisitos" | "historias";

type HistoryDiffState = {
  kind: HistoryKind;
  current: any;
  previous: any | null;
};

const EMPTY_REQUIREMENT = {
  titulo: "",
  descripcion_markdown: "",
  estado: "BORRADOR",
  prioridad: "MEDIA",
  componente_ids: [],
  external_provider: "",
  external_reference: "",
  external_url: "",
};

const proposalQuality = (proposal: any) =>
  String(proposal?.quality?.testability || "WARN").toUpperCase();

const hasSimilarStory = (proposal: any) => Array.isArray(proposal?.similar_stories) && proposal.similar_stories.length > 0;

const proposalQualityMeta = (proposal: any) => {
  const quality = proposalQuality(proposal);
  if (quality === "PASS") return { label: "Apta", variant: "success" };
  if (quality === "FAIL") return { label: "Requiere revisión", variant: "danger" };
  return { label: "Con advertencias", variant: "warning" };
};

const ReviewPendingIcon = ({ count, tooltipId }: { count: number; tooltipId: string }) => {
  const pending = count > 0 ? count : 1;
  const message = pending === 1 ? "Revisión pendiente" : `Revisiones pendientes: ${pending}`;

  return (
    <OverlayTrigger placement="top" overlay={<Tooltip id={tooltipId}>{message}</Tooltip>}>
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning-emphasis border border-warning-subtle"
        style={{ width: 16, height: 16, fontSize: 12, fontWeight: 700, lineHeight: 1 }}
        role="img"
        aria-label={message}
        title={message}
      >
        !
      </span>
    </OverlayTrigger>
  );
};
const EMPTY_STORY = {
  titulo: "",
  descripcion_markdown: "",
  criterios_aceptacion_markdown: "",
  acceptance_criteria: [],
  estado: "BORRADOR",
  prioridad: "MEDIA",
  external_provider: "",
  external_reference: "",
  external_url: "",
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.detail || `Backend respondio ${response.status}`);
  return payload;
}

export function TraceabilityTab({
  projectId,
  components,
  fetchWithAuth,
  canEdit,
  active,
  refreshToken,
  confirmAction,
  onCreateCaseFromStory,
  onOpenLinkedCase,
  showFeedback,
}: Props) {
  const [requirements, setRequirements] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [requirementForm, setRequirementForm] =
    useState<any>(EMPTY_REQUIREMENT);
  const [storyForm, setStoryForm] = useState<any>(EMPTY_STORY);
  const [editingRequirement, setEditingRequirement] = useState<any>(null);
  const [editingStory, setEditingStory] = useState<any>(null);
  const [storyRequirementId, setStoryRequirementId] = useState("");
  const [showRequirementModal, setShowRequirementModal] = useState(false);
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [caseGenerationStory, setCaseGenerationStory] = useState<any>(null);
  const [detailItem, setDetailItem] = useState<{
    kind: "requirement" | "story";
    item: any;
  } | null>(null);
  const [linkedStoryCases, setLinkedStoryCases] = useState<any[]>([]);
  const [linkedStoryCasesLoading, setLinkedStoryCasesLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<any[] | null>(null);
  const [historyKind, setHistoryKind] = useState<HistoryKind | null>(null);
  const [historyTitle, setHistoryTitle] = useState("");
  const [historyCode, setHistoryCode] = useState("");
  const [historyDiff, setHistoryDiff] = useState<HistoryDiffState | null>(null);
  const [requirementStateFilter, setRequirementStateFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [archiveVisibility, setArchiveVisibility] = useState<"active" | "archived" | "all">("active");
  const [storiesExpanded, setStoriesExpanded] = useState(false);
  const [storySearch, setStorySearch] = useState("");
  const [storyRequirementFilter, setStoryRequirementFilter] = useState("");
  const [storyStateFilter, setStoryStateFilter] = useState("");
  const [generationRequirement, setGenerationRequirement] = useState<any>(null);
  const [generationStep, setGenerationStep] = useState<
    "context" | "analysis" | "configuration" | "review"
  >("context");
  const [generationRun, setGenerationRun] = useState<any>(null);
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [generationWiki, setGenerationWiki] = useState<any[]>([]);
  const [generationWikiIds, setGenerationWikiIds] = useState<string[]>([]);
  const [generationComponentIds, setGenerationComponentIds] = useState<
    string[]
  >([]);
  const [generationMaxStories, setGenerationMaxStories] = useState(1);
  const [generationQuestionAnswers, setGenerationQuestionAnswers] = useState<
    Record<string, string>
  >({});
  const [generationCandidates, setGenerationCandidates] = useState<any[]>([]);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [generationContextExpanded, setGenerationContextExpanded] =
    useState(true);
  const [expandedCandidateIndexes, setExpandedCandidateIndexes] = useState<
    Set<number>
  >(() => new Set());
  const [estimateExplanationVisible, setEstimateExplanationVisible] =
    useState(false);
  const [autoContinuePaused, setAutoContinuePaused] = useState(false);
  const [autoContinueRemaining, setAutoContinueRemaining] = useState<number | null>(null);
  const generationHasActionableReview = useMemo(() => {
    const analysis = generationRun?.analysis || {};
    return Boolean(
      (analysis.questions || []).some((item: unknown) => String(item || "").trim()) ||
        (analysis.proposed_assumptions || []).some(
          (item: any) => String(item?.id || "").trim(),
        ),
    );
  }, [generationRun]);
  const generationHasCriticalAssumptions = useMemo(
    () => (generationRun?.analysis?.proposed_assumptions || []).some(
      (item: any) => String(item?.risk || "").toUpperCase() === "CRITICAL",
    ),
    [generationRun],
  );
  const loadedProjectId = useRef<string | null>(null);

  const projectComponents = useMemo(
    () =>
      components.filter(
        (item) =>
          String(item.projectId || item.proyecto_id) === String(projectId),
      ),
    [components, projectId],
  );
  const requirementById = useMemo(
    () => new Map(requirements.map((item) => [item.id, item])),
    [requirements],
  );
  const selectedCandidateCount = useMemo(
    () => generationCandidates.filter((item) => item.selected).length,
    [generationCandidates],
  );
  const selectedCriticalCandidatesNeedDecision = useMemo(
    () => generationCandidates.some(
      (item) => item.selected && proposalQuality(item) === "FAIL" &&
        (!item.quality_override_accepted || !String(item.quality_override_reason || "").trim()),
    ),
    [generationCandidates],
  );
  const generationProgress = generationRun?.generation_progress || {};
  const generationRequestedCount = Number(generationProgress.requested || generationMaxStories || 1);
  const generationCompletedCount = Number(generationProgress.completed || generationCandidates.length || 0);
  const preflightDuplicateCheck = generationRun?.preflight_duplicate_check || {};
  const preflightExcludedStories = Array.isArray(preflightDuplicateCheck.excluded_existing_intent)
    ? preflightDuplicateCheck.excluded_existing_intent
    : [];

  const updateGenerationCandidate = (index: number, patch: Record<string, unknown>) => {
    setGenerationCandidates((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const load = async (force = false, visibility = archiveVisibility) => {
    if (!projectId || (!force && loadedProjectId.current === projectId)) return;
    if (loadedProjectId.current !== projectId) {
      setRequirements([]);
      setStories([]);
    }
    setLoading(true);
    try {
      const archiveQuery = visibility === "active" ? "" : "?include_archived=true";
      const requirementsRequest = fetchWithAuth(
        `${API_BASE}/proyectos/${projectId}/requisitos/${archiveQuery}`,
      )
        .then(readJson)
        .then(setRequirements);
      const storiesRequest = fetchWithAuth(
        `${API_BASE}/proyectos/${projectId}/historias/${archiveQuery}`,
      )
        .then(readJson)
        .then(setStories);
      const outcomes = await Promise.allSettled([
        requirementsRequest,
        storiesRequest,
      ]);
      const failure = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      if (failure) throw failure.reason;
      loadedProjectId.current = projectId;
    } catch (error: any) {
      showFeedback(
        "Trazabilidad",
        error.message || "No se pudo cargar la trazabilidad.",
        "danger",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load(refreshToken > 0);
  }, [active, projectId, refreshToken]);

  useEffect(() => {
    if (detailItem?.kind !== "story") { setLinkedStoryCases([]); return; }
    let cancelled = false;
    setLinkedStoryCasesLoading(true);
    fetchWithAuth(`${API_BASE}/historias/${detailItem.item.id}/casos/`)
      .then(readJson)
      .then((items) => { if (!cancelled) setLinkedStoryCases(Array.isArray(items) ? items : []); })
      .catch(() => { if (!cancelled) setLinkedStoryCases([]); })
      .finally(() => { if (!cancelled) setLinkedStoryCasesLoading(false); });
    return () => { cancelled = true; };
  }, [detailItem?.item?.id, detailItem?.kind]);

  useEffect(() => {
    if (!generationBusy) {
      setGenerationElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setGenerationElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generationBusy]);

  useEffect(() => {
    if (!generationBusy || !generationRun?.id || generationStep !== "configuration") return;
    let cancelled = false;
    const refreshProgress = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE}/generaciones-historias/${generationRun.id}`);
        const run = await readJson(response);
        if (cancelled) return;
        setGenerationRun(run);
        if (Array.isArray(run.propuestas) && run.propuestas.length) {
          setGenerationCandidates((previous) => run.propuestas.map((item: any) => ({
            ...item,
            selected: previous.find((candidate) => candidate.local_id === item.local_id)?.selected
              ?? (item.quality?.testability === "PASS" && !hasSimilarStory(item)),
          })));
        }
      } catch {
        // The final generation request surfaces errors to the user. Polling is
        // best effort and must not create duplicate feedback messages.
      }
    };
    void refreshProgress();
    const timer = window.setInterval(() => void refreshProgress(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchWithAuth, generationBusy, generationRun?.id, generationStep]);

  const openRequirement = (item?: any) => {
    setEditingRequirement(item || null);
    setRequirementForm(
      item
        ? { ...item, componente_ids: item.componente_ids || [] }
        : { ...EMPTY_REQUIREMENT, componente_ids: [] },
    );
    setShowRequirementModal(true);
  };
  const saveRequirement = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const url = editingRequirement
        ? `${API_BASE}/requisitos/${editingRequirement.id}`
        : `${API_BASE}/requisitos/`;
      const result = await readJson(
        await fetchWithAuth(url, {
          method: editingRequirement ? "PATCH" : "POST",
          body: JSON.stringify(
            editingRequirement
              ? requirementForm
              : { ...requirementForm, proyecto_id: projectId },
          ),
        }),
      );
      setShowRequirementModal(false);
      setRequirements((previous) =>
        editingRequirement
          ? previous.map((item) => (item.id === result.id ? result : item))
          : [...previous, result],
      );
      showFeedback(
        "Requisito guardado",
        "Los cambios y su historial quedaron registrados.",
        "success",
      );
    } catch (error: any) {
      showFeedback("No se pudo guardar", error.message, "danger");
    }
  };
  const openStory = (item?: any, requirementId?: string) => {
    setEditingStory(item || null);
    setStoryRequirementId(item?.requisito_id || requirementId || "");
    setStoryForm(item ? { ...item } : { ...EMPTY_STORY, acceptance_criteria: [{ local_id: "AC-MANUAL-1", type: "FUNCTIONAL", title: "", given: "", when: "", then: [], observable_result: "", mandatory: true, source_refs: [], assumption_ids: [] }] });
    setShowStoryModal(true);
  };
  const saveStory = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const url = editingStory
        ? `${API_BASE}/historias/${editingStory.id}`
        : `${API_BASE}/historias/`;
      const result = await readJson(
        await fetchWithAuth(url, {
          method: editingStory ? "PATCH" : "POST",
          body: JSON.stringify(
            editingStory
              ? storyForm
              : {
                  ...storyForm,
                  proyecto_id: projectId,
                  requisito_id: storyRequirementId,
                },
          ),
        }),
      );
      setShowStoryModal(false);
      setStories((previous) =>
        editingStory
          ? previous.map((item) => (item.id === result.id ? result : item))
          : [...previous, result],
      );
      showFeedback(
        "Historia guardada",
        "La historia y sus criterios de aceptacion quedaron registrados.",
        "success",
      );
    } catch (error: any) {
      showFeedback("No se pudo guardar", error.message, "danger");
    }
  };
  const openHistory = async (item: any, kind: "requisitos" | "historias") => {
    setHistoryKind(kind);
    setHistoryDiff(null);
    try {
      setHistoryTitle(item.titulo);
      setHistoryCode(item.codigo || "");
      setHistoryEntries(
        await readJson(
          await fetchWithAuth(`${API_BASE}/${kind}/${item.id}/history/`),
        ),
      );
    } catch (error: any) {
      showFeedback("Historial", error.message, "danger");
    }
  };
  const historyDisplayActor = (entry: any) => {
    const fullName = String(entry?.editado_por_nombre || "").trim();
    const email = String(entry?.editado_por_email || "").trim();
    if (!fullName && !email) return "Usuario desconocido";
    if (fullName && email && fullName.toLowerCase() !== email.toLowerCase()) {
      return `${fullName} (${email})`;
    }
    return fullName || email;
  };
  const historyComparableFields = (kind: HistoryKind) => kind === "requisitos"
    ? [
      { key: "titulo", label: "Título" },
      { key: "descripcion_markdown", label: "Descripción" },
      { key: "estado", label: "Estado" },
      { key: "prioridad", label: "Prioridad" },
      { key: "external_provider", label: "Proveedor externo" },
      { key: "external_reference", label: "Referencia externa" },
      { key: "external_url", label: "URL externa" },
    ]
    : [
      { key: "titulo", label: "Título" },
      { key: "descripcion_markdown", label: "Descripción" },
      { key: "criterios_aceptacion_markdown", label: "Criterios de aceptación" },
      { key: "estado", label: "Estado" },
      { key: "prioridad", label: "Prioridad" },
      { key: "external_provider", label: "Proveedor externo" },
      { key: "external_reference", label: "Referencia externa" },
      { key: "external_url", label: "URL externa" },
    ];
  const normalizeHistoryValue = (value: any) => {
    if (value === null || value === undefined) return "";
    if (value === "") return "";
    if (typeof value === "boolean") return value ? "sí" : "no";
    return String(value).trim();
  };
  const openHistoryDiff = (index: number) => {
    if (!historyEntries || !historyKind) return;
    const current = historyEntries[index];
    if (!current) return;
    setHistoryDiff({
      kind: historyKind,
      current,
      previous: historyEntries[index + 1] || null,
    });
  };
  const historyDiffRows = useMemo(() => {
    if (!historyDiff) return [];
    const fields = historyComparableFields(historyDiff.kind);
    const current = historyDiff.current || {};
    const previous = historyDiff.previous || null;
    return fields
      .map(({ key, label }) => {
        const currentValue = normalizeHistoryValue(current[key]);
        const previousValue = previous ? normalizeHistoryValue(previous[key]) : "";
        if (!previous || currentValue === previousValue) return null;
        return { key, label, currentValue, previousValue };
      })
      .filter((entry): entry is {
        key: string;
        label: string;
        currentValue: string;
        previousValue: string;
      } => entry !== null);
  }, [historyDiff]);
  const openDetails = (kind: "requirement" | "story", item: any) =>
    setDetailItem({ kind, item });
  const storiesForRequirement = (requirementId: string) =>
    stories.filter((item) => item.requisito_id === requirementId);
  const setArchived = async (
    item: any,
    kind: "requisitos" | "historias",
    archived: boolean,
  ) => {
    const resourceLabel = kind === "requisitos" ? "requisito" : "historia";
    const confirmed = await confirmAction({
      title: `${archived ? "Archivar" : "Restaurar"} ${resourceLabel}`,
      message: archived
        ? `${item.codigo} dejará de aparecer en los listados activos, pero conservará su historial y vínculos existentes.`
        : `${item.codigo} volverá a los listados activos conservando su historial y vínculos existentes.`,
      variant: archived ? "warning" : "info",
      confirmLabel: `${archived ? "Archivar" : "Restaurar"} ${resourceLabel}`,
    });
    if (!confirmed) return;
    try {
      await readJson(
        await fetchWithAuth(`${API_BASE}/${kind}/${item.id}/archive`, {
          method: "POST",
          body: JSON.stringify({ archivado: archived }),
        }),
      );
      await load(true);
    } catch (error: any) {
      showFeedback(`No se pudo ${archived ? "archivar" : "restaurar"}`, error.message, "danger");
    }
  };

  const changeStoryState = async (story: any, estado: string) => {
    if (estado === story.estado) return;
    try {
      const updated = await fetchWithAuth(`${API_BASE}/historias/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({ estado }),
      }).then(readJson);
      setStories((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      showFeedback("Estado actualizado", `${updated.codigo} ahora está ${updated.estado.replaceAll("_", " ")}.`, "success");
    } catch (error: any) {
      showFeedback("No se pudo actualizar el estado", error.message || "Intenta nuevamente.", "danger");
    }
  };
  const visibleRequirements = requirements.filter(
    (item) =>
      (archiveVisibility === "all" ||
        (archiveVisibility === "archived" ? item.archivado : !item.archivado)) &&
      (!requirementStateFilter || item.estado === requirementStateFilter) &&
      (!priorityFilter || item.prioridad === priorityFilter),
  );
  const visibleStories = stories.filter((story) => {
    const search = storySearch.trim().toLocaleLowerCase();
    const requirement = requirementById.get(story.requisito_id);
    return (
      (archiveVisibility === "all" ||
        (archiveVisibility === "archived" ? story.archivado : !story.archivado)) &&
      (!storyRequirementFilter ||
        story.requisito_id === storyRequirementFilter) &&
      (!storyStateFilter || story.estado === storyStateFilter) &&
      (!search ||
        [
          story.codigo,
          story.titulo,
          requirement?.codigo,
          requirement?.titulo,
        ].some((value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(search),
        ))
    );
  });
  const toggleRequirementComponent = (componentId: string) => {
    const selected = requirementForm.componente_ids || [];
    setRequirementForm({
      ...requirementForm,
      componente_ids: selected.includes(componentId)
        ? selected.filter((id: string) => id !== componentId)
        : [...selected, componentId],
    });
  };
  const openGeneration = async (requirement: any) => {
    setGenerationRequirement(requirement);
    setGenerationStep("context");
    setGenerationRun(null);
    setGenerationInstructions("");
    setGenerationWikiIds([]);
    setGenerationComponentIds(requirement.componente_ids || []);
    setGenerationCandidates([]);
    setGenerationMaxStories(1);
    setGenerationQuestionAnswers({});
    setGenerationContextExpanded(true);
    setExpandedCandidateIndexes(new Set());
    setEstimateExplanationVisible(false);
    setAutoContinuePaused(false);
    setAutoContinueRemaining(null);
    try {
      setGenerationWiki(
        await readJson(
          await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/wiki/`),
        ),
      );
    } catch {
      setGenerationWiki([]);
    }
  };
  const estimateGeneration = async () => {
    if (!generationRequirement) return;
    setGenerationBusy(true);
    try {
      const run = await readJson(
        await fetchWithAuth(
          `${API_BASE}/requisitos/${generationRequirement.id}/generaciones-historias/estimar`,
          {
            method: "POST",
            body: JSON.stringify({
              wiki_page_ids: generationWikiIds,
              componente_ids: generationComponentIds,
              instrucciones: generationInstructions,
            }),
          },
        ),
      );
      setGenerationRun(run);
      if (run.estado === "BLOQUEADA")
        throw new Error(run.error_detalle || "La estimación fue bloqueada.");
      setGenerationMaxStories(run.estimacion?.cantidad_recomendada || 1);
      setGenerationStep(run.estado === "ANALIZADA" ? "configuration" : "analysis");
      setGenerationContextExpanded(false);
      setEstimateExplanationVisible(true);
    } catch (error: any) {
      showFeedback(
        "Generación de historias",
        error.message || "No se pudo generar la vista previa de historias.",
        "danger",
      );
    } finally {
      setGenerationBusy(false);
    }
  };
  const generateCandidates = async () => {
    if (!generationRun) return;
    setGenerationBusy(true);
    try {
      const run = await readJson(
        await fetchWithAuth(
          `${API_BASE}/generaciones-historias/${generationRun.id}/generar`,
          {
            method: "POST",
              body: JSON.stringify({
                max_historias: generationMaxStories,
                question_answers: Object.entries(generationQuestionAnswers)
                  .filter(([, answer]) => answer.trim())
                  .map(([question, answer]) => ({ question, answer: answer.trim() })),
              }),
          },
        ),
      );
      if (run.estado === "BLOQUEADA")
        throw new Error(run.error_detalle || "La generación fue bloqueada.");
      setGenerationRun(run);
      setGenerationCandidates(
        (run.propuestas || []).map((item: any) => ({
          ...item,
          selected: item.quality?.testability === "PASS" && !hasSimilarStory(item),
        })),
      );
      setGenerationStep("review");
      setExpandedCandidateIndexes(new Set([0]));
    } catch (error: any) {
      showFeedback(
        "Generación de historias",
        error.message || "No se pudieron generar propuestas.",
        "danger",
      );
    } finally {
      setGenerationBusy(false);
    }
  };
  const recalculateGenerationScope = async (
    generationId = generationRun?.id,
    usePersistedAnswers = false,
  ) => {
    if (!generationId) return;
    setGenerationBusy(true);
    try {
      const run = await readJson(
        await fetchWithAuth(
          `${API_BASE}/generaciones-historias/${generationId}/reanalizar`,
          {
            method: "POST",
            body: JSON.stringify({
              max_historias: 1,
              question_answers: usePersistedAnswers
                ? []
                : Object.entries(generationQuestionAnswers)
                    .filter(([, answer]) => answer.trim())
                    .map(([question, answer]) => ({
                      question,
                      answer: answer.trim(),
                    })),
            }),
          },
        ),
      );
      if (run.estado === "BLOQUEADA") {
        throw new Error(run.error_detalle || "No se pudo actualizar el análisis.");
      }
      setGenerationRun(run);
      setGenerationMaxStories(run.estimacion?.cantidad_recomendada || 1);
      setGenerationStep(
        run.estado === "ANALIZADA" ? "configuration" : "analysis",
      );
    } catch (error: any) {
      showFeedback(
        "Análisis del requisito",
        error.message || "No se pudo actualizar la propuesta de alcance.",
        "danger",
      );
    } finally {
      setGenerationBusy(false);
    }
  };
  const confirmAssumptions = async (continuationMode: "MANUAL" | "AUTO_TIMEOUT" = "MANUAL") => {
    if (!generationRun) return;
    const assumptions = generationRun.analysis?.proposed_assumptions || [];
    setGenerationBusy(true);
    try {
      const run = await readJson(await fetchWithAuth(
        `${API_BASE}/generaciones-historias/${generationRun.id}/supuestos`,
        {
          method: "POST",
          body: JSON.stringify({
            assumption_ids: assumptions.map((item: any) => item.id),
            question_answers: Object.entries(generationQuestionAnswers)
              .filter(([, answer]) => answer.trim())
              .map(([question, answer]) => ({ question, answer: answer.trim() })),
            continuation_mode: continuationMode,
          }),
        },
      ));
      setGenerationRun(run);
      // Confirming assumptions is a user decision, not a request to analyze
      // again. Reanalysis here could produce a different set of questions and
      // trap the user in a loop even when QA has no additional information.
      setGenerationStep("configuration");
    } catch (error: any) {
      showFeedback("Supuestos pendientes", error.message || "No se pudieron confirmar los supuestos.", "danger");
    } finally {
      setGenerationBusy(false);
    }
  };
  const canAutoContinue = Boolean(
    generationRun &&
      generationStep === "analysis" &&
      generationRun.estado === "ESPERANDO_SUPUESTOS" &&
      generationHasActionableReview &&
      !generationHasCriticalAssumptions &&
      !generationBusy &&
      !autoContinuePaused,
  );
  useEffect(() => {
    if (!canAutoContinue) {
      setAutoContinueRemaining(null);
      return;
    }
    setAutoContinueRemaining(30);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, 30 - Math.floor((Date.now() - startedAt) / 1000));
      setAutoContinueRemaining(remaining);
      if (remaining === 0) {
        window.clearInterval(timer);
        void confirmAssumptions("AUTO_TIMEOUT");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [canAutoContinue, generationRun?.id]);
  const applyCandidates = async () => {
    const historias = generationCandidates
      .filter((item) => item.selected)
      .map((item) => item);
    if (!generationRun || !historias.length) return;
    setGenerationBusy(true);
    try {
      const result = await readJson(
        await fetchWithAuth(
          `${API_BASE}/generaciones-historias/${generationRun.id}/aplicar`,
          { method: "POST", body: JSON.stringify({ historias }) },
        ),
      );
      setStories((previous) => [...previous, ...(result.historias || [])]);
      setStoriesExpanded(true);
      setGenerationRequirement(null);
      showFeedback(
        "Historias creadas",
        `${result.historias?.length || 0} historias quedaron en borrador para revisión.`,
        "success",
      );
    } catch (error: any) {
      showFeedback(
        "No se pudieron crear las historias",
        error.message,
        "danger",
      );
    } finally {
      setGenerationBusy(false);
    }
  };

  return (
    <div className="traceability-tab animate__animated animate__fadeIn h-100 d-flex flex-column">
      <div className="responsive-page-toolbar traceability-toolbar mb-4 flex-shrink-0">
        <div>
          <h5 className="fw-bold text-dark m-0">Requisitos e Historias</h5>
          <span className="text-muted small">
            Cobertura funcional y origen de los casos de prueba.
          </span>
        </div>
        <div className="traceability-toolbar-actions">
          <Form.Select
            size="sm"
            value={archiveVisibility}
            onChange={(event) => {
              const visibility = event.target.value as "active" | "archived" | "all";
              setArchiveVisibility(visibility);
              void load(true, visibility);
            }}
            aria-label="Mostrar elementos archivados"
          >
            <option value="active">Activos</option>
            <option value="archived">Archivados</option>
            <option value="all">Todos</option>
          </Form.Select>
          <Form.Select
            size="sm"
            value={requirementStateFilter}
            onChange={(event) => setRequirementStateFilter(event.target.value)}
            aria-label="Filtrar por estado"
          >
            <option value="">Estados</option>
            {["BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO", "ARCHIVADO"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Form.Select>
          <Form.Select
            size="sm"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            aria-label="Filtrar por prioridad"
          >
            <option value="">Prioridades</option>
            {["ALTA", "MEDIA", "BAJA"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Form.Select>
          <Button
            variant="outline-secondary"
            size="sm"
            className="rounded-pill shadow-none"
            onClick={() => load(true)}
            disabled={loading}
            title="Actualizar"
            aria-label="Actualizar"
          >
            <RefreshCw size={15} />
          </Button>
          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              className="fw-bold rounded-pill px-3 shadow-sm d-flex align-items-center gap-1"
              onClick={() => openRequirement()}
            >
              <Plus size={15} /> Requisito
            </Button>
          )}
        </div>
      </div>
      <Card className="border-0 shadow-sm mb-4 traceability-table-card">
        <Table responsive hover className="align-middle mb-0">
          <thead className="bg-light">
            <tr>
              <th>Requisito</th>
              <th>Estado</th>
              <th>Componentes</th>
              <th>Historias y cobertura</th>
              <th className="text-end">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleRequirements.map((requirement) => {
              const relatedStories = storiesForRequirement(requirement.id);
              return (
                <tr key={requirement.id}>
                  <td>
                    <div className="fw-semibold">
                      {requirement.codigo} - {requirement.titulo}
                    </div>
                    {requirement.external_url && (
                      <a
                        href={requirement.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="small"
                      >
                        <ExternalLink size={12} className="me-1" />
                        {requirement.external_reference ||
                          requirement.external_provider ||
                          "Referencia externa"}
                      </a>
                    )}
                  </td>
                  <td>
                    <Badge
                      bg={
                        requirement.estado === "ACTIVO"
                          ? "success"
                          : "secondary"
                      }
                    >
                      {requirement.estado}
                    </Badge>
                  </td>
                  <td className="small">
                    {(requirement.componente_ids || [])
                      .map(
                        (id: string) =>
                          projectComponents.find((item) => item.id === id)
                            ?.name || "Componente",
                      )
                      .join(", ") || "Sin componente definido"}
                  </td>
                  <td>
                    <div className="small fw-semibold">
                      {relatedStories.length} {relatedStories.length === 1 ? "historia" : "historias"}
                    </div>
                    {relatedStories.slice(0, 2).map((story) => (
                      <div
                        key={story.id}
                        className="small mt-1 d-flex gap-1 align-items-center"
                      >
                        <Badge
                          bg={
                            story.requiere_revision_count ? "warning" : "light"
                          }
                          text={
                            story.requiere_revision_count ? "dark" : "secondary"
                          }
                        >
                          {story.codigo}
                        </Badge>
                        <span>{story.titulo}</span>
                        <span className="text-muted">
                          {story.case_count} casos
                        </span>
                        {story.requiere_revision_count > 0 && (
                          <ReviewPendingIcon count={story.requiere_revision_count} tooltipId={`requirement-story-${story.id}-pending`} />
                        )}
                      </div>
                    ))}
                    {relatedStories.length > 2 && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 small text-decoration-none"
                        onClick={() => openDetails("requirement", requirement)}
                      >
                        Ver {relatedStories.length - 2} {relatedStories.length - 2 === 1 ? "historia más" : "historias más"}
                      </Button>
                    )}
                  </td>
                  <td className="text-end">
                    <Dropdown align="end" drop="down" className="traceability-actions-menu">
                      <Dropdown.Toggle variant="light" size="sm" className="border" aria-label={`Acciones para ${requirement.codigo}`} title="Acciones">
                        <MoreHorizontal size={15} />
                      </Dropdown.Toggle>
                      <Dropdown.Menu className="traceability-actions-dropdown" popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: false }] }}>
                        <Dropdown.Item onClick={() => openDetails("requirement", requirement)}><Eye size={14} className="me-2" />Ver requisito</Dropdown.Item>
                        {canEdit && !requirement.archivado && <Dropdown.Item onClick={() => openGeneration(requirement)}><Sparkles size={14} className="me-2" />Generar con IA</Dropdown.Item>}
                        {canEdit && !requirement.archivado && <Dropdown.Item onClick={() => openStory(undefined, requirement.id)}><FilePlus2 size={14} className="me-2" />Crear historia</Dropdown.Item>}
                        <Dropdown.Item onClick={() => openHistory(requirement, "requisitos")}><History size={14} className="me-2" />Historial</Dropdown.Item>
                        {canEdit && <Dropdown.Item onClick={() => openRequirement(requirement)}><Pencil size={14} className="me-2" />Editar requisito</Dropdown.Item>}
                        {canEdit && <Dropdown.Divider />}
                        {canEdit && <Dropdown.Item className="text-danger" onClick={() => setArchived(requirement, "requisitos", !requirement.archivado)}>{requirement.archivado ? "Restaurar requisito" : "Archivar requisito"}</Dropdown.Item>}
                      </Dropdown.Menu>
                    </Dropdown>
                  </td>
                </tr>
              );
            })}
            {!loading && visibleRequirements.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-4">
                  No hay requisitos para los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
      <Card className="border-0 shadow-sm traceability-table-card">
        <Card.Header className="bg-light border-bottom py-2 px-3 d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center gap-2">
            <Button
              variant="light"
              size="sm"
              className="border"
              title={
                storiesExpanded ? "Contraer historias" : "Expandir historias"
              }
              aria-label={
                storiesExpanded ? "Contraer historias" : "Expandir historias"
              }
              aria-expanded={storiesExpanded}
              onClick={() => setStoriesExpanded((value) => !value)}
            >
              {storiesExpanded ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </Button>
            <h6 className="fw-bold mb-0">
              Historias <Badge bg="secondary">{stories.length}</Badge>
            </h6>
          </div>
          {storiesExpanded && (
            <span className="small text-muted">
              {visibleStories.length} visibles
            </span>
          )}
        </Card.Header>
        <Collapse in={storiesExpanded}>
          <div>
            <div className="p-3 border-bottom bg-white">
              <Row className="g-2">
                <Col md={5}>
                  <div className="position-relative">
                    <Search
                      size={15}
                      className="position-absolute top-50 start-0 translate-middle-y ms-2 text-muted"
                    />
                    <Form.Control
                      size="sm"
                      className="ps-4"
                      placeholder="Buscar por codigo, historia o requisito"
                      value={storySearch}
                      onChange={(event) => setStorySearch(event.target.value)}
                    />
                  </div>
                </Col>
                <Col md={4}>
                  <Form.Select
                    size="sm"
                    value={storyRequirementFilter}
                    onChange={(event) =>
                      setStoryRequirementFilter(event.target.value)
                    }
                    aria-label="Filtrar historias por requisito"
                  >
                    <option value="">Todos los requisitos</option>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>
                        {requirement.codigo} - {requirement.titulo}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Select
                    size="sm"
                    value={storyStateFilter}
                    onChange={(event) =>
                      setStoryStateFilter(event.target.value)
                    }
                    aria-label="Filtrar historias por estado"
                  >
                    <option value="">Todos los estados</option>
                    {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA", "ARCHIVADA"].map(
                      (state) => (
                        <option key={state}>{state}</option>
                      ),
                    )}
                  </Form.Select>
                </Col>
              </Row>
            </div>
            <Table responsive size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Historia</th>
                  <th>Creada</th>
                  <th>Requisito</th>
                  <th>Estado</th>
                  <th>Casos</th>
                  <th className="text-end">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleStories.map((story) => {
                  const requirement = requirementById.get(story.requisito_id);
                  return (
                    <tr key={story.id}>
                      <td style={{ maxWidth: "520px" }}>
                        <div
                          className="text-truncate"
                          title={`${story.codigo} ${story.titulo}`}
                        >
                          <strong>{story.codigo}</strong> {story.titulo}
                        </div>
                        {story.external_url && (
                          <a
                            href={story.external_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ms-1"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </td>
                      <td className="small text-nowrap" title={formatDateTime(story.fecha_creacion)}>
                        {formatDateTime(story.fecha_creacion) || "—"}
                      </td>
                      <td className="small">
                        {requirement?.codigo || story.requisito_codigo}
                      </td>
                      <td>
                        {canEdit && !story.archivado ? (
                          <Form.Select
                            size="sm"
                            value={story.estado}
                            onChange={(event) => void changeStoryState(story, event.target.value)}
                            aria-label={`Cambiar estado de ${story.codigo}`}
                          >
                            {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA"].map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}
                          </Form.Select>
                        ) : <Badge bg="secondary">{story.estado}</Badge>}
                      </td>
                      <td>
                        {story.case_count}{" "}
                        {story.requiere_revision_count > 0 && (
                          <ReviewPendingIcon count={story.requiere_revision_count} tooltipId={`story-${story.id}-pending`} />
                        )}
                      </td>
                      <td className="text-end">
                        <Dropdown align="end" drop="down" className="traceability-actions-menu">
                          <Dropdown.Toggle variant="light" size="sm" className="border" aria-label={`Acciones para ${story.codigo}`} title="Acciones"><MoreHorizontal size={15} /></Dropdown.Toggle>
                          <Dropdown.Menu className="traceability-actions-dropdown" popperConfig={{ strategy: "fixed", modifiers: [{ name: "flip", enabled: false }] }}>
                            <Dropdown.Item onClick={() => openDetails("story", story)}><Eye size={14} className="me-2" />Ver historia</Dropdown.Item>
                            {canEdit && !story.archivado && <Dropdown.Item onClick={() => onCreateCaseFromStory(story, requirement)}><FilePlus2 size={14} className="me-2" />Crear caso</Dropdown.Item>}
                            {canEdit && !story.archivado && <Dropdown.Item onClick={() => setCaseGenerationStory(story)}><Sparkles size={14} className="me-2" />Generar con IA</Dropdown.Item>}
                            <Dropdown.Item onClick={() => openHistory(story, "historias")}><History size={14} className="me-2" />Historial</Dropdown.Item>
                            {canEdit && <Dropdown.Item onClick={() => openStory(story)}><Pencil size={14} className="me-2" />Editar historia</Dropdown.Item>}
                            {canEdit && <Dropdown.Divider />}
                            {canEdit && <Dropdown.Item className="text-danger" onClick={() => setArchived(story, "historias", !story.archivado)}>{story.archivado ? "Restaurar historia" : "Archivar historia"}</Dropdown.Item>}
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                    </tr>
                  );
                })}
                {visibleStories.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-3">
                      No hay historias para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </Collapse>
      </Card>

      <Modal
        show={showRequirementModal}
        onHide={() => setShowRequirementModal(false)}
        size="lg"
        centered
        scrollable
      >
        <Form onSubmit={saveRequirement}>
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title className="fw-bold d-flex align-items-center gap-2">
              <FileText size={18} className="text-primary" />
              {editingRequirement ? "Editar requisito" : "Nuevo requisito"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-0">
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>Titulo</Form.Label>
                <Form.Control
                  required
                  value={requirementForm.titulo}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      titulo: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={2}>
                <Form.Label>Prioridad</Form.Label>
                <Form.Select
                  value={requirementForm.prioridad}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      prioridad: event.target.value,
                    })
                  }
                >
                  {["ALTA", "MEDIA", "BAJA"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label>Estado</Form.Label>
                <Form.Select
                  value={requirementForm.estado}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      estado: event.target.value,
                    })
                  }
                >
                  {["BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </Form.Select>
              </Col>
              <Col xs={12}>
                <Form.Label>Descripcion Markdown</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={6}
                  value={requirementForm.descripcion_markdown}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      descripcion_markdown: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={6}>
                <Form.Label>Ticket externo opcional</Form.Label>
                <Form.Control
                  placeholder="Proveedor"
                  value={requirementForm.external_provider || ""}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      external_provider: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={6}>
                <Form.Label>Referencia / URL opcional</Form.Label>
                <Form.Control
                  placeholder="ID o URL"
                  value={requirementForm.external_url || ""}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      external_url: event.target.value,
                      external_reference: event.target.value,
                    })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>Componentes afectados</Form.Label>
                <div className="traceability-component-picker">
                  {projectComponents.length ? (
                    projectComponents.map((component) => (
                      <Form.Check
                        key={component.id}
                        type="checkbox"
                        id={`requirement-component-${component.id}`}
                        label={component.name}
                        checked={(
                          requirementForm.componente_ids || []
                        ).includes(component.id)}
                        onChange={() =>
                          toggleRequirementComponent(component.id)
                        }
                      />
                    ))
                  ) : (
                    <span className="small text-muted">
                      No hay componentes disponibles en este proyecto.
                    </span>
                  )}
                </div>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowRequirementModal(false)}
            >
              Cancelar
            </Button>
            <Button type="submit">Guardar</Button>
          </Modal.Footer>
        </Form>
      </Modal>
      {caseGenerationStory && <CaseGenerationWizard story={caseGenerationStory} fetchWithAuth={fetchWithAuth} onClose={() => setCaseGenerationStory(null)} onApplied={(count) => { setCaseGenerationStory(null); showFeedback("Casos creados", `${count} casos manuales quedaron creados y trazados para revisión.`, "success"); }} />}
      <Modal
        show={showStoryModal}
        onHide={() => setShowStoryModal(false)}
        size="lg"
        centered
        scrollable
      >
        <Form onSubmit={saveStory}>
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title className="fw-bold d-flex align-items-center gap-2">
              <Pencil size={18} className="text-primary" />
              {editingStory ? "Editar historia" : "Nueva historia"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-0">
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>Requisito</Form.Label>
                <Form.Select
                  required
                  value={storyRequirementId}
                  disabled={Boolean(editingStory)}
                  onChange={(event) =>
                    setStoryRequirementId(event.target.value)
                  }
                >
                  {!editingStory && (
                    <option value="">Seleccionar requisito</option>
                  )}
                  {requirements.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.codigo} - {item.titulo}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label>Prioridad</Form.Label>
                <Form.Select
                  value={storyForm.prioridad}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      prioridad: event.target.value,
                    })
                  }
                >
                  {["ALTA", "MEDIA", "BAJA"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label>Estado</Form.Label>
                <Form.Select
                  value={storyForm.estado}
                  onChange={(event) =>
                    setStoryForm({ ...storyForm, estado: event.target.value })
                  }
                >
                  {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </Form.Select>
              </Col>
              <Col xs={12}>
                <Form.Label>Titulo</Form.Label>
                <Form.Control
                  required
                  value={storyForm.titulo}
                  onChange={(event) =>
                    setStoryForm({ ...storyForm, titulo: event.target.value })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>{editingStory ? "Descripción Markdown" : "Historia de usuario"}</Form.Label>
                {!editingStory && <div className="border-start border-primary border-3 ps-3 py-1 mb-2 small text-muted"><strong className="text-dark d-block">Formato recomendado</strong>Como <em>[rol o usuario]</em>, quiero <em>[acción o funcionalidad]</em>, para <em>[beneficio o valor]</em>.</div>}
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={storyForm.descripcion_markdown}
                  placeholder={editingStory ? undefined : "Como analista de calidad, quiero consultar el resumen de ejecución, para identificar riesgos antes de liberar una build."}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      descripcion_markdown: event.target.value,
                    })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>{editingStory ? "Criterios de aceptacion Markdown" : "Criterios de aceptación estructurados"}</Form.Label>
                {!editingStory && <><p className="small text-muted mb-2">Definí el comportamiento verificable. Estos criterios quedan vinculados a los casos de prueba y habilitan la generación asistida.</p><AcceptanceCriteriaEditor criteria={storyForm.acceptance_criteria || []} onChange={(acceptance_criteria) => setStoryForm({ ...storyForm, acceptance_criteria })} /></>}
                {editingStory &&
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={storyForm.criterios_aceptacion_markdown}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      criterios_aceptacion_markdown: event.target.value,
                    })
                  }
                />}
              </Col>
              <Col md={6}>
                <Form.Label>Proveedor externo</Form.Label>
                <Form.Control
                  value={storyForm.external_provider || ""}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      external_provider: event.target.value,
                    })
                  }
                />
              </Col>
              <Col md={6}>
                <Form.Label>URL externa</Form.Label>
                <Form.Control
                  type="url"
                  value={storyForm.external_url || ""}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      external_url: event.target.value,
                    })
                  }
                />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowStoryModal(false)}
            >
              Cancelar
            </Button>
            <Button type="submit">Guardar</Button>
          </Modal.Footer>
        </Form>
      </Modal>
      <Modal
        show={Boolean(generationRequirement)}
        onHide={() => !generationBusy && setGenerationRequirement(null)}
        size="xl"
        scrollable
        centered
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            Generar historias con IA
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {generationRequirement && (
            <div className="d-flex flex-column gap-3">
              <div className="border-start border-primary border-3 ps-3">
                <div className="fw-semibold">
                  {generationRequirement.codigo} -{" "}
                  {generationRequirement.titulo}
                </div>
                <div className="small text-muted">
                  Las propuestas no se crearán hasta que las revises y
                  confirmes.
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2 small" aria-label="Etapas de generación">
                {[
                  "1. Contexto",
                  "2. Analizar requisito",
                  "3. Generar propuestas",
                  "4. Revisar borradores",
                ].map((label, index) => {
                  const currentStep = {
                    context: 0,
                    analysis: 1,
                    configuration: 2,
                    review: 3,
                  }[generationStep];
                  return (
                    <span
                      key={label}
                      className={`border rounded px-2 py-1 ${index === currentStep ? "bg-primary text-white border-primary" : index < currentStep ? "bg-light text-muted" : "text-muted"}`}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              {generationBusy && (
                <div className="border rounded bg-light px-3 py-2" aria-live="polite">
                  <div className="d-flex align-items-center gap-2">
                    <Spinner animation="border" variant="primary" size="sm" role="status">
                      <span className="visually-hidden">Procesando</span>
                    </Spinner>
                    <div className="flex-grow-1">
                      <span className="fw-semibold">La IA está trabajando</span>
                      <span className="text-muted small ms-2">
                        {generationStep === "context"
                          ? "Analizando el requisito y el contexto seleccionado."
                          : generationStep === "analysis"
                            ? "Actualizando el análisis con las respuestas proporcionadas."
                            : generationStep === "configuration"
                            ? `Generando borrador ${Math.min(generationCompletedCount + 1, generationRequestedCount)} de ${generationRequestedCount}. Los resultados válidos aparecen a medida que se completan.`
                            : "Creando los borradores seleccionados."}
                      </span>
                    </div>
                    <span className="small text-muted">{generationElapsedSeconds}s</span>
                  </div>
                  <ProgressBar animated now={100} variant="primary" className="mt-2" style={{ height: "4px" }} />
                </div>
              )}
              {generationStep === "context" && (
              <div className="border rounded overflow-hidden">
                <div className="bg-light border-bottom px-3 py-2 d-flex align-items-center justify-content-between">
                  <div className="fw-semibold">Contexto para IA</div>
                  <Button
                    variant="light"
                    size="sm"
                    className="border"
                    title={
                      generationContextExpanded
                        ? "Contraer contexto"
                        : "Expandir contexto"
                    }
                    aria-label={
                      generationContextExpanded
                        ? "Contraer contexto"
                        : "Expandir contexto"
                    }
                    onClick={() =>
                      setGenerationContextExpanded((value) => !value)
                    }
                  >
                    {generationContextExpanded ? (
                      <ChevronDown size={15} />
                    ) : (
                      <ChevronRight size={15} />
                    )}
                  </Button>
                </div>
                {generationContextExpanded && (
                  <div className="p-3 d-flex flex-column gap-3">
                    <Form.Group>
                      <Form.Label>Instrucciones opcionales</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        disabled={Boolean(generationRun)}
                        value={generationInstructions}
                        onChange={(event) =>
                          setGenerationInstructions(event.target.value)
                        }
                        placeholder="Foco, exclusiones o criterios que deben considerarse."
                      />
                    </Form.Group>
                    <Form.Group>
                      <Form.Label>Componentes de contexto</Form.Label>
                      <div className="d-flex flex-wrap gap-3">
                        {projectComponents.map((component) => (
                          <Form.Check
                            key={component.id}
                            type="checkbox"
                            disabled={Boolean(generationRun)}
                            label={component.name}
                            checked={generationComponentIds.includes(
                              component.id,
                            )}
                            onChange={() =>
                              setGenerationComponentIds((previous) =>
                                previous.includes(component.id)
                                  ? previous.filter((id) => id !== component.id)
                                  : [...previous, component.id],
                              )
                            }
                          />
                        ))}
                      </div>
                    </Form.Group>
                    <Form.Group>
                      <Form.Label>Páginas Wiki opcionales</Form.Label>
                      {generationWiki.length ? (
                        <div
                          className="border rounded p-2"
                          style={{ maxHeight: "160px", overflowY: "auto" }}
                        >
                          {generationWiki.map((page) => (
                            <Form.Check
                              key={page.id}
                              type="checkbox"
                              disabled={Boolean(generationRun)}
                              className="mb-1"
                              label={page.titulo}
                              checked={generationWikiIds.includes(page.id)}
                              onChange={() =>
                                setGenerationWikiIds((previous) =>
                                  previous.includes(page.id)
                                    ? previous.filter((id) => id !== page.id)
                                    : [...previous, page.id],
                                )
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="small text-muted">
                          No hay páginas Wiki disponibles.
                        </div>
                      )}
                    </Form.Group>
                  </div>
                )}
              </div>
              )}
              {generationRun && generationStep === "analysis" && (
                <div className="border-start border-primary border-3 bg-light px-3 py-2">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <div className="flex-grow-1">
                      <div className="small text-uppercase text-muted fw-semibold">
                        Resultado del análisis
                      </div>
                      <div className="fw-semibold">
                        {generationRun.analysis?.readiness === "READY"
                          ? "Contexto listo para continuar"
                          : generationRun.analysis?.readiness === "NEEDS_CLARIFICATION"
                            ? "Contexto incompleto: podés continuar con supuestos"
                            : "Análisis bloqueado"}
                      </div>
                      <div className="small text-muted">
                        {generationRun.analysis?.readiness === "READY"
                          ? "Respondé solo lo que conozcas y continuá para definir cuántas propuestas querés revisar."
                          : "Respondé solo lo que conozcas. Las preguntas sin respuesta quedarán registradas como pendientes y no impiden generar borradores."}
                      </div>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="d-inline-flex align-items-center gap-1"
                      onClick={() =>
                        setEstimateExplanationVisible((value) => !value)
                      }
                    >
                      <Eye size={14} />
                      {estimateExplanationVisible
                        ? "Ocultar explicación"
                        : "Ver explicación"}
                    </Button>
                  </div>
                  {estimateExplanationVisible && (
                    <div className="small border-top mt-2 pt-2 d-flex flex-column gap-2">
                      {!!generationRun.analysis?.ambiguities?.length && (
                        <div><span className="fw-semibold">Ambigüedades:</span> {generationRun.analysis.ambiguities.join("; ")}</div>
                      )}
                      {!!generationRun.analysis?.proposed_assumptions?.length && (
                        <div><span className="fw-semibold">Supuestos propuestos:</span> {generationRun.analysis.proposed_assumptions.map((item: any) => item.text).join("; ")}</div>
                      )}
                    </div>
                  )}
                  {!!generationRun.analysis?.questions?.length && (
                    <div className="border-top mt-2 pt-2">
                      <div className="fw-semibold">Respuestas para completar el contexto</div>
                      <div className="small text-muted mb-2">
                        Son opcionales. Se incluirán en la generación y quedarán asociadas a esta revisión.
                      </div>
                      <div className="d-flex flex-column gap-2">
                        {generationRun.analysis.questions.map((question: string, index: number) => (
                          <Form.Group key={question}>
                            <Form.Label className="small mb-1">
                              {index + 1}. {question}
                            </Form.Label>
                            <Form.Control
                              as="textarea"
                              rows={2}
                              value={generationQuestionAnswers[question] || ""}
                              disabled={generationBusy || generationCandidates.length > 0}
                              onChange={(event) =>
                                {
                                  setAutoContinuePaused(true);
                                  setGenerationQuestionAnswers((previous) => ({
                                    ...previous,
                                    [question]: event.target.value,
                                  }));
                                }
                              }
                              placeholder="Opcional: dejalo vacío si QA no cuenta con este dato."
                            />
                          </Form.Group>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {generationRun && generationStep === "configuration" && (
                <div className="border-start border-primary border-3 bg-light px-3 py-3">
                  <div className="small text-uppercase text-muted fw-semibold">
                    Propuesta de alcance
                  </div>
                  <div className="fw-semibold">
                    La IA propone {generationRun.estimacion?.cantidad_recomendada || 1} {generationRun.estimacion?.cantidad_recomendada === 1 ? "historia" : "historias"}
                  </div>
                  <div className="small text-muted mb-3">
                    Antes de crear borradores, se compara la intención de estas propuestas con las historias activas del proyecto. Las ya cubiertas no consumen una generación.
                  </div>
                  {!!generationRun.analysis?.story_outline?.length && (
                    <div className="border rounded bg-white overflow-hidden">
                      <div className="px-3 py-2 border-bottom fw-semibold">Historias sugeridas</div>
                      {generationRun.analysis.story_outline.map((item: any, index: number) => (
                        <div key={`${item.title}-${index}`} className="px-3 py-2 border-bottom small">
                          <div className="fw-semibold">Propuesta {index + 1}: {item.title}</div>
                          {item.reason && <div className="text-muted">{item.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {generationBusy && (
                    <div className="border rounded bg-white mt-3 overflow-hidden" aria-live="polite">
                      <div className="px-3 py-2 border-bottom d-flex justify-content-between align-items-center">
                        <span className="fw-semibold">Borradores generados</span>
                        <span className="small text-muted">{generationCompletedCount} de {generationRequestedCount} completados</span>
                      </div>
                      {generationCandidates.length ? (
                        generationCandidates.map((item, index) => (
                          <div key={item.local_id || index} className="px-3 py-2 border-bottom small">
                            <span className="fw-semibold">Borrador {index + 1}:</span> {item.title || item.titulo}
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-2 small text-muted">Todavía no hay un borrador completo para mostrar.</div>
                      )}
                    </div>
                  )}
                  {preflightExcludedStories.length > 0 && (
                    <div className="border border-warning rounded bg-warning-subtle mt-3 overflow-hidden">
                      <div className="px-3 py-2 fw-semibold">
                        {preflightExcludedStories.length} {preflightExcludedStories.length === 1 ? "propuesta ya está cubierta" : "propuestas ya están cubiertas"}
                      </div>
                      {preflightExcludedStories.map((item: any, index: number) => (
                        <div key={`${item.title}-${index}`} className="px-3 py-2 border-top small">
                          <span className="fw-semibold">{item.title}</span>
                          {item.similar_stories?.length > 0 && (
                            <span className="text-muted"> · existente: {item.similar_stories.map((story: any) => `${story.codigo} ${story.titulo}`).join(", ")}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {generationRun && generationStep === "review" && generationCandidates.length === 0 && preflightExcludedStories.length > 0 && (
                <div className="border border-warning rounded bg-warning-subtle px-3 py-3">
                  <div className="fw-semibold">No se generaron borradores nuevos</div>
                  <div className="small">
                    Todas las propuestas del alcance ya están cubiertas por historias activas. Podés volver al análisis si el requisito requiere una capacidad distinta.
                  </div>
                </div>
              )}
              {generationCandidates.length > 0 && generationStep === "review" && (
                <div className="border rounded overflow-hidden">
                  <div className="bg-light border-bottom px-3 py-2 d-flex align-items-center justify-content-between">
                    <div className="fw-semibold">
                      Vista previa de inserción{" "}
                      <Badge bg="secondary">
                        {generationCandidates.length}
                      </Badge>
                    </div>
                    <span className="small text-muted">
                      {selectedCandidateCount} seleccionadas
                    </span>
                  </div>
                  <Table responsive size="sm" className="align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Historia</th>
                        <th>Requisito</th>
                        <th>Estado</th>
                        <th>Casos</th>
                        <th className="text-end">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generationCandidates.map((candidate, index) => (
                        <Fragment key={`candidate-group-${index}`}>
                          <tr
                            key={`candidate-${index}`}
                            className={candidate.selected ? "" : "text-muted"}
                          >
                            <td>
                              <span className="fw-semibold">Propuesta {index + 1}</span>{" "}
                              {candidate.title}
                              <Badge bg={proposalQualityMeta(candidate).variant} className="ms-2">
                                {proposalQualityMeta(candidate).label}
                              </Badge>
                              {hasSimilarStory(candidate) && (
                                <Badge bg="warning" text="dark" className="ms-2">
                                  {candidate.similarity_check?.mode === "AI_INTENT"
                                    ? "Intención ya cubierta"
                                    : "Historia similar existente"}
                                </Badge>
                              )}
                              <span className="small text-muted ms-2">
                                {candidate.story_type === "USER_STORY" ? "Historia de usuario" : candidate.story_type === "TECHNICAL_STORY" ? "Historia técnica" : candidate.story_type}
                              </span>
                            </td>
                            <td className="small">
                              {generationRequirement.codigo}
                            </td>
                            <td>
                              <Badge bg="secondary">BORRADOR</Badge>
                            </td>
                            <td>0</td>
                            <td className="text-end">
                              <Button
                                variant="light"
                                size="sm"
                                className="border me-1"
                                title={
                                  expandedCandidateIndexes.has(index)
                                    ? "Ocultar detalle"
                                    : "Ver y editar detalle"
                                }
                                aria-label={
                                  expandedCandidateIndexes.has(index)
                                    ? "Ocultar detalle"
                                    : "Ver y editar detalle"
                                }
                                onClick={() => setExpandedCandidateIndexes((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(index)) next.delete(index);
                                  else next.add(index);
                                  return next;
                                })}
                              >
                                <Eye size={14} />
                              </Button>
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 me-2 align-baseline text-decoration-none"
                                onClick={() => setExpandedCandidateIndexes((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(index)) next.delete(index);
                                  else next.add(index);
                                  return next;
                                })}
                              >
                                {expandedCandidateIndexes.has(index) ? "Ocultar detalle" : "Ver detalle"}
                              </Button>
                              <Form.Check
                                inline
                                className="d-inline-block align-middle mb-0"
                                title={
                                  proposalQuality(candidate) === "FAIL"
                                    ? candidate.selected
                                      ? "Excluir de la creación"
                                      : "Incluir y revisar observaciones críticas"
                                    : candidate.selected
                                    ? "Incluir al crear"
                                    : "Excluir de la creación"
                                }
                                aria-label={
                                  proposalQuality(candidate) === "FAIL"
                                    ? candidate.selected
                                      ? "Excluir propuesta que requiere revisión"
                                      : "Incluir propuesta que requiere revisión"
                                    : candidate.selected
                                    ? "Incluir al crear"
                                    : "Excluir de la creación"
                                }
                                checked={Boolean(candidate.selected)}
                                onChange={() => {
                                  const nextSelected = !candidate.selected;
                                  setGenerationCandidates((previous) =>
                                    previous.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                          ...item,
                                          selected: nextSelected,
                                          ...(nextSelected ? {} : {
                                            quality_override_accepted: false,
                                            quality_override_reason: "",
                                          }),
                                        }
                                        : item,
                                    ),
                                  );
                                  if (nextSelected && proposalQuality(candidate) === "FAIL") {
                                    setExpandedCandidateIndexes((previous) => new Set(previous).add(index));
                                  }
                                }}
                              />
                            </td>
                          </tr>
                          {expandedCandidateIndexes.has(index) && (
                            <tr
                              key={`candidate-detail-${index}`}
                              className="bg-light"
                            >
                              <td colSpan={5} className="p-3">
                                <div className={`border rounded p-2 mb-3 small ${proposalQuality(candidate) === "FAIL" ? "border-danger bg-danger-subtle" : proposalQuality(candidate) === "WARN" ? "border-warning bg-warning-subtle" : "border-success bg-success-subtle"}`}>
                                  <span className="fw-semibold">Calidad: {proposalQualityMeta(candidate).label}.</span>
                                  {candidate.rule_findings?.length ? (
                                    <ul className="mb-0 mt-1 ps-3">
                                      {candidate.rule_findings.map((finding: any) => <li key={`${finding.code}-${finding.message}`}>{finding.message}</li>)}
                                    </ul>
                                  ) : candidate.quality?.warnings?.length ? (
                                    <div className="mt-1">{candidate.quality.warnings.join("; ")}</div>
                                  ) : (
                                    <div className="mt-1">La propuesta cumple las reglas automáticas.</div>
                                  )}
                                </div>
                                {hasSimilarStory(candidate) && (
                                  <div className="border border-warning rounded p-2 mb-3 small bg-warning-subtle">
                                    <span className="fw-semibold">
                                      {candidate.similarity_check?.mode === "AI_INTENT"
                                        ? "La IA detectó una intención funcional equivalente."
                                        : "Historias existentes con un título similar."}
                                    </span>
                                    <div className="mt-1">
                                      Revisá si esta propuesta aporta un alcance distinto antes de seleccionarla. La decisión final es tuya.
                                    </div>
                                    <ul className="mb-0 mt-1 ps-3">
                                      {candidate.similar_stories.map((story: any) => (
                                        <li key={`${story.id}-${story.codigo}-${story.titulo}`}>
                                          <span className="fw-semibold">{story.codigo || "Historia"}</span>{" "}
                                          {story.titulo}{" "}
                                          <span className="text-muted">
                                            ({story.kind === "AI_INTENT"
                                              ? story.reason || `intención equivalente${story.confidence ? ` (${story.confidence.toLowerCase()})` : ""}`
                                              : story.kind === "EXACT" ? "título igual" : "título parecido"})
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {proposalQuality(candidate) === "FAIL" && candidate.selected && (
                                  <div className="border border-danger rounded p-2 mb-3 small">
                                    <Form.Check
                                      id={`quality-override-${index}`}
                                      label="Entiendo las observaciones críticas y decido crear este borrador."
                                      checked={Boolean(candidate.quality_override_accepted)}
                                      onChange={(event) => updateGenerationCandidate(index, {
                                        quality_override_accepted: event.target.checked,
                                      })}
                                    />
                                    <Form.Label className="small fw-semibold mt-2 mb-1" htmlFor={`quality-override-reason-${index}`}>
                                      Justificación de la decisión
                                    </Form.Label>
                                    <Form.Control
                                      id={`quality-override-reason-${index}`}
                                      size="sm"
                                      as="textarea"
                                      rows={2}
                                      placeholder="Explicá por qué esta propuesta debe crearse pese a las observaciones."
                                      value={candidate.quality_override_reason || ""}
                                      onChange={(event) => updateGenerationCandidate(index, {
                                        quality_override_reason: event.target.value,
                                      })}
                                    />
                                  </div>
                                )}
                                <Row className="g-3">
                                  <Col md={8}>
                                    <Form.Label className="small fw-semibold">
                                      Título
                                    </Form.Label>
                                    <Form.Control
                                      size="sm"
                                      value={candidate.title}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, title: event.target.value } : item,
                                          ),
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col md={4}>
                                    <Form.Label className="small fw-semibold">
                                      Prioridad
                                    </Form.Label>
                                    <Form.Select
                                      size="sm"
                                      value={candidate.prioridad}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, prioridad: event.target.value } : item,
                                          ),
                                        )
                                      }
                                    >
                                      {["ALTA", "MEDIA", "BAJA"].map(
                                        (priority) => (
                                          <option key={priority}>
                                            {priority}
                                          </option>
                                        ),
                                      )}
                                    </Form.Select>
                                  </Col>
                                  <Col md={6}>
                                    <Form.Label className="small fw-semibold">
                                      Descripción
                                    </Form.Label>
                                    <Form.Control
                                      as="textarea"
                                      rows={4}
                                      value={candidate.description}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index ? { ...item, description: event.target.value } : item,
                                          ),
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col md={6}>
                                    <Form.Label className="small fw-semibold">
                                      Criterios de aceptación
                                    </Form.Label>
                                    <AcceptanceCriteriaEditor
                                      criteria={candidate.acceptance_criteria || []}
                                      onChange={(acceptance_criteria) => updateGenerationCandidate(index, { acceptance_criteria })}
                                    />
                                  </Col>
                                </Row>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer className="d-flex flex-wrap align-items-end justify-content-end gap-2">
          <Button
            variant="secondary"
            disabled={generationBusy}
            onClick={() => setGenerationRequirement(null)}
          >
            Cancelar
          </Button>
          {generationRun && (
            <Button
              variant="outline-secondary"
              disabled={generationBusy}
              onClick={() => {
                setGenerationRun(null);
                setGenerationCandidates([]);
                setGenerationStep("context");
                setGenerationContextExpanded(true);
                setExpandedCandidateIndexes(new Set());
              }}
            >
              Volver a contexto
            </Button>
          )}
          {!generationRun && (
            <Button
              disabled={generationBusy}
              onClick={() => void estimateGeneration()}
            >
              {generationBusy
                ? "Analizando..."
                : "Analizar requisito"}
            </Button>
          )}
          {generationRun && generationCandidates.length === 0 && (
            generationRun.estado === "ESPERANDO_SUPUESTOS" && generationHasActionableReview ? (
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <Button disabled={generationBusy} onClick={() => void confirmAssumptions()}>
                  {generationBusy ? "Guardando..." : "Continuar con supuestos de trabajo"}
                </Button>
                {generationHasCriticalAssumptions ? (
                  <span className="small text-muted">Los supuestos críticos requieren esta confirmación explícita.</span>
                ) : autoContinueRemaining !== null ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setAutoContinuePaused(true)}
                  >
                    Pausar continuación automática ({autoContinueRemaining}s)
                  </Button>
                ) : autoContinuePaused ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setAutoContinuePaused(false)}
                  >
                    Reanudar continuación automática
                  </Button>
                ) : null}
              </div>
            ) : generationStep === "analysis" ? (
              <Button
                disabled={generationBusy}
                onClick={() => void recalculateGenerationScope()}
              >
                {generationBusy ? "Actualizando..." : "Continuar y calcular alcance"}
              </Button>
            ) : generationStep === "configuration" ? (
              <div className="d-flex align-items-end gap-2">
                <Button
                  variant="outline-secondary"
                  disabled={generationBusy}
                  onClick={() => setGenerationStep("analysis")}
                >
                  Volver al análisis
                </Button>
                <Form.Group style={{ width: "158px" }}>
                  <Form.Label className="small mb-1 text-nowrap">Cantidad de borradores</Form.Label>
                  <Form.Control
                    size="sm"
                    type="number"
                    min={1}
                    max={20}
                    value={generationMaxStories}
                    disabled={generationBusy}
                    onChange={(event) => setGenerationMaxStories(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                  />
                </Form.Group>
                <Button disabled={generationBusy} onClick={() => void generateCandidates()}>
                  {generationBusy ? "Generando..." : `Generar ${generationMaxStories} ${generationMaxStories === 1 ? "borrador" : "borradores"}`}
                </Button>
              </div>
            ) : (
              <div className="d-flex align-items-end gap-2">
                <Form.Group style={{ width: "104px" }}>
                  <Form.Label className="small mb-1">Propuestas</Form.Label>
                  <Form.Control
                    size="sm"
                    type="number"
                    min={1}
                    max={20}
                    value={generationMaxStories}
                    disabled={generationBusy}
                    onChange={(event) => setGenerationMaxStories(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                  />
                </Form.Group>
                <Button disabled={generationBusy} onClick={() => void generateCandidates()}>
                  {generationBusy ? "Generando..." : `Generar ${generationMaxStories} ${generationMaxStories === 1 ? "propuesta" : "propuestas"}`}
                </Button>
              </div>
            )
          )}
          {generationCandidates.length > 0 && (
            <div className="d-flex flex-column align-items-end gap-1">
              {selectedCriticalCandidatesNeedDecision && (
                <span className="small text-danger">
                  Confirmá y justificá las propuestas que requieren revisión.
                </span>
              )}
              <Button
                disabled={generationBusy || selectedCandidateCount === 0 || selectedCriticalCandidatesNeedDecision}
                onClick={() => void applyCandidates()}
              >
                {generationBusy
                  ? "Creando..."
                  : `Crear ${selectedCandidateCount} borradores`}
              </Button>
            </div>
          )}
        </Modal.Footer>
      </Modal>
      <Modal
        show={Boolean(detailItem)}
        onHide={() => setDetailItem(null)}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <Eye size={18} className="text-primary" />
            {detailItem?.kind === "requirement" ? "Requisito" : "Historia"}:{" "}
            {detailItem?.item.codigo}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          {detailItem && (
            <Row className="g-3">
              <Col xs={12}>
                <div className="fw-semibold fs-5">{detailItem.item.titulo}</div>
                <div className="d-flex gap-2 mt-2">
                  <Badge
                    bg={
                      detailItem.item.estado === "ACTIVO"
                        ? "success"
                        : "secondary"
                    }
                  >
                    {detailItem.item.estado}
                  </Badge>
                  <Badge bg="light" text="dark" className="border">
                    Prioridad {detailItem.item.prioridad}
                  </Badge>
                </div>
              </Col>
              <Col xs={12}>
                <div className="small fw-bold text-uppercase text-muted mb-1">
                  Descripcion
                </div>
                <div className="border rounded p-3 bg-light markdown-preview"><WikiMarkdownViewer content={detailItem.item.descripcion_markdown || "Sin descripcion registrada."} /></div>
              </Col>
              {detailItem.kind === "story" && (
                <>
                  <Col xs={12}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      Criterios de aceptacion
                    </div>
                    <div className="border rounded p-3 bg-light markdown-preview"><WikiMarkdownViewer content={detailItem.item.criterios_aceptacion_markdown || "Sin criterios de aceptacion registrados."} /></div>
                  </Col>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      Requisito relacionado
                    </div>
                    <Button
                      variant="link"
                      className="p-0 text-start"
                      onClick={() => {
                        const requirement = requirementById.get(
                          detailItem.item.requisito_id,
                        );
                        if (requirement)
                          openDetails("requirement", requirement);
                      }}
                    >
                      {requirementById.get(detailItem.item.requisito_id)
                        ?.codigo ||
                        detailItem.item.requisito_codigo ||
                        "No disponible"}
                    </Button>
                  </Col>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      Casos de prueba vinculados
                    </div>
                    {linkedStoryCasesLoading ? <span className="small text-muted">Cargando casos vinculados…</span> : linkedStoryCases.length ? <div className="d-flex flex-column gap-1">{linkedStoryCases.map((testCase) => <Button key={testCase.master_id} variant="link" className="p-0 text-start small" onClick={() => { setDetailItem(null); onOpenLinkedCase(String(testCase.master_id)); }}><strong>{testCase.codigo}</strong> · {testCase.titulo}{testCase.requiere_revision ? <span className="ms-1"><ReviewPendingIcon count={1} tooltipId={`linked-case-${testCase.master_id}-pending`} /></span> : null}</Button>)}</div> : <span className="small text-muted">Sin casos vinculados.</span>}
                  </Col>
                </>
              )}
              {detailItem.kind === "requirement" && (
                <>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      Componentes
                    </div>
                    <div>
                      {(detailItem.item.componente_ids || [])
                        .map(
                          (id: string) =>
                            projectComponents.find(
                              (component) => component.id === id,
                            )?.name || "Componente",
                        )
                        .join(", ") || "Todos"}
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      Historias vinculadas
                    </div>
                    <div>
                      {storiesForRequirement(detailItem.item.id).length}{" "}
                      historias
                    </div>
                  </Col>
                  <Col xs={12}>
                    <div className="small fw-bold text-uppercase text-muted mb-2">
                      Historias vinculadas
                    </div>
                    <Table responsive size="sm" className="mb-0 border">
                      <thead>
                        <tr>
                          <th>Historia</th>
                          <th>Estado</th>
                          <th>Casos</th>
                          <th className="text-end">Ver</th>
                        </tr>
                      </thead>
                      <tbody>
                        {storiesForRequirement(detailItem.item.id).map(
                          (story) => (
                            <tr key={story.id}>
                              <td>
                                <strong>{story.codigo}</strong> {story.titulo}
                              </td>
                              <td>
                                <Badge bg="secondary">{story.estado}</Badge>
                              </td>
                              <td>{story.case_count || 0}</td>
                              <td className="text-end">
                                <Button
                                  variant="light"
                                  size="sm"
                                  className="border"
                                  title="Ver historia"
                                  aria-label={`Ver historia ${story.codigo}`}
                                  onClick={() => openDetails("story", story)}
                                >
                                  <Eye size={14} />
                                </Button>
                              </td>
                            </tr>
                          ),
                        )}
                        {storiesForRequirement(detailItem.item.id).length ===
                          0 && (
                          <tr>
                            <td
                              colSpan={4}
                              className="text-center text-muted py-3"
                            >
                              Este requisito todavía no tiene historias
                              vinculadas.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </Col>
                </>
              )}
              {(detailItem.item.external_provider ||
                detailItem.item.external_reference ||
                detailItem.item.external_url) && (
                <Col xs={12}>
                  <div className="small fw-bold text-uppercase text-muted mb-1">
                    Referencia externa
                  </div>
                  {detailItem.item.external_url ? (
                    <a
                      href={detailItem.item.external_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} className="me-1" />
                      {detailItem.item.external_reference ||
                        detailItem.item.external_provider ||
                        detailItem.item.external_url}
                    </a>
                  ) : (
                    <span>
                      {detailItem.item.external_reference ||
                        detailItem.item.external_provider}
                    </span>
                  )}
                </Col>
              )}
            </Row>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDetailItem(null)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal
        show={Boolean(historyEntries) && !historyDiff}
        size="lg"
        centered
        scrollable
        contentClassName="traceability-history-modal"
        onHide={() => {
          setHistoryEntries(null);
          setHistoryDiff(null);
        }}
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="d-flex align-items-center gap-2">
            <History size={18} className="text-primary" aria-hidden="true" />
            Historial del {historyKind === "requisitos" ? "requisito" : "historia"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          <div className="traceability-history-subtitle mb-3">
            {historyCode && <Badge bg="light" text="dark" className="me-2">{historyCode}</Badge>}
            <span>{historyTitle}</span>
          </div>
          <div className="d-flex flex-column gap-2">
            {historyEntries?.map((entry, index) => (
              <Card key={entry.id} className="traceability-history-entry shadow-none">
                <Card.Body className="p-3">
                  <div className="d-flex align-items-start justify-content-between gap-3">
                    <div className="min-w-0">
                      <div className="small text-muted">
                        {new Date(entry.fecha_edicion).toLocaleString()}
                      </div>
                      <div className="small fw-semibold text-break">{historyDisplayActor(entry)}</div>
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => openHistoryDiff(index)}
                    disabled={!historyEntries || index >= historyEntries.length - 1}
                    title={index >= (historyEntries?.length ?? 0) - 1
                      ? "No hay versión anterior para comparar."
                      : "Comparar con la versión anterior"}
                  >
                    Ver cambios
                  </Button>
                  {historyEntries && index >= historyEntries.length - 1 && (
                    <span className="small text-muted text-end" title="Esta es la versión más antigua">
                      Versión inicial
                    </span>
                  )}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
        </Modal.Body>
      </Modal>
      <Modal
        show={Boolean(historyDiff)}
        onHide={() => setHistoryDiff(null)}
        size="lg"
        centered
        scrollable
        contentClassName="traceability-history-modal traceability-diff-modal"
      >
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="d-flex align-items-center gap-2">
            <History size={18} className="text-primary" aria-hidden="true" />
            <span>Diferencias de versión</span>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          <div className="traceability-history-subtitle mb-3">
            {historyCode && <Badge bg="light" text="dark" className="me-2">{historyCode}</Badge>}
            <span>{historyTitle}</span>
          </div>
          <div className="traceability-diff-meta mb-3">
            <div className="small text-muted">
              Modificación: {historyDiff?.current?.fecha_edicion
              ? new Date(historyDiff.current.fecha_edicion).toLocaleString()
                : "—"}
            </div>
            <div className="small text-muted">
              {historyDiff?.current?.comentario_cambio || "Sin comentario de cambio."}
            </div>
          </div>
          {historyDiff?.previous ? (
            historyDiffRows.length === 0 ? (
              <Card className="traceability-history-entry shadow-none">
                <Card.Body className="p-3 text-muted">
                No se detectaron diferencias con la versión anterior.
                </Card.Body>
              </Card>
            ) : (
              historyDiffRows.map((item) => (
                <Card key={item.key} className="traceability-history-entry traceability-diff-entry shadow-none mb-3">
                  <Card.Body className="p-3">
                    <div className="small fw-semibold text-uppercase text-muted mb-3">
                      {item.label}
                    </div>
                    <Row className="g-3">
                      <Col md={6}>
                        <div className="small text-muted mb-1">Anterior</div>
                        <pre className="traceability-diff-value traceability-diff-value-previous">
                          {item.previousValue || "—"}
                        </pre>
                      </Col>
                      <Col md={6}>
                        <div className="small text-muted mb-1">Actual</div>
                        <pre className="traceability-diff-value traceability-diff-value-current">
                          {item.currentValue || "—"}
                        </pre>
                      </Col>
                    </Row>
                  </Card.Body>
                </Card>
              ))
            )
          ) : (
            <Card className="traceability-history-entry shadow-none">
              <Card.Body className="p-3 text-muted">
                Esta es la versión más antigua, no hay versión anterior para comparar.
              </Card.Body>
            </Card>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}
