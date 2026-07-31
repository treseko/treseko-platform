import { useEffect, useState } from "react";
import { useExecutionRunDetail } from "../features/historial/hooks/useExecutionRunDetail";
import { useHistorialController } from "../features/historial/hooks/useHistorialController";
import { createHistoryComparisonData } from "../features/historial/mappers/historialMappers";
import { useAiEngineConfig } from "../features/configuracion/hooks/useAiEngineConfig";
import { useAdminUserRolesConfig } from "../features/configuracion/hooks/useAdminUserRolesConfig";
import { useConfigurationPreload } from "../features/configuracion/hooks/useConfigurationPreload";
import { useGeneralConfiguration } from "../features/configuracion/hooks/useGeneralConfiguration";
import { useSessionConfig } from "../features/configuracion/hooks/useSessionConfig";
import { useLiveRefresh } from "../shared/hooks/useLiveRefresh";
import { ALLOW_LOCAL_FALLBACK } from "./constants";
import { defaultAiEngineConfig, defaultAttachmentConfig, normalizeAiAgentWorkflow } from "../features/configuracion/mappers/configuracionMappers";
import { initialAdConfig, initialAppUsers, initialEnvironments, initialDevices, initialAgents, initialCustomInventoryItems, initialInventoryCategories, initialRedmineBugs, initialRunHistory, initialIaLogs, initialRedmineSettings } from "./seedData";
export function useAppConfigurationState({ options }: { options: any }) {
  const { isAuthenticated,activeTab,projectsSource,loadOrganizationsFromBackend,selectedOrganizationId,organizationMembersLoadKeyRef,loadAllOrganizationMembers,getEnvironmentActions,getWikiActions,getProjectMemberActions,currentProjectId,currentBuildId,selectedTest,setSelectedTest,setViewMode,fetchWithAuth,setProjectSyncMessage,showFeedback,loadProjectMetrics,setActiveTab,t,setIsAuthenticated,setLoginError,canAccessCapability,hasSystemFeature,loadCasosFromBackendRef,loadCasosFromBackend,confirmAction } = options;
  const [configTab, setConfigTab] = useState<
    | "general"
    | "profile"
    | "clients"
    | "users"
    | "roles"
    | "notifications"
    | "integrations"
    | "ai"
    | "monitor"
    | "audit"
    | "license"
    | "updates"
  >("general");

  useEffect(() => {
    if (
      !isAuthenticated ||
      activeTab !== "configuracion" ||
      configTab !== "clients" ||
      projectsSource !== "backend"
    )
      return;
    loadOrganizationsFromBackend({ includeInactive: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeTab, configTab, projectsSource]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      activeTab !== "configuracion" ||
      configTab !== "clients" ||
      !selectedOrganizationId
    )
      return;
    const key = `${projectsSource}:${selectedOrganizationId}`;
    if (organizationMembersLoadKeyRef.current === key) return;
    organizationMembersLoadKeyRef.current = key;
    loadAllOrganizationMembers(selectedOrganizationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    activeTab,
    configTab,
    selectedOrganizationId,
    projectsSource,
  ]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const run = async () => {
      await Promise.allSettled([
        getEnvironmentActions().loadEnvironmentsForProject(currentProjectId),
        getWikiActions().loadWikiForProject(currentProjectId),
        loadUsersFromBackend(),
        loadRolesFromBackend(),
        getProjectMemberActions().loadProjectMembers(currentProjectId),
      ]);
      if (cancelled) return;
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, projectsSource, isAuthenticated]);

  useEffect(() => {
    if (selectedTest && selectedTest.projectId !== currentProjectId) {
      setSelectedTest(null);
      setViewMode("list");
    }
  }, [currentProjectId, selectedTest]);

  // Estados del inventario avanzado dinámico (carpetas dinámicas)
  const [inventoryCategories, setInventoryCategories] = useState<any[]>(
    ALLOW_LOCAL_FALLBACK ? initialInventoryCategories : [],
  );

  // Inventory State
  // Estados enriquecidos para el inventario y CRUD
  const [environments, setEnvironments] = useState(
    ALLOW_LOCAL_FALLBACK ? initialEnvironments : [],
  );
  const [devices, setDevices] = useState(
    ALLOW_LOCAL_FALLBACK ? initialDevices : [],
  );
  const [agents, setAgents] = useState(
    ALLOW_LOCAL_FALLBACK ? initialAgents : [],
  );

  // Estado para guardar los items de las carpetas que crees manualmente
  const [customInventoryItems, setCustomInventoryItems] = useState<any[]>(
    ALLOW_LOCAL_FALLBACK ? initialCustomInventoryItems : [],
  );

  // Estados para controlar los modales de creación/edición
  const [invModalConfig, setInvModalConfig] = useState<{
    show: boolean;
    type: "env" | "device" | "node";
    mode: "add" | "edit";
    itemData: any;
  }>({
    show: false,
    type: "env",
    mode: "add",
    itemData: null,
  });

  // Redmine Bugs State
  const [redmineBugs, setRedmineBugs] = useState(
    ALLOW_LOCAL_FALLBACK ? initialRedmineBugs : [],
  );

  // Run History State
  const {
    runHistory,
    historialInitialFilters,
    pendingHistorialRunDetailId,
    setPendingHistorialRunDetailId,
    loadProjectRunHistory,
    loadTestRunDetail,
    markHistorialAiReviewed,
    openHistorialRuns,
  } = useHistorialController({
    activeTab,
    currentProjectId,
    currentBuildId,
    projectsSource,
    initialRunHistory: ALLOW_LOCAL_FALLBACK ? initialRunHistory : [],
    fetchWithAuth,
    setProjectSyncMessage,
    showFeedback,
    loadProjectMetrics,
    setActiveTab,
  });
  const {
    executionRunDetail,
    executionRunDetailLoading,
    executionRunDetailError,
    focusedExecutionId,
    openExecutionRunDetail,
    closeExecutionRunDetail,
  } = useExecutionRunDetail({ loadTestRunDetail });

  // AI Engine State
  const [iaStatus, setIaStatus] = useState<"idle" | "running">("idle");
  const [iaLogs, setIaLogs] = useState<any[]>(
    ALLOW_LOCAL_FALLBACK ? initialIaLogs : [],
  );
  const [iaQueue, setIaQueue] = useState<string[]>([]);
  const [iaExecutionStreams, setIaExecutionStreams] = useState<any[]>([]);

  // Settings State
  const [redmineUrl, setRedmineUrl] = useState(
    ALLOW_LOCAL_FALLBACK ? initialRedmineSettings.url : "",
  );
  const [redmineToken, setRedmineToken] = useState(
    ALLOW_LOCAL_FALLBACK ? initialRedmineSettings.token : "",
  );
  const [redmineProjKey, setRedmineProjKey] = useState(
    ALLOW_LOCAL_FALLBACK ? initialRedmineSettings.projectKey : "",
  );
  const [useShaDedup, setUseShaDedup] = useState(true);
  const [iaProvider, setIaProvider] = useState("gemini");
  const [iaApiKey, setIaApiKey] = useState("");
  const [iaTemp, setIaTemp] = useState(0.2);
  const aiEngineConfiguration = useAiEngineConfig({
    isAuthenticated,
    fetchWithAuth,
    defaultConfig: defaultAiEngineConfig,
    normalizeAiAgentWorkflow,
    setIaProvider,
    setIaTemp,
    setIaLogs,
    showFeedback,
  });
  const { aiEngineConfig, loadAiEngineConfig } = aiEngineConfiguration;
  const [iaMaxSteps, setIaMaxSteps] = useState(15);
  const generalConfiguration = useGeneralConfiguration({
    t,
    isAuthenticated,
    fetchWithAuth,
    defaultAttachmentConfig,
    showFeedback,
    confirmAction,
  });
  const {
    attachmentConfig,
    copyToClipboard,
    loadAttachmentConfig,
    loadApiKeys,
  } = generalConfiguration;
  const sessionConfiguration = useSessionConfig({
    isAuthenticated,
    fetchWithAuth,
    showFeedback,
    setIsAuthenticated,
    setLoginError,
  });
  const { loadSessionConfig } = sessionConfiguration;
  useConfigurationPreload({
    activeTab,
    configTab,
    isAuthenticated,
    canAccessCapability,
    hasSystemFeature,
    loadApiKeys,
    loadSessionConfig,
    loadAiEngineConfig,
    loadAttachmentConfig,
  });
  useEffect(() => {
    loadCasosFromBackendRef.current = loadCasosFromBackend;
  }, [loadCasosFromBackend]);

  const adminUserRolesConfiguration = useAdminUserRolesConfig({
    allowLocalFallback: ALLOW_LOCAL_FALLBACK,
    initialAdConfig,
    initialAppUsers,
    projectsSource,
    fetchWithAuth,
    setProjectSyncMessage,
    confirmAction,
  });
  const {
    adConfig,
    setAdConfig,
    appUsers,
    assignableUsers,
    customRoles,
    systemRoleItems,
    showRoleModal,
    setShowRoleModal,
    editingRoleId,
    roleForm,
    setRoleForm,
    showUserModal,
    setShowUserModal,
    editingUserId,
    userForm,
    setUserForm,
    loadUsersFromBackend,
    loadRolesFromBackend,
    handleUserRoleChange,
    handleUserCustomRoleChange,
    handleSaveUser,
    setRoleModulePermission,
    setRoleCapabilityPermission,
    handleSaveRole,
  } = adminUserRolesConfiguration;

  useEffect(() => {
    if (
      !isAuthenticated ||
      activeTab !== "configuracion" ||
      configTab !== "users"
    )
      return;
    loadUsersFromBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeTab, configTab, projectsSource]);

  useLiveRefresh({
    enabled:
      isAuthenticated && activeTab === "configuracion" && configTab === "users",
    intervalMs: 15000,
    refreshOnFocus: true,
    onRefresh: loadUsersFromBackend,
  });

  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [showProjectMemberModal, setShowProjectMemberModal] = useState(false);
  const [projectMemberForm, setProjectMemberForm] = useState({ userId: "" });
  const [projectMemberRemoval, setProjectMemberRemoval] = useState<any | null>(
    null,
  );

  const historyComparisonData = createHistoryComparisonData(
    runHistory,
    currentProjectId,
  );
  return { configTab,setConfigTab,inventoryCategories,setInventoryCategories,environments,setEnvironments,devices,setDevices,agents,setAgents,customInventoryItems,setCustomInventoryItems,invModalConfig,setInvModalConfig,redmineBugs,setRedmineBugs,runHistory,historialInitialFilters,pendingHistorialRunDetailId,setPendingHistorialRunDetailId,loadProjectRunHistory,loadTestRunDetail,markHistorialAiReviewed,openHistorialRuns,executionRunDetail,executionRunDetailLoading,executionRunDetailError,focusedExecutionId,openExecutionRunDetail,closeExecutionRunDetail,iaStatus,setIaStatus,iaLogs,setIaLogs,iaQueue,setIaQueue,iaExecutionStreams,setIaExecutionStreams,redmineUrl,setRedmineUrl,redmineToken,setRedmineToken,redmineProjKey,setRedmineProjKey,useShaDedup,setUseShaDedup,iaProvider,setIaProvider,iaApiKey,setIaApiKey,iaTemp,setIaTemp,aiEngineConfiguration,aiEngineConfig,loadAiEngineConfig,iaMaxSteps,setIaMaxSteps,generalConfiguration,attachmentConfig,copyToClipboard,loadAttachmentConfig,loadApiKeys,sessionConfiguration,loadSessionConfig,adminUserRolesConfiguration,adConfig,setAdConfig,appUsers,assignableUsers,customRoles,systemRoleItems,showRoleModal,setShowRoleModal,editingRoleId,roleForm,setRoleForm,showUserModal,setShowUserModal,editingUserId,userForm,setUserForm,loadUsersFromBackend,loadRolesFromBackend,handleUserRoleChange,handleUserCustomRoleChange,handleSaveUser,setRoleModulePermission,setRoleCapabilityPermission,handleSaveRole,projectMembers,setProjectMembers,showProjectMemberModal,setShowProjectMemberModal,projectMemberForm,setProjectMemberForm,projectMemberRemoval,setProjectMemberRemoval,historyComparisonData };
}
