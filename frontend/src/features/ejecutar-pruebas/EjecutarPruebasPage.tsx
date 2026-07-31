import { useState } from "react";
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import { Alert, Badge, Button, Form, Table } from "react-bootstrap";
import { useI18n } from "../../i18n";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Folders,
  History,
  ImagePlus,
  Info,
  PlayCircle,
  RefreshCw,
  Search,
  User,
  XCircle,
} from "lucide-react";
import type { AttachmentMeta } from "../../EvidenceUpload";
import { findSuiteById } from "../../testRepositoryUtils";
import { isImageAsset, resolveAssetUrl } from "../../shared/utils/assets";
import { isEvidenceAvailable } from "../../shared/utils/evidenceAvailability";
import {
  getExecutionHistoryStats,
  getStatusColor,
  normalizeExecutionHistory,
} from "../ejecucion/executionUtils";
import { RunDetailModal } from "../historial/RunDetailModal";
import { ExecutionToolbar } from "./ExecutionToolbar";
import { ExecutionMobileCards } from "./ExecutionMobileCards";
import { ExecutionTestsTable } from "./ExecutionTestsTable";
import { ExecutionCaseDetailPanel } from "./ExecutionCaseDetailPanel";
import { createExecutionBugActions } from "./executionBugActions";
import {
  getBugCriticalityPresentation,
  getBugPriorityPresentation,
  getBugSeverityPresentation,
} from "../bugs/bugPresentation";

type EjecutarPruebasPageProps = {
  suiteExplorerWidth: number;
  startSuiteExplorerResize: (event: MouseEvent<HTMLDivElement>) => void;
  executionInitialLoading: boolean;
  executionRefreshing: boolean;
  executionSuiteTree: any[];
  renderExecutionSuiteTree: (suites: any[]) => ReactNode;
  currentBuildId: string;
  readOnlyBuild?: boolean;
  currentCompId: string;
  suitesTree: any[];
  selectedSuiteId: string;
  testSearchQuery: string;
  setTestSearchQuery: Dispatch<SetStateAction<string>>;
  setSelectedSubSuiteId: Dispatch<SetStateAction<string | null>>;
  setSelectedExecutionTestIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTest: Dispatch<SetStateAction<any>>;
  filteredTests: any[];
  getExecutionStatusKey: (test: any) => string;
  selectedExecutionTests: any[];
  openExecutionSelector: () => void;
  allVisibleExecutionTestsSelected: boolean;
  toggleVisibleExecutionSelection: (checked: boolean) => void;
  selectedTest: any;
  handleSelectTestForExecution: (test: any) => void;
  selectedExecutionTestIds: string[];
  toggleExecutionSelection: (testId: string) => void;
  activeBuildResultsLoading: boolean;
  activeBuildResultsLoaded: boolean;
  isOutdatedExecutionCase: (test: any) => boolean;
  openSingleCaseExecutionSelector: (test: any) => void;
  setZoomImage: Dispatch<SetStateAction<string | null>>;
  getExecutionActionLabel: (test: any) => string;
  buildsList: any[];
  showFeedback: (title: string, message: string, variant?: any) => void;
  onOpenBuildHistory: () => void;
  onOpenRunHistory: (runId: string, executionId?: string) => void;
  runDetail: any | null;
  runDetailLoading: boolean;
  runDetailError: string;
  focusedExecutionId?: string;
  onCloseRunDetail: () => void;
  onOpenEvidence: (attachment: any) => void;
  canAccessCapability?: (capabilityId: any, level?: any) => boolean;
  onCreateInternalBugFromCase?: (test: any) => Promise<any>;
  creatingInternalBugContextId?: string | null;
  openBugsByCase?: Record<string, any[]>;
  openBugsLoading?: boolean;
  onOpenBugTracker?: () => void;
};

const getTrend = (test: any) => {
  if (!test.history || test.history.length < 2) return null;
  const current = test.lastResult;
  const previous = test.history[1]?.status;
  if (!previous) return null;

  const isPassed = (status: string) => status === "PASO" || status === "OK";
  const isFailed = (status: string) =>
    status === "FALLO" || status === "FALLIDO";

  if (isPassed(current) && isFailed(previous)) return "up";
  if (isFailed(current) && isPassed(previous)) return "down";
  if (current === previous) return "same";
  return "neutral";
};

const getLastResultColor = (test: any) => {
  if (test.lastResult === "PASO" || test.lastResult === "OK") return "success";
  if (test.lastResult === "FALLO" || test.lastResult === "FALLIDO")
    return "danger";
  if (test.lastResult === "BLOQUEADO") return "primary";
  return "secondary";
};

