import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Form,
  Modal,
  ProgressBar,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  FilePlus2,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { API_BASE } from "../../app/constants";

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
  showFeedback: (title: string, message: string, variant?: any) => void;
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
const EMPTY_STORY = {
  titulo: "",
  descripcion_markdown: "",
  criterios_aceptacion_markdown: "",
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
  const [detailItem, setDetailItem] = useState<{
    kind: "requirement" | "story";
    item: any;
  } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<any[] | null>(null);
  const [historyTitle, setHistoryTitle] = useState("");
  const [requirementStateFilter, setRequirementStateFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [storiesExpanded, setStoriesExpanded] = useState(false);
  const [storySearch, setStorySearch] = useState("");
  const [storyRequirementFilter, setStoryRequirementFilter] = useState("");
  const [storyStateFilter, setStoryStateFilter] = useState("");
  const [generationRequirement, setGenerationRequirement] = useState<any>(null);
  const [generationStep, setGenerationStep] = useState<
    "context" | "estimate" | "review"
  >("context");
  const [generationRun, setGenerationRun] = useState<any>(null);
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [generationWiki, setGenerationWiki] = useState<any[]>([]);
  const [generationWikiIds, setGenerationWikiIds] = useState<string[]>([]);
  const [generationComponentIds, setGenerationComponentIds] = useState<
    string[]
  >([]);
  const [generationMaxStories, setGenerationMaxStories] = useState(1);
  const [generationCandidates, setGenerationCandidates] = useState<any[]>([]);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [generationContextExpanded, setGenerationContextExpanded] =
    useState(true);
  const [expandedCandidateIndex, setExpandedCandidateIndex] = useState<
    number | null
  >(null);
  const [estimateExplanationVisible, setEstimateExplanationVisible] =
    useState(false);
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

  const load = async (force = false) => {
    if (!projectId || (!force && loadedProjectId.current === projectId)) return;
    if (loadedProjectId.current !== projectId) {
      setRequirements([]);
      setStories([]);
    }
    setLoading(true);
    try {
      const requirementsRequest = fetchWithAuth(
        `${API_BASE}/proyectos/${projectId}/requisitos/`,
      )
        .then(readJson)
        .then(setRequirements);
      const storiesRequest = fetchWithAuth(
        `${API_BASE}/proyectos/${projectId}/historias/`,
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
    setStoryForm(item ? { ...item } : EMPTY_STORY);
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
    try {
      setHistoryTitle(item.titulo);
      setHistoryEntries(
        await readJson(
          await fetchWithAuth(`${API_BASE}/${kind}/${item.id}/history/`),
        ),
      );
    } catch (error: any) {
      showFeedback("Historial", error.message, "danger");
    }
  };
  const openDetails = (kind: "requirement" | "story", item: any) =>
    setDetailItem({ kind, item });
  const storiesForRequirement = (requirementId: string) =>
    stories.filter((item) => item.requisito_id === requirementId);
  const archive = async (item: any, kind: "requisitos" | "historias") => {
    const resourceLabel = kind === "requisitos" ? "requisito" : "historia";
    const confirmed = await confirmAction({
      title: `Archivar ${resourceLabel}`,
      message: `${item.codigo} dejará de aparecer en los listados activos, pero conservará su historial y vínculos existentes.`,
      variant: "warning",
      confirmLabel: `Archivar ${resourceLabel}`,
    });
    if (!confirmed) return;
    try {
      await readJson(
        await fetchWithAuth(`${API_BASE}/${kind}/${item.id}/archive`, {
          method: "POST",
          body: JSON.stringify({ archivado: true }),
        }),
      );
      await load(true);
    } catch (error: any) {
      showFeedback("No se pudo archivar", error.message, "danger");
    }
  };
  const visibleRequirements = requirements.filter(
    (item) =>
      (!requirementStateFilter || item.estado === requirementStateFilter) &&
      (!priorityFilter || item.prioridad === priorityFilter),
  );
  const visibleStories = stories.filter((story) => {
    const search = storySearch.trim().toLocaleLowerCase();
    const requirement = requirementById.get(story.requisito_id);
    return (
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
    setGenerationContextExpanded(true);
    setExpandedCandidateIndex(null);
    setEstimateExplanationVisible(false);
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
      setGenerationStep("estimate");
      setGenerationContextExpanded(false);
      setEstimateExplanationVisible(false);
      const maxStories = run.estimacion?.cantidad_recomendada || 1;
      const generatedRun = await readJson(
        await fetchWithAuth(
          `${API_BASE}/generaciones-historias/${run.id}/generar`,
          {
            method: "POST",
            body: JSON.stringify({ max_historias: maxStories }),
          },
        ),
      );
      if (generatedRun.estado === "BLOQUEADA") {
        throw new Error(
          generatedRun.error_detalle || "La generación fue bloqueada.",
        );
      }
      setGenerationRun(generatedRun);
      setGenerationCandidates(
        (generatedRun.propuestas || []).map((item: any) => ({
          ...item,
          selected: true,
        })),
      );
      setGenerationStep("review");
      setExpandedCandidateIndex(null);
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
            body: JSON.stringify({ max_historias: generationMaxStories }),
          },
        ),
      );
      if (run.estado === "BLOQUEADA")
        throw new Error(run.error_detalle || "La generación fue bloqueada.");
      setGenerationRun(run);
      setGenerationCandidates(
        (run.propuestas || []).map((item: any) => ({
          ...item,
          selected: true,
        })),
      );
      setGenerationStep("review");
      setExpandedCandidateIndex(0);
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
  const applyCandidates = async () => {
    const historias = generationCandidates
      .filter((item) => item.selected)
      .map(({ selected, ...item }) => item);
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
      <Modal
        show={generationBusy}
        backdrop="static"
        keyboard={false}
        centered
        contentClassName="shadow-lg border-0"
      >
        <Modal.Body className="p-4">
          <div className="d-flex align-items-start gap-3">
            <Spinner
              animation="border"
              variant="primary"
              role="status"
              className="flex-shrink-0 mt-1"
            >
              <span className="visually-hidden">Procesando</span>
            </Spinner>
            <div className="flex-grow-1">
              <div className="fw-semibold fs-5">La IA está trabajando</div>
              <p className="mb-1 mt-1">
                {generationStep === "context"
                  ? "Analizando el requisito y el contexto seleccionado."
                  : generationStep === "estimate"
                    ? "Generando propuestas de historias para tu revisión."
                    : "Creando las historias seleccionadas."}
              </p>
              <div className="small text-muted">
                {generationElapsedSeconds}s transcurridos
                {generationElapsedSeconds >= 30
                  ? ". El modelo sigue procesando la solicitud."
                  : "."}
              </div>
            </div>
          </div>
          <ProgressBar
            animated
            now={100}
            variant="primary"
            className="mt-3"
            style={{ height: "5px" }}
          />
        </Modal.Body>
      </Modal>
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
            value={requirementStateFilter}
            onChange={(event) => setRequirementStateFilter(event.target.value)}
            aria-label="Filtrar por estado"
          >
            <option value="">Estados</option>
            {["BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO"].map((item) => (
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
      <Card className="border-0 shadow-sm mb-4 overflow-hidden">
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
                      .join(", ") || "Todos"}
                  </td>
                  <td>
                    <div className="small fw-semibold">
                      {relatedStories.length} historias
                    </div>
                    {relatedStories.map((story) => (
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
                          <Badge bg="warning" text="dark">
                            Revision
                          </Badge>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="text-end">
                    <div className="d-inline-flex gap-1">
                      <Button
                        variant="light"
                        className="border"
                        size="sm"
                        title="Ver requisito"
                        aria-label={`Ver requisito ${requirement.codigo}`}
                        onClick={() => openDetails("requirement", requirement)}
                      >
                        <Eye size={14} />
                      </Button>
                      <Button
                        variant="light"
                        className="border"
                        size="sm"
                        title="Historial"
                        onClick={() => openHistory(requirement, "requisitos")}
                      >
                        <History size={14} />
                      </Button>
                      {canEdit && (
                        <>
                          <Button
                            variant="light"
                            className="border"
                            size="sm"
                            title="Editar requisito"
                            aria-label={`Editar requisito ${requirement.codigo}`}
                            onClick={() => openRequirement(requirement)}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="light"
                            className="border"
                            size="sm"
                            title="Archivar"
                            onClick={() => archive(requirement, "requisitos")}
                          >
                            <Archive size={14} />
                          </Button>
                          <Button
                            variant="light"
                            className="border text-primary"
                            size="sm"
                            title="Generar historias con IA"
                            aria-label={`Generar historias para ${requirement.codigo}`}
                            onClick={() => openGeneration(requirement)}
                          >
                            <Sparkles size={14} />
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            title="Nueva historia"
                            onClick={() => openStory(undefined, requirement.id)}
                          >
                            <Plus size={14} />
                          </Button>
                        </>
                      )}
                    </div>
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
      <Card className="border-0 shadow-sm overflow-hidden">
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
                    {["BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA"].map(
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
                      <td className="small">
                        {requirement?.codigo || story.requisito_codigo}
                      </td>
                      <td>
                        <Badge bg="secondary">{story.estado}</Badge>
                      </td>
                      <td>
                        {story.case_count}{" "}
                        {story.requiere_revision_count > 0 && (
                          <Badge bg="warning" text="dark">
                            Revision
                          </Badge>
                        )}
                      </td>
                      <td className="text-end">
                        <Button
                          variant="light"
                          size="sm"
                          className="border me-1"
                          onClick={() => openDetails("story", story)}
                          title="Ver historia"
                          aria-label={`Ver historia ${story.codigo}`}
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          variant="light"
                          size="sm"
                          className="border me-1"
                          onClick={() => openHistory(story, "historias")}
                          title="Historial"
                        >
                          <History size={14} />
                        </Button>
                        {canEdit && (
                          <>
                            <Button
                              variant="light"
                              size="sm"
                              className="border me-1"
                              onClick={() => openStory(story)}
                              title="Editar historia"
                              aria-label={`Editar historia ${story.codigo}`}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="light"
                              size="sm"
                              className="border me-1"
                              onClick={() => archive(story, "historias")}
                              title="Archivar"
                            >
                              <Archive size={14} />
                            </Button>
                          </>
                        )}
                        {canEdit && (
                          <Button
                            variant="success"
                            size="sm"
                            className="rounded-pill px-3"
                            onClick={() =>
                              onCreateCaseFromStory(story, requirement)
                            }
                          >
                            <FilePlus2 size={14} className="me-1" /> Caso
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleStories.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-3">
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
      >
        <Form onSubmit={saveRequirement}>
          <Modal.Header closeButton>
            <Modal.Title>
              {editingRequirement ? "Editar requisito" : "Nuevo requisito"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
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
      <Modal
        show={showStoryModal}
        onHide={() => setShowStoryModal(false)}
        size="lg"
      >
        <Form onSubmit={saveStory}>
          <Modal.Header closeButton>
            <Modal.Title>
              {editingStory ? "Editar historia" : "Nueva historia"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
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
                <Form.Label>Descripcion Markdown</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={storyForm.descripcion_markdown}
                  onChange={(event) =>
                    setStoryForm({
                      ...storyForm,
                      descripcion_markdown: event.target.value,
                    })
                  }
                />
              </Col>
              <Col xs={12}>
                <Form.Label>Criterios de aceptacion Markdown</Form.Label>
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
                />
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
      >
        <Modal.Header closeButton>
          <Modal.Title>Generar historias con IA</Modal.Title>
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
                <Collapse in={generationContextExpanded}>
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
                </Collapse>
              </div>
              {generationRun && (
                <div className="border-start border-primary border-3 bg-light px-3 py-2">
                  <Row className="align-items-center g-2">
                    <Col md="auto">
                      <div className="small text-uppercase text-muted fw-semibold">
                        Estimación
                      </div>
                      <div className="fs-4 fw-bold lh-1">
                        {generationRun.estimacion?.cantidad_recomendada}{" "}
                        historias
                      </div>
                      <div className="small text-muted">
                        Rango: {generationRun.estimacion?.rango_min} a{" "}
                        {generationRun.estimacion?.rango_max}
                      </div>
                    </Col>
                    <Col className="d-flex align-items-center">
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
                    </Col>
                    {generationCandidates.length === 0 && (
                      <Col md={2}>
                        <Form.Label className="small mb-1">Máximo</Form.Label>
                        <Form.Control
                          size="sm"
                          type="number"
                          min={1}
                          max={20}
                          value={generationMaxStories}
                          onChange={(event) =>
                            setGenerationMaxStories(
                              Math.max(
                                1,
                                Math.min(20, Number(event.target.value) || 1),
                              ),
                            )
                          }
                        />
                      </Col>
                    )}
                  </Row>
                  {estimateExplanationVisible && (
                    <div className="small border-top mt-2 pt-2">
                      {generationRun.estimacion?.justificacion}
                    </div>
                  )}
                </div>
              )}
              {generationCandidates.length > 0 && (
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
                              <span className="fw-semibold">US-NUEVA</span>{" "}
                              {candidate.titulo}
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
                                  expandedCandidateIndex === index
                                    ? "Ocultar historia"
                                    : "Ver y editar historia"
                                }
                                aria-label={
                                  expandedCandidateIndex === index
                                    ? "Ocultar historia"
                                    : "Ver y editar historia"
                                }
                                onClick={() =>
                                  setExpandedCandidateIndex((current) =>
                                    current === index ? null : index,
                                  )
                                }
                              >
                                <Eye size={14} />
                              </Button>
                              <Form.Check
                                inline
                                className="d-inline-block align-middle mb-0"
                                title={
                                  candidate.selected
                                    ? "Incluir al crear"
                                    : "Excluir de la creación"
                                }
                                aria-label={
                                  candidate.selected
                                    ? "Incluir al crear"
                                    : "Excluir de la creación"
                                }
                                checked={candidate.selected}
                                onChange={() =>
                                  setGenerationCandidates((previous) =>
                                    previous.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, selected: !item.selected }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </td>
                          </tr>
                          {expandedCandidateIndex === index && (
                            <tr
                              key={`candidate-detail-${index}`}
                              className="bg-light"
                            >
                              <td colSpan={5} className="p-3">
                                <Row className="g-3">
                                  <Col md={8}>
                                    <Form.Label className="small fw-semibold">
                                      Título
                                    </Form.Label>
                                    <Form.Control
                                      size="sm"
                                      value={candidate.titulo}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  titulo: event.target.value,
                                                }
                                              : item,
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
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  prioridad: event.target.value,
                                                }
                                              : item,
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
                                      Descripción Markdown
                                    </Form.Label>
                                    <Form.Control
                                      as="textarea"
                                      rows={4}
                                      value={candidate.descripcion_markdown}
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  descripcion_markdown:
                                                    event.target.value,
                                                }
                                              : item,
                                          ),
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col md={6}>
                                    <Form.Label className="small fw-semibold">
                                      Criterios de aceptación Markdown
                                    </Form.Label>
                                    <Form.Control
                                      as="textarea"
                                      rows={4}
                                      value={
                                        candidate.criterios_aceptacion_markdown
                                      }
                                      onChange={(event) =>
                                        setGenerationCandidates((previous) =>
                                          previous.map((item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  criterios_aceptacion_markdown:
                                                    event.target.value,
                                                }
                                              : item,
                                          ),
                                        )
                                      }
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
        <Modal.Footer>
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
                setExpandedCandidateIndex(null);
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
                ? "Generando vista previa..."
                : "Generar historias"}
            </Button>
          )}
          {generationRun && generationCandidates.length === 0 && (
            <Button
              disabled={generationBusy}
              onClick={() => void generateCandidates()}
            >
              {generationBusy ? "Generando..." : "Generar propuestas"}
            </Button>
          )}
          {generationCandidates.length > 0 && (
            <Button
              disabled={generationBusy || selectedCandidateCount === 0}
              onClick={() => void applyCandidates()}
            >
              {generationBusy
                ? "Creando..."
                : `Crear ${selectedCandidateCount} historias`}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
      <Modal
        show={Boolean(detailItem)}
        onHide={() => setDetailItem(null)}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {detailItem?.kind === "requirement" ? "Requisito" : "Historia"}:{" "}
            {detailItem?.item.codigo}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
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
                <div
                  className="border rounded p-3 bg-light markdown-preview"
                  style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}
                >
                  {detailItem.item.descripcion_markdown ||
                    "Sin descripcion registrada."}
                </div>
              </Col>
              {detailItem.kind === "story" && (
                <>
                  <Col xs={12}>
                    <div className="small fw-bold text-uppercase text-muted mb-1">
                      Criterios de aceptacion
                    </div>
                    <div
                      className="border rounded p-3 bg-light markdown-preview"
                      style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}
                    >
                      {detailItem.item.criterios_aceptacion_markdown ||
                        "Sin criterios de aceptacion registrados."}
                    </div>
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
                      Cobertura
                    </div>
                    <div>
                      {detailItem.item.case_count || 0} casos de prueba
                      vinculados
                    </div>
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
        show={Boolean(historyEntries)}
        onHide={() => setHistoryEntries(null)}
      >
        <Modal.Header closeButton>
          <Modal.Title>Historial: {historyTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {historyEntries?.map((entry) => (
            <div key={entry.id} className="border-bottom py-2">
              <div className="small text-muted">
                {new Date(entry.fecha_edicion).toLocaleString()}
              </div>
              <strong>{entry.comentario_cambio || "Cambio registrado"}</strong>
            </div>
          ))}
        </Modal.Body>
      </Modal>
    </div>
  );
}
