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
import { useI18n } from '../../i18n'
import { useTraceabilityGenerationState } from './useTraceabilityGenerationState'
import { useTraceabilityHistory } from './useTraceabilityHistory'
import { useTraceabilityCrud } from './useTraceabilityCrud'
import { useTraceabilityDetails } from './useTraceabilityDetails'
import { useTraceabilityGenerationActions } from './useTraceabilityGenerationActions'
import { TraceabilityTables } from './TraceabilityTables'
import { TraceabilityEditorModals } from './TraceabilityEditorModals'
import { TraceabilityHistoryModals } from './TraceabilityHistoryModals'
import { TraceabilityGenerationContext } from './TraceabilityGenerationContext'
import { TraceabilityGenerationResults } from './TraceabilityGenerationResults'
import { TraceabilityGenerationModal } from './TraceabilityGenerationModal'
import { useTraceabilityViewState } from './useTraceabilityViewState'

const traceabilityUi = {
  es: {
    coverageSubtitle: "Cobertura funcional y origen de los casos de prueba.",
    showArchived: "Mostrar elementos archivados", active: "Activos", archived: "Archivados", all: "Todos",
    states: "Estados", priorities: "Prioridades", requirement: "Requisito", story: "Historia", stories: "Historias",
    components: "Componentes", storiesCoverage: "Historias y cobertura", actions: "Acciones", externalReference: "Referencia externa",
    noComponent: "Componente", noComponentDefined: "Sin componente definido", case: "caso", cases: "casos", moreStory: "historia más", moreStories: "historias más",
    viewRequirement: "Ver requisito", generateWithAi: "Generar con IA", createStory: "Crear historia", editRequirement: "Editar requisito",
    restoreRequirement: "Restaurar requisito", archiveRequirement: "Archivar requisito", noRequirements: "No hay requisitos para los filtros seleccionados.",
    collapseStories: "Contraer historias", expandStories: "Expandir historias", visible: "visibles", searchStories: "Buscar por código, historia o requisito",
    allRequirements: "Todos los requisitos", allStates: "Todos los estados", created: "Creada", createCase: "Crear caso", viewStory: "Ver historia",
    editStory: "Editar historia", restoreStory: "Restaurar historia", archiveStory: "Archivar historia", noStories: "No hay historias para los filtros seleccionados.",
    editRequirementTitle: "Editar requisito", newRequirementTitle: "Nuevo requisito", title: "Título", priority: "Prioridad", state: "Estado",
    descriptionMarkdown: "Descripción Markdown", optionalExternalTicket: "Ticket externo opcional", provider: "Proveedor", referenceUrl: "Referencia / URL opcional",
    idOrUrl: "ID o URL", affectedComponents: "Componentes afectados", selectRequirement: "Seleccionar requisito", close: "Cerrar", cancel: "Cancelar",
    editStoryTitle: "Editar historia", newStoryTitle: "Nueva historia", userStory: "Historia de usuario", recommendedFormat: "Formato recomendado",
    userStoryExample: "Como [rol o usuario], quiero [acción o funcionalidad], para [beneficio o valor].", acceptanceMarkdown: "Criterios de aceptación Markdown",
    structuredAcceptance: "Criterios de aceptación estructurados", acceptanceHint: "Definí el comportamiento verificable. Estos criterios quedan vinculados a los casos de prueba y habilitan la generación asistida.",
    externalProvider: "Proveedor externo", externalUrl: "URL externa", stages: "Etapas de generación", processing: "Procesando", aiWorking: "La IA está trabajando",
    context: "Contexto", analysis: "Análisis", configuration: "Configuración", review: "Revisión", contextForAi: "Contexto para IA", collapseContext: "Contraer contexto", expandContext: "Expandir contexto",
    optionalInstructions: "Instrucciones opcionales", instructionsPlaceholder: "Foco, exclusiones o criterios que deben considerarse.", contextComponents: "Componentes de contexto", optionalWiki: "Páginas Wiki opcionales",
    readyContext: "Contexto listo para continuar", incompleteContext: "Contexto incompleto: podés continuar con supuestos", blockedAnalysis: "Análisis bloqueado", hideExplanation: "Ocultar explicación", showExplanation: "Ver explicación",
    ambiguities: "Ambigüedades:", proposedAssumptions: "Supuestos propuestos:", answerContext: "Respuestas para completar el contexto", answerPlaceholder: "Opcional: dejalo vacío si QA no cuenta con este dato.",
    suggestedStories: "Historias sugeridas", generatedDrafts: "Borradores generados", completed: "completados", noCompleteDraft: "Todavía no hay un borrador completo para mostrar.",
    coveredProposal: "propuesta ya está cubierta", coveredProposals: "propuestas ya están cubiertas", existing: "existente:", noNewDrafts: "No se generaron borradores nuevos",
    insertionPreview: "Vista previa de inserción", proposal: "Propuesta", userStoryType: "Historia de usuario", technicalStory: "Historia técnica", coveredIntent: "Intención ya cubierta", similarStory: "Historia similar existente",
    draft: "Borrador", hideDetail: "Ocultar detalle", viewEditDetail: "Ver y editar detalle", viewDetail: "Ver detalle", excludeCreation: "Excluir de la creación", includeCritical: "Incluir y revisar observaciones críticas", includeCreation: "Incluir al crear", includeCriticalAria: "Incluir propuesta que requiere revisión", excludeCriticalAria: "Excluir propuesta que requiere revisión",
    quality: "Calidad", rulesPass: "La propuesta cumple las reglas automáticas.", equivalentIntent: "La IA detectó una intención funcional equivalente.", equivalentIntentShort: "intención equivalente", similarTitle: "Historias existentes con un título similar.", equalTitle: "título igual", similarTitleShort: "título parecido", save: "Guardar", generateStoriesWithAi: "Generar historias con IA", analyzingRequirementContext: "Analizando el requisito y el contexto seleccionado.", updatingAnalysisAnswers: "Actualizando el análisis con las respuestas proporcionadas.", generatingDraftProgress: "Generando borrador {current} de {total}. Los resultados válidos aparecen a medida que se completan.", creatingSelectedDrafts: "Creando los borradores seleccionados.", noWikiPages: "No hay páginas Wiki disponibles.", analysisResult: "Resultado del análisis", readyAnalysisHint: "Respondé solo lo que conozcas y continuá para definir cuántas propuestas querés revisar.", incompleteAnalysisHint: "Respondé solo lo que conozcas. Las preguntas sin respuesta quedarán registradas como pendientes y no impiden generar borradores.", optionalAnswers: "Son opcionales. Se incluirán en la generación y quedarán asociadas a esta revisión.", scopeProposal: "Propuesta de alcance", scopeHint: "Antes de crear borradores, se compara la intención de estas propuestas con las historias activas del proyecto. Las ya cubiertas no consumen una generación.", proposalPrefix: "Propuesta {number}:", draftPrefix: "Borrador {number}:", allScopeCovered: "Todas las propuestas del alcance ya están cubiertas por historias activas. Podés volver al análisis si el requisito requiere una capacidad distinta.", selectedCount: "seleccionadas", externalReferenceLabel: "Referencia externa", historyInitial: "Versión inicial", viewChanges: "Ver cambios", historyNoPrevious: "No hay versión anterior para comparar.", comparePrevious: "Comparar con la versión anterior", versionDifferences: "Diferencias de versión", modificationLabel: "Modificación:", noChangeCommentText: "Sin comentario de cambio.", noDifferencesText: "No se detectaron diferencias con la versión anterior.", previousLabel: "Anterior", currentLabel: "Actual", oldestVersionText: "Esta es la versión más antigua, no hay versión anterior para comparar.", linkedStoriesEmpty: "Este requisito todavía no tiene historias vinculadas.", closeModal: "Cerrar", qualityLabelText: "Calidad: {label}.", reviewScopeText: "Revisá si esta propuesta aporta un alcance distinto antes de seleccionarla. La decisión final es tuya.", criticalOverrideText: "Entiendo las observaciones críticas y decido crear este borrador.", decisionJustificationText: "Justificación de la decisión", qualityReasonPlaceholder: "Explicá por qué esta propuesta debe crearse pese a las observaciones.", titleLabel: "Título", priorityLabel: "Prioridad", descriptionLabel: "Descripción", acceptanceLabel: "Criterios de aceptación", proposalCovered: "propuesta ya está cubierta", proposalsCovered: "propuestas ya están cubiertas", existingLabel: "existente:", allScopeCoveredText: "Todas las propuestas del alcance ya están cubiertas por historias activas. Podés volver al análisis si el requisito requiere una capacidad distinta.",
    recommendedFormatLabel: "Formato recomendado", storyExample: "Como analista de calidad, quiero consultar el resumen de ejecución, para identificar riesgos antes de liberar una build.", acceptanceHintShort: "Definí el comportamiento verificable. Estos criterios quedan vinculados a los casos de prueba y habilitan la generación asistida.", casesCreatedTitle: "Casos creados", casesCreatedMessage: "{count} casos manuales quedaron creados y trazados para revisión.",
    generationNotice: "Las propuestas no se crearán hasta que las revises y confirmes.", stageContext: "1. Contexto", stageAnalyze: "2. Analizar requisito", stageGenerate: "3. Generar propuestas", stageReview: "4. Revisar borradores", busyContext: "Analizando el requisito y el contexto seleccionado.", busyAnalysis: "Actualizando el análisis con las respuestas proporcionadas.", busyConfiguration: "Preparando la generación de propuestas.", busyReview: "Creando los borradores seleccionados.", proposalLabel: "Propuesta {count}", draftsCompleted: "{completed} de {requested} completados", selected: "seleccionadas", reviewScope: "Revisá si esta propuesta aporta un alcance distinto antes de seleccionarla. La decisión final es tuya.", storyFallback: "Historia", qualityLabel: "Calidad: {label}.", qualityPassDetail: "La propuesta cumple las reglas automáticas.", criticalOverrideLabel: "Entiendo las observaciones críticas y decido crear este borrador.", decisionJustification: "Justificación de la decisión", backContext: "Volver a contexto", quantityDrafts: "Cantidad de borradores", generateDraft: "Generar {count} borrador", generateDrafts: "Generar {count} borradores", proposals: "Propuestas", generateProposal: "Generar {count} propuesta", generateProposals: "Generar {count} propuestas", confirmCritical: "Confirmá y justificá las propuestas que requieren revisión.", createDraftsCount: "Crear {count} borradores",
    analyzing: "Analizando...", analyzeRequirement: "Analizar requisito", saving: "Guardando...", continueAssumptions: "Continuar con supuestos de trabajo", criticalAssumptions: "Los supuestos críticos requieren esta confirmación explícita.", pauseAuto: "Pausar continuación automática", resumeAuto: "Reanudar continuación automática", updating: "Actualizando...", continueScope: "Continuar y calcular alcance", backAnalysis: "Volver al análisis", draftCount: "Cantidad de borradores", proposalCount: "Propuestas", generating: "Generando...", creating: "Creando...", createDrafts: "Crear borradores", confirmReview: "Confirmá y justificá las propuestas que requieren revisión.",
    detail: "Detalle", description: "Descripción", noDescription: "Sin descripción registrada.", acceptance: "Criterios de aceptación", noAcceptance: "Sin criterios de aceptación registrados.", relatedRequirement: "Requisito relacionado", unavailable: "No disponible", linkedCases: "Casos de prueba vinculados", loadingCases: "Cargando casos vinculados…", noLinkedCases: "Sin casos vinculados.", linkedStories: "Historias vinculadas", noLinkedStories: "Este requisito todavía no tiene historias vinculadas.", view: "Ver", historyOf: "Historial del", noPreviousVersion: "No hay versión anterior para comparar.", oldestVersion: "Esta es la versión más antigua", initialVersion: "Versión inicial", modification: "Modificación:", noChangeComment: "Sin comentario de cambio.", noDifferences: "No se detectaron diferencias con la versión anterior.", previous: "Anterior", current: "Actual", noOlderVersion: "Esta es la versión más antigua, no hay versión anterior para comparar.", unknownUser: "Usuario desconocido", yes: "sí", no: "no", pendingReview: "Revisión pendiente", pendingReviews: "Revisiones pendientes: {count}", qualityPass: "Apta", qualityFail: "Requiere revisión", qualityWarn: "Con advertencias"
    ,changesRecorded: "Los cambios y su historial quedaron registrados.", saveFailed: "No se pudo guardar", storyRecorded: "La historia y sus criterios de aceptación quedaron registrados.", historyState: "Estado", historyPriority: "Prioridad", externalProviderHistory: "Proveedor externo", externalReferenceHistory: "Referencia externa", externalUrlHistory: "URL externa", archiveAction: "{action} {resource}", archiveMessage: "{code} dejará de aparecer en los listados activos, pero conservará su historial y vínculos existentes.", restoreMessage: "{code} volverá a los listados activos conservando su historial y vínculos existentes.", requirementResource: "requisito", storyResource: "historia", archiveLabel: "Archivar", restoreLabel: "Restaurar", stateUpdated: "Estado actualizado", stateUpdateFailed: "No se pudo actualizar el estado", tryAgain: "Intenta nuevamente.", updateStateMessage: "{code} ahora está {state}.", generationTitle: "Generación de historias", previewGenerationFailed: "No se pudo generar la vista previa de historias.", proposalsGenerationFailed: "No se pudieron generar propuestas.", analysisTitle: "Análisis del requisito", analysisUpdateFailed: "No se pudo actualizar el análisis.", scopeUpdateFailed: "No se pudo actualizar la propuesta de alcance.", pendingAssumptionsTitle: "Supuestos pendientes", assumptionsConfirmFailed: "No se pudieron confirmar los supuestos.", storiesCreatedTitle: "Historias creadas", storiesCreatedMessage: "{count} historias quedaron en borrador para revisión.", storiesCreateFailed: "No se pudieron crear las historias",
  },
  en: {
    coverageSubtitle: "Functional coverage and origin of test cases.", showArchived: "Show archived items", active: "Active", archived: "Archived", all: "All",
    states: "States", priorities: "Priorities", requirement: "Requirement", story: "Story", stories: "Stories", components: "Components", storiesCoverage: "Stories and coverage", actions: "Actions", externalReference: "External reference",
    noComponent: "Component", noComponentDefined: "No component defined", case: "case", cases: "cases", moreStory: "more story", moreStories: "more stories", viewRequirement: "View requirement", generateWithAi: "Generate with AI", createStory: "Create story", editRequirement: "Edit requirement", restoreRequirement: "Restore requirement", archiveRequirement: "Archive requirement", noRequirements: "No requirements match the selected filters.", collapseStories: "Collapse stories", expandStories: "Expand stories", visible: "visible", searchStories: "Search by code, story or requirement", allRequirements: "All requirements", allStates: "All states", created: "Created", createCase: "Create case", viewStory: "View story", editStory: "Edit story", restoreStory: "Restore story", archiveStory: "Archive story", noStories: "No stories match the selected filters.",
    editRequirementTitle: "Edit requirement", newRequirementTitle: "New requirement", title: "Title", priority: "Priority", state: "Status", descriptionMarkdown: "Markdown description", optionalExternalTicket: "Optional external ticket", provider: "Provider", referenceUrl: "Optional reference / URL", idOrUrl: "ID or URL", affectedComponents: "Affected components", selectRequirement: "Select requirement", close: "Close", cancel: "Cancel", save: "Save", generateStoriesWithAi: "Generate stories with AI", analyzingRequirementContext: "Analyzing the requirement and selected context.", updatingAnalysisAnswers: "Updating the analysis with the provided answers.", generatingDraftProgress: "Generating draft {current} of {total}. Valid results appear as they are completed.", creatingSelectedDrafts: "Creating the selected drafts.", noWikiPages: "No Wiki pages available.", analysisResult: "Analysis result", readyAnalysisHint: "Answer only what you know and continue to define how many proposals you want to review.", incompleteAnalysisHint: "Answer only what you know. Unanswered questions will be recorded as pending and do not prevent draft generation.", optionalAnswers: "They are optional. They will be included in generation and associated with this review.", scopeProposal: "Scope proposal", scopeHint: "Before creating drafts, these proposals' intent is compared with the project's active stories. Covered proposals do not consume a generation.", proposalPrefix: "Proposal {number}:", draftPrefix: "Draft {number}:", coveredProposal: "proposal is already covered", coveredProposals: "proposals are already covered", existing: "existing:", allScopeCovered: "All scope proposals are already covered by active stories. You can return to the analysis if the requirement needs a different capability.", selectedCount: "selected", pendingReview: "Review pending", pendingReviews: "Reviews pending: {count}", generationNotice: "Proposals will not be created until you review and confirm them.", stageContext: "1. Context", stageAnalyze: "2. Analyze requirement", stageGenerate: "3. Generate proposals", stageReview: "4. Review drafts", busyContext: "Analyzing the requirement and selected context.", busyAnalysis: "Updating the analysis with the provided answers.", busyConfiguration: "Preparing proposal generation.", busyReview: "Creating the selected drafts.", proposalLabel: "Proposal {count}", draftsCompleted: "{completed} of {requested} completed", selected: "selected", reviewScope: "Review whether this proposal adds a different scope before selecting it. The final decision is yours.", storyFallback: "Story", qualityLabel: "Quality: {label}.", qualityPassDetail: "The proposal meets the automatic rules.", criticalOverrideLabel: "I understand the critical observations and choose to create this draft.", decisionJustification: "Decision justification", equivalentIntentShort: "equivalent intent", similarTitle: "Existing stories with a similar title.", equalTitle: "same title", similarTitleShort: "similar title", backContext: "Back to context", quantityDrafts: "Number of drafts", generateDraft: "Generate {count} draft", generateDrafts: "Generate {count} drafts", proposals: "Proposals", generateProposal: "Generate {count} proposal", generateProposals: "Generate {count} proposals", confirmCritical: "Confirm and justify proposals requiring review.", createDraftsCount: "Create {count} drafts", detail: "Detail", description: "Description", noDescription: "No description recorded.", acceptance: "Acceptance criteria", noAcceptance: "No acceptance criteria recorded.", relatedRequirement: "Related requirement", unavailable: "Not available", linkedCases: "Linked test cases", loadingCases: "Loading linked cases…", noLinkedCases: "No linked cases.", linkedStories: "Linked stories", noLinkedStories: "This requirement has no linked stories yet.", view: "View", historyOf: "History of", versionDifferences: "Version differences", noPreviousVersion: "No previous version to compare.", comparePrevious: "Compare with previous version", oldestVersion: "This is the oldest version", initialVersion: "Initial version", modification: "Modification:", noChangeComment: "No change comment.", noDifferences: "No differences detected from the previous version.", previous: "Previous", current: "Current", noOlderVersion: "This is the oldest version; there is no previous version to compare.", unknownUser: "Unknown user", yes: "yes", no: "no", qualityPass: "Pass", qualityFail: "Requires review", qualityWarn: "With warnings",
    changesRecorded: "Changes and history were recorded.", saveFailed: "Could not save", storyRecorded: "The story and its acceptance criteria were recorded.", historyState: "Status", historyPriority: "Priority", externalProviderHistory: "External provider", externalReferenceHistory: "External reference", externalUrlHistory: "External URL", archiveAction: "{action} {resource}", archiveMessage: "{code} will no longer appear in active lists, but its history and existing links will be preserved.", restoreMessage: "{code} will return to active lists with its history and existing links preserved.", requirementResource: "requirement", storyResource: "story", archiveLabel: "Archive", restoreLabel: "Restore", stateUpdated: "Status updated", stateUpdateFailed: "Could not update the status", tryAgain: "Try again.", updateStateMessage: "{code} is now {state}.", generationTitle: "Story generation", previewGenerationFailed: "Could not generate the story preview.", proposalsGenerationFailed: "Could not generate proposals.", analysisTitle: "Requirement analysis", analysisUpdateFailed: "Could not update the analysis.", scopeUpdateFailed: "Could not update the proposed scope.", pendingAssumptionsTitle: "Pending assumptions", assumptionsConfirmFailed: "Could not confirm the assumptions.", storiesCreatedTitle: "Stories created", storiesCreatedMessage: "{count} stories were left as drafts for review.", storiesCreateFailed: "Could not create the stories",
  }
} as const