export function EjecutarPruebasPage({
  suiteExplorerWidth,
  startSuiteExplorerResize,
  executionInitialLoading,
  executionRefreshing,
  executionSuiteTree,
  renderExecutionSuiteTree,
  currentBuildId,
  readOnlyBuild = false,
  currentCompId,
  suitesTree,
  selectedSuiteId,
  testSearchQuery,
  setTestSearchQuery,
  setSelectedSubSuiteId,
  setSelectedExecutionTestIds,
  setSelectedTest,
  filteredTests,
  getExecutionStatusKey,
  selectedExecutionTests,
  openExecutionSelector,
  allVisibleExecutionTestsSelected,
  toggleVisibleExecutionSelection,
  selectedTest,
  handleSelectTestForExecution,
  selectedExecutionTestIds,
  toggleExecutionSelection,
  activeBuildResultsLoading,
  activeBuildResultsLoaded,
  isOutdatedExecutionCase,
  openSingleCaseExecutionSelector,
  setZoomImage,
  getExecutionActionLabel,
  buildsList,
  showFeedback,
  onOpenBuildHistory,
  onOpenRunHistory,
  runDetail,
  runDetailLoading,
  runDetailError,
  focusedExecutionId,
  onCloseRunDetail,
  onOpenEvidence,
  canAccessCapability,
  onCreateInternalBugFromCase,
  creatingInternalBugContextId,
  openBugsByCase = {},
  openBugsLoading = false,
  onOpenBugTracker,
}: EjecutarPruebasPageProps) {
  const { t } = useI18n();
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);
  const [caseBugLinks, setCaseBugLinks] = useState<Record<string, any>>({});
  const [bugCaseFilter, setBugCaseFilter] = useState<"all" | "open" | "retest">(
    "all",
  );
  const canStartAnyExecution =
    !readOnlyBuild && (!canAccessCapability ||
    canAccessCapability("ejecutar.manual", "edit") ||
    canAccessCapability("ejecutar.automatizada", "edit") ||
    canAccessCapability("ejecutar.ia", "edit"));
  const canViewBuildHistory =
    !canAccessCapability ||
    canAccessCapability("ejecutar.historial_build", "read");
  const canCreateBugs =
    !canAccessCapability || canAccessCapability("bugs.crear", "edit");
  const canViewBugs =
    !canAccessCapability || canAccessCapability("bugs.ver", "read");
  const bugActions = createExecutionBugActions({ t, filteredTests, openBugsByCase, currentBuildId, caseBugLinks, setCaseBugLinks, showFeedback, onCreateInternalBugFromCase, onOpenBugTracker, creatingInternalBugContextId, canAccessCapability, bugCaseFilter });
  const { visibleTests, openBugCaseCount, openBugTotal, retestBugCaseCount, getOpenBugsForCase, isRetestBug, getBugStatusBadge, getBugSeverityBadge, getBugCriticalityBadge, renderOpenBugBadge, renderInternalBugButton } = bugActions;

  return (
    <div className="execution-page mobile-stack d-flex h-100 overflow-hidden animate__animated animate__fadeIn">
      <div
        className={`execution-sidebar border-end bg-light shadow-sm text-start d-flex flex-column position-relative ${mobileExplorerOpen ? "is-open" : ""}`}
        style={{
          width: `${suiteExplorerWidth}px`,
          minWidth: "260px",
          maxWidth: "560px",
          flexShrink: 0,
        }}
      >
        <div className="p-3 bg-white border-bottom fw-bold text-muted small d-flex flex-column gap-2">
          <div className="d-flex justify-content-between align-items-center">
            <span className="d-flex align-items-center gap-1">
              EXPLORADOR
              <Button
                type="button"
                variant="link"
                size="sm"
                className="p-0 text-primary shadow-none"
                title={t('ejecutarPruebas.metricsMeaning')}
                onClick={() =>
                  showFeedback(
                    t('ejecutarPruebas.executionMetrics'),
                    t('ejecutarPruebas.executionMetricsDetail'),
                    "info",
                  )
                }
              >
                <Info size={14} />
              </Button>
            </span>
            <Button
              variant="link"
              size="sm"
              className="p-0 text-decoration-none x-small fw-bold"
              onClick={() => {
                setSelectedSubSuiteId(null);
                setSelectedExecutionTestIds([]);
                setTestSearchQuery("");
                setSelectedTest(null);
              }}
            >
              {t('ejecutarPruebas.clear')}
            </Button>
          </div>
          <div className="input-group input-group-sm mt-1">
            <span className="input-group-text bg-light border-end-0 text-muted">
              <Search size={14} />
            </span>
            <Form.Control
              type="text"
              placeholder={t('ejecutarPruebas.searchTest')}
              className="bg-light border-start-0 shadow-none ps-0"
              value={testSearchQuery}
              onChange={(event) => setTestSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="p-2 overflow-auto flex-grow-1 pb-5">
          {executionInitialLoading ? (
            <div className="text-center text-muted p-3 small">
              <div className="spinner-border spinner-border-sm mb-2" />
              <br />
              Cargando...
            </div>
          ) : executionSuiteTree.length === 0 ? (
            <div className="text-center text-muted p-3 small">
              <Folders size={24} className="mb-2 opacity-40 d-block mx-auto" />
              {!currentBuildId
                ? t('ejecutarPruebas.selectOrCreateBuild')
                : !currentCompId
                  ? t('ejecutarPruebas.selectOrCreateComponent')
                  : t('ejecutarPruebas.noAssignedCases')}
            </div>
          ) : (
            <>
              {executionRefreshing && (
                <div className="d-flex align-items-center gap-2 text-primary x-small fw-bold mb-2 px-2">
                  <RefreshCw size={12} className="animate-pulse" />
                  Actualizando...
                </div>
              )}
              {renderExecutionSuiteTree(executionSuiteTree)}
            </>
          )}
        </div>
        <div
          onMouseDown={startSuiteExplorerResize}
          title={t('ejecutarPruebas.resizeExplorer')}
          style={{
            position: "absolute",
            top: 0,
            right: -4,
            width: 8,
            height: "100%",
            cursor: "col-resize",
            zIndex: 5,
          }}
        />
      </div>

      <div
        className="execution-content flex-grow-1 d-flex flex-column overflow-hidden text-start"
        style={{ minWidth: 0 }}
      >
        <ExecutionToolbar options={{
          testSearchQuery,
          suitesTree,
          selectedSuiteId,
          t,
          visibleTests,
          canViewBugs,
          openBugsLoading,
          openBugTotal,
          bugCaseFilter,
          setBugCaseFilter,
          openBugCaseCount,
          retestBugCaseCount,
          executionRefreshing,
          getExecutionStatusKey,
          mobileExplorerOpen,
          setMobileExplorerOpen,
          selectedExecutionTests,
          canViewBuildHistory,
          onOpenBuildHistory,
          canStartAnyExecution,
          openExecutionSelector,
        }} />

        <div className="d-flex flex-grow-1 overflow-hidden">
          <div className="flex-grow-1 overflow-auto">
            <ExecutionMobileCards options={{
              visibleTests,
              selectedTest,
              handleSelectTestForExecution,
              activeBuildResultsLoading,
              activeBuildResultsLoaded,
              getOpenBugsForCase,
              isRetestBug,
              renderOpenBugBadge,
              isOutdatedExecutionCase,
              selectedExecutionTestIds,
              toggleExecutionSelection,
              canStartAnyExecution,
              openSingleCaseExecutionSelector,
              getExecutionActionLabel,
              renderInternalBugButton,
              executionInitialLoading,
              bugCaseFilter,
            }} />

            <ExecutionTestsTable options={{ visibleTests, t, allVisibleExecutionTestsSelected, toggleVisibleExecutionSelection, selectedTest, handleSelectTestForExecution, activeBuildResultsLoading, activeBuildResultsLoaded, selectedExecutionTestIds, toggleExecutionSelection, isOutdatedExecutionCase, renderOpenBugBadge, canStartAnyExecution, renderInternalBugButton, openSingleCaseExecutionSelector, executionInitialLoading, bugCaseFilter }} />

          </div>

          <ExecutionCaseDetailPanel options={{ selectedTest, t, setSelectedTest, currentBuildId, buildsList, canStartAnyExecution, isOutdatedExecutionCase, openSingleCaseExecutionSelector, getExecutionActionLabel, renderInternalBugButton, getBugStatusBadge, getBugSeverityBadge, getBugCriticalityBadge, getOpenBugsForCase, onOpenRunHistory, onOpenEvidence, setZoomImage, showFeedback, onOpenBugTracker }} />
        </div>
      </div>
      <RunDetailModal
        detail={runDetail}
        detailLoading={runDetailLoading}
        detailError={runDetailError}
        focusedExecutionId={focusedExecutionId}
        getStatusColor={getStatusColor}
        onHide={onCloseRunDetail}
        onOpenEvidence={onOpenEvidence}
      />
    </div>
  );
}
