import { useMemo, useState } from 'react'
import { ALLOW_LOCAL_FALLBACK } from './constants'
import { DEFAULT_BRANDING } from './branding'
import {
  initialBuilds, initialComponents, initialOrganizations, initialProjects, initialWikiPages,
} from './seedData'

export function useAppWorkspaceState({ t }: { t: (key: string) => string }) {
  // 3. ESTADOS PARA CREAR CARPETAS AL VUELO
  const [showAddFolderModal, setShowAddFolderModal] = useState(false);
  const [folderConfig, setFolderConfig] = useState<{ parentId: string | null }>(
    { parentId: null },
  );
  const [expandedSuites, setExpandedSuites] = useState<Record<string, boolean>>(
    {
      s1: true,
      s2: true,
      s3: true,
    },
  );
  const [expandedSubSuites, setExpandedSubSuites] = useState<
    Record<string, boolean>
  >({
    sub1: true,
    sub2: true,
    sub3: true,
    sub4: true,
    sub5: true,
    sub6: true,
  });
  const [selectedSubSuiteId, setSelectedSubSuiteId] = useState<string | null>(
    null,
  );
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  // Estado para el buscador de pruebas
  const [testSearchQuery, setTestSearchQuery] = useState("");
  const [caseArchiveView, setCaseArchiveView] = useState<
    "active" | "archived" | "all"
  >("active");

  // Estados para el programador IA
  const [showIaScheduler, setShowIaScheduler] = useState(false);
  const [selectedTestsForIa, setSelectedTestsForIa] = useState<string[]>([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [schedulerSearch, setSchedulerSearch] = useState("");
  const [execName, setExecName] = useState("");
  const [iaSchedulerOpenedFromBuilder, setIaSchedulerOpenedFromBuilder] =
    useState(false);

  // Estados para la gestión detallada de proyectos
  const [managingProjectId, setManagingProjectId] = useState<string | null>(
    null,
  );
  const [projectInnerTab, setProjectInnerTab] = useState<
    | "config"
    | "components"
    | "envs"
    | "traceability"
    | "wiki"
    | "tickets"
    | "portability"
  >("config");
  const [traceabilityRefreshToken, setTraceabilityRefreshToken] = useState(0);

  // Estados para el módulo wiki
  const [wikiPages, setWikiPages] = useState<any[]>(
    ALLOW_LOCAL_FALLBACK ? initialWikiPages : [],
  );
  const [wikiMode, setWikiMode] = useState<
    "list" | "view" | "edit" | "history"
  >("list");
  const [selectedWiki, setSelectedWiki] = useState<any>(null);
  const [wikiFormData, setWikiFormData] = useState({ title: "", content: "" });

  // System Configurations & Data (Dynamic hierarchies)
  const [organizations, setOrganizations] = useState(
    ALLOW_LOCAL_FALLBACK ? initialOrganizations : [],
  );
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [organizationMembers, setOrganizationMembers] = useState<any[]>([]);
  const [organizationMemberForm, setOrganizationMemberForm] = useState({
    userId: "",
  });
  const [currentOrgId, setCurrentOrgId] = useState(
    ALLOW_LOCAL_FALLBACK ? "o1" : "",
  );

  const [projectsList, setProjectsList] = useState(
    ALLOW_LOCAL_FALLBACK ? initialProjects : [],
  );
  const [currentProjectId, setCurrentProjectId] = useState(
    ALLOW_LOCAL_FALLBACK ? "p1" : "",
  );
  const [projectsSource, setProjectsSource] = useState<"local" | "backend">(
    ALLOW_LOCAL_FALLBACK ? "local" : "backend",
  );
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectSyncMessage, setProjectSyncMessage] = useState(
    ALLOW_LOCAL_FALLBACK
      ? t('common.localModeEnabled')
      : t('common.realModeWaiting'),
  );

  const [componentsList, setComponentsList] = useState(
    ALLOW_LOCAL_FALLBACK ? initialComponents : [],
  );
  const [currentCompId, setCurrentCompId] = useState(
    ALLOW_LOCAL_FALLBACK ? "c1" : "",
  );
  const currentComponentName = useMemo(() => {
    const component = componentsList.find(
      (item) => String(item.id) === String(currentCompId || ""),
    );
    return component?.name || (component as any)?.nombre || "";
  }, [componentsList, currentCompId]);

  const [componentSearchQuery, setComponentSearchQuery] = useState("");

  const [showComponentModal, setShowComponentModal] = useState(false);
  const [componentForm, setComponentForm] = useState({
    id: "",
    name: "",
    description: "",
    techStack: "",
    variablesText: "",
  });

  const [buildsList, setBuildsList] = useState(
    ALLOW_LOCAL_FALLBACK ? initialBuilds : [],
  );
  const [currentBuildId, setCurrentBuildId] = useState(
    ALLOW_LOCAL_FALLBACK ? "b1" : "",
  );
  const [buildCaseIds, setBuildCaseIds] = useState<Record<string, string[]>>(
    {},
  );
  const [buildCasesLoadingByBuild, setBuildCasesLoadingByBuild] = useState<
    Record<string, boolean>
  >({});
  const [showBuildCasesModal, setShowBuildCasesModal] = useState(false);
  const [editingBuildCasesId, setEditingBuildCasesId] = useState<string | null>(
    null,
  );
  const [buildCaseDraftIds, setBuildCaseDraftIds] = useState<string[]>([]);
  const [lockedBuildCaseIds, setLockedBuildCaseIds] = useState<
    Record<string, string[]>
  >({});
  const [buildCaseSearch, setBuildCaseSearch] = useState("");


  return {
    showAddFolderModal,
    setShowAddFolderModal,
    folderConfig,
    setFolderConfig,
    expandedSuites,
    setExpandedSuites,
    expandedSubSuites,
    setExpandedSubSuites,
    selectedSubSuiteId,
    setSelectedSubSuiteId,
    zoomImage,
    setZoomImage,
    testSearchQuery,
    setTestSearchQuery,
    caseArchiveView,
    setCaseArchiveView,
    showIaScheduler,
    setShowIaScheduler,
    selectedTestsForIa,
    setSelectedTestsForIa,
    scheduledTime,
    setScheduledTime,
    schedulerSearch,
    setSchedulerSearch,
    execName,
    setExecName,
    iaSchedulerOpenedFromBuilder,
    setIaSchedulerOpenedFromBuilder,
    managingProjectId,
    setManagingProjectId,
    projectInnerTab,
    setProjectInnerTab,
    traceabilityRefreshToken,
    setTraceabilityRefreshToken,
    wikiPages,
    setWikiPages,
    wikiMode,
    setWikiMode,
    selectedWiki,
    setSelectedWiki,
    wikiFormData,
    setWikiFormData,
    organizations,
    setOrganizations,
    selectedOrganizationId,
    setSelectedOrganizationId,
    organizationMembers,
    setOrganizationMembers,
    organizationMemberForm,
    setOrganizationMemberForm,
    currentOrgId,
    setCurrentOrgId,
    projectsList,
    setProjectsList,
    currentProjectId,
    setCurrentProjectId,
    projectsSource,
    setProjectsSource,
    projectsLoading,
    setProjectsLoading,
    projectSyncMessage,
    setProjectSyncMessage,
    componentsList,
    setComponentsList,
    currentCompId,
    setCurrentCompId,
    currentComponentName,
    componentSearchQuery,
    setComponentSearchQuery,
    showComponentModal,
    setShowComponentModal,
    componentForm,
    setComponentForm,
    buildsList,
    setBuildsList,
    currentBuildId,
    setCurrentBuildId,
    buildCaseIds,
    setBuildCaseIds,
    buildCasesLoadingByBuild,
    setBuildCasesLoadingByBuild,
    showBuildCasesModal,
    setShowBuildCasesModal,
    editingBuildCasesId,
    setEditingBuildCasesId,
    buildCaseDraftIds,
    setBuildCaseDraftIds,
    lockedBuildCaseIds,
    setLockedBuildCaseIds,
    buildCaseSearch,
    setBuildCaseSearch,
  }
}