type TraceabilityTextKey = keyof typeof traceabilityUi.es
const interpolateTraceability = (value: string | undefined, params?: Record<string, string | number>) => String(value ?? '').replace(/\{(\w+)\}/g, (match, name) => params?.[name] === undefined ? match : String(params[name]))

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
  if (quality === "PASS") return { label: "qualityPass", variant: "success" };
  if (quality === "FAIL") return { label: "qualityFail", variant: "danger" };
  return { label: "qualityWarn", variant: "warning" };
};

const ReviewPendingIcon = ({ count, tooltipId }: { count: number; tooltipId: string }) => {
  const { locale } = useI18n();
  const pending = count > 0 ? count : 1;
  const message = interpolateTraceability(
    pending === 1
      ? traceabilityUi[locale].pendingReview || traceabilityUi.es.pendingReview
      : traceabilityUi[locale].pendingReviews || traceabilityUi.es.pendingReviews,
    { count: pending },
  );

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
  const { t, locale } = useI18n()
  const tx = (key: TraceabilityTextKey, params?: Record<string, string | number>) => interpolateTraceability(traceabilityUi[locale][key] || traceabilityUi.es[key] || key, params)
  const [requirements, setRequirements] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [storiesExpanded, setStoriesExpanded] = useState(false);
  const {
    caseGenerationStory, setCaseGenerationStory, detailItem, setDetailItem,
    linkedStoryCases, linkedStoryCasesLoading, openDetails, storiesForRequirement,
  } = useTraceabilityDetails({ stories, fetchWithAuth, readJson })
  const {
    requirementForm, setRequirementForm, storyForm, setStoryForm, editingRequirement,
    setEditingRequirement, editingStory, setEditingStory, storyRequirementId, setStoryRequirementId,
    showRequirementModal, setShowRequirementModal, showStoryModal, setShowStoryModal,
    openRequirement, saveRequirement, openStory, saveStory,
  } = useTraceabilityCrud({
    projectId, fetchWithAuth, readJson, showFeedback, tx, emptyRequirement: EMPTY_REQUIREMENT,
    emptyStory: EMPTY_STORY, setRequirements, setStories,
  })
  const {
    generationRequirement, setGenerationRequirement, generationStep, setGenerationStep, generationRun, setGenerationRun,
    generationInstructions, setGenerationInstructions, generationWiki, setGenerationWiki, generationWikiIds, setGenerationWikiIds,
    generationComponentIds, setGenerationComponentIds, generationMaxStories, setGenerationMaxStories, generationQuestionAnswers,
    setGenerationQuestionAnswers, generationCandidates, setGenerationCandidates, generationBusy, setGenerationBusy,
    generationElapsedSeconds, setGenerationElapsedSeconds, generationContextExpanded, setGenerationContextExpanded,
    expandedCandidateIndexes, setExpandedCandidateIndexes, estimateExplanationVisible, setEstimateExplanationVisible,
    autoContinuePaused, setAutoContinuePaused, autoContinueRemaining, setAutoContinueRemaining, generationHasActionableReview,
    generationHasCriticalAssumptions, loadedProjectId, projectComponents, requirementById, selectedCandidateCount,
    selectedCriticalCandidatesNeedDecision, generationProgress, generationRequestedCount, generationCompletedCount,
    preflightDuplicateCheck, preflightExcludedStories, updateGenerationCandidate,
  } = useTraceabilityGenerationState({ components, projectId, requirements, proposalQuality })
  const {
    openGeneration, estimateGeneration, generateCandidates, recalculateGenerationScope,
    confirmAssumptions, canAutoContinue, applyCandidates,
  } = useTraceabilityGenerationActions({
    projectId, fetchWithAuth, readJson, showFeedback, tx, hasSimilarStory,
    generationRequirement, setGenerationRequirement, generationStep, setGenerationStep,
    generationRun, setGenerationRun, generationInstructions, generationWikiIds,
    generationComponentIds, generationQuestionAnswers, generationMaxStories, setGenerationMaxStories,
    setGenerationWiki, setGenerationCandidates, setGenerationBusy, setGenerationContextExpanded,
    setEstimateExplanationVisible, setGenerationInstructions, setGenerationQuestionAnswers,
    setGenerationComponentIds, setGenerationWikiIds, setExpandedCandidateIndexes,
    setAutoContinuePaused, setAutoContinueRemaining, generationCandidates,
    generationHasActionableReview, generationHasCriticalAssumptions, generationBusy,
    autoContinuePaused, setStories, setStoriesExpanded,
  })
  const {
    loading,
    setLoading,
    archiveVisibility,
    setArchiveVisibility,
    requirementStateFilter,
    setRequirementStateFilter,
    priorityFilter,
    setPriorityFilter,
    storySearch,
    setStorySearch,
    storyRequirementFilter,
    setStoryRequirementFilter,
    storyStateFilter,
    setStoryStateFilter,
    load,
    historyEntries,
    historyKind,
    historyTitle,
    historyCode,
    historyDiff,
    openHistory,
    historyDisplayActor,
    openHistoryDiff,
    historyDiffRows,
    setHistoryEntries,
    setHistoryKind,
    setHistoryTitle,
    setHistoryCode,
    setHistoryDiff,
    setArchived,
    changeStoryState,
  } = useTraceabilityViewState({
    active, projectId, refreshToken, requirements, stories, setRequirements, setStories,
    fetchWithAuth, readJson, showFeedback, t, tx, loadedProjectId,
    generationBusy, generationRun, generationStep, setGenerationElapsedSeconds,
    setGenerationRun, setGenerationCandidates, hasSimilarStory, confirmAction,
  })

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
  return (
    <div className="traceability-tab animate__animated animate__fadeIn h-100 d-flex flex-column">
      <TraceabilityTables options={{
        t,
        tx,
        archiveVisibility,
        setArchiveVisibility,
        load,
        loading,
        requirementStateFilter,
        setRequirementStateFilter,
        priorityFilter,
        setPriorityFilter,
        canEdit,
        openRequirement,
        visibleRequirements,
        storiesForRequirement,
        projectComponents,
        ReviewPendingIcon,
        openDetails,
        openGeneration,
        openStory,
        openHistory,
        setArchived,
        storiesExpanded,
        setStoriesExpanded,
        stories,
        visibleStories,
        storySearch,
        setStorySearch,
        requirements,
        storyRequirementFilter,
        setStoryRequirementFilter,
        storyStateFilter,
        setStoryStateFilter,
        requirementById,
        formatDateTime,
        changeStoryState,
        onCreateCaseFromStory,
        setCaseGenerationStory,
      }} />
      <TraceabilityEditorModals options={{
        showRequirementModal,
        setShowRequirementModal,
        saveRequirement,
        editingRequirement,
        tx,
        requirementForm,
        setRequirementForm,
        projectComponents,
        toggleRequirementComponent,
        caseGenerationStory,
        fetchWithAuth,
        setCaseGenerationStory,
        showFeedback,
        showStoryModal,
        setShowStoryModal,
        saveStory,
        editingStory,
        storyRequirementId,
        setStoryRequirementId,
        requirements,
        storyForm,
        setStoryForm,
        t,
      }} />
      <TraceabilityGenerationModal options={{
        generationRequirement,
        setGenerationRequirement,
        generationBusy,
        t,
        tx,
        generationStep,
        setGenerationStep,
        locale,
        generationCompletedCount,
        generationRequestedCount,
        generationElapsedSeconds,
        generationContextExpanded,
        setGenerationContextExpanded,
        generationRun,
        setGenerationRun,
        generationInstructions,
        setGenerationInstructions,
        projectComponents,
        generationComponentIds,
        setGenerationComponentIds,
        generationWiki,
        generationWikiIds,
        setGenerationWikiIds,
        generationQuestionAnswers,
        setGenerationQuestionAnswers,
        generationCandidates,
        setAutoContinuePaused,
        estimateExplanationVisible,
        setEstimateExplanationVisible,
        preflightExcludedStories,
        selectedCandidateCount,
        expandedCandidateIndexes,
        setExpandedCandidateIndexes,
        setGenerationCandidates,
        updateGenerationCandidate,
        proposalQualityMeta,
        hasSimilarStory,
        proposalQuality,
        AcceptanceCriteriaEditor,
        estimateGeneration,
        generationHasActionableReview,
        confirmAssumptions,
        generationHasCriticalAssumptions,
        autoContinueRemaining,
        autoContinuePaused,
        recalculateGenerationScope,
        generationMaxStories,
        setGenerationMaxStories,
        generateCandidates,
        selectedCriticalCandidatesNeedDecision,
        applyCandidates,
      }} />
      <TraceabilityHistoryModals options={{
        detailItem,
        setDetailItem,
        WikiMarkdownViewer,
        requirementById,
        openDetails,
        linkedStoryCasesLoading,
        linkedStoryCases,
        onOpenLinkedCase,
        ReviewPendingIcon,
        projectComponents,
        storiesForRequirement,
        tx,
        historyEntries,
        setHistoryEntries,
        historyDiff,
        setHistoryDiff,
        historyKind,
        historyCode,
        historyTitle,
        historyDisplayActor,
        openHistoryDiff,
        historyDiffRows,
        t,
      }} />
    </div>
  );
}
