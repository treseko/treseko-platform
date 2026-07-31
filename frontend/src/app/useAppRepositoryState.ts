import { useRef, useState } from 'react'
import type { ConfirmDialogState } from '../shared/components/ConfirmDialog'
import type { UpdateMaintenanceState } from '../features/configuracion/updateMaintenance'
import { readUpdateMaintenanceSignal } from '../features/configuracion/updateMaintenance'

export function useAppRepositoryState({ t }: { t: (key: string) => string }) {
  // SUITES Y SUBSUITES - CONECTADOS AL BACKEND
  const [suitesTree, setSuitesTree] = useState<any[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(false);
  const [showSuiteModal, setShowSuiteModal] = useState(false);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [suiteForm, setSuiteForm] = useState({
    nombre: "",
    descripcion: "",
    parentId: "",
    color: "#F1F5F9",
    icono: "folder",
  });
  const [suiteExplorerWidth, setSuiteExplorerWidth] = useState(320);
  const [showMoveSuiteModal, setShowMoveSuiteModal] = useState(false);
  const [movingSuiteId, setMovingSuiteId] = useState<string | null>(null);
  const [moveSuiteParentId, setMoveSuiteParentId] = useState<string>("");

  // CASOS DE PRUEBA - CONECTADOS AL BACKEND
  const [casosList, setCasosList] = useState<any[]>([]);
  const [casosLoading, setCasosLoading] = useState(false);
  const [casosTotal, setCasosTotal] = useState(0);
  const [casosPage, setCasosPage] = useState(0);
  const [casosPageSize] = useState(50);
  const [casosSearchQuery, setCasosSearchQuery] = useState("");
  const [casosFilterSuite, setCasosFilterSuite] = useState<string | null>(null);
  const [casosFilterPrioridad, setCasosFilterPrioridad] = useState<
    string | null
  >(null);
  const [casosFilterCriticidad, setCasosFilterCriticidad] = useState<
    string | null
  >(null);
  const [casosFilterEstado, setCasosFilterEstado] = useState<string | null>(
    null,
  );
  const [casosFilterEtiqueta, setCasosFilterEtiqueta] = useState("");
  const [showCasoModal, setShowCasoModal] = useState(false);
  const [editingCasoMasterId, setEditingCasoMasterId] = useState<string | null>(
    null,
  );
  const [caseEditorOpen, setCaseEditorOpen] = useState(false);
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  const [caseVersions, setCaseVersions] = useState<any[]>([]);
  const [versionsCase, setVersionsCase] = useState<any | null>(null);
  const [selectedCompareVersionId, setSelectedCompareVersionId] = useState<
    string | null
  >(null);
  const [casosSearchResults, setCasosSearchResults] = useState<any[] | null>(
    null,
  );
  const [feedbackModal, setFeedbackModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    variant: "success" | "danger" | "warning" | "info";
  }>({
    show: false,
    title: "",
    message: "",
    variant: "info",
  });
  const [updateMaintenanceState, setUpdateMaintenanceState] =
    useState<UpdateMaintenanceState>(() => readUpdateMaintenanceSignal());
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    show: false,
    title: "",
    message: "",
    variant: "warning",
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
  });
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );


  return {
    suitesTree,
    setSuitesTree,
    suitesLoading,
    setSuitesLoading,
    showSuiteModal,
    setShowSuiteModal,
    editingSuiteId,
    setEditingSuiteId,
    suiteForm,
    setSuiteForm,
    suiteExplorerWidth,
    setSuiteExplorerWidth,
    showMoveSuiteModal,
    setShowMoveSuiteModal,
    movingSuiteId,
    setMovingSuiteId,
    moveSuiteParentId,
    setMoveSuiteParentId,
    casosList,
    setCasosList,
    casosLoading,
    setCasosLoading,
    casosTotal,
    setCasosTotal,
    casosPage,
    setCasosPage,
    casosPageSize,
    casosSearchQuery,
    setCasosSearchQuery,
    casosFilterSuite,
    setCasosFilterSuite,
    casosFilterPrioridad,
    setCasosFilterPrioridad,
    casosFilterCriticidad,
    setCasosFilterCriticidad,
    casosFilterEstado,
    setCasosFilterEstado,
    casosFilterEtiqueta,
    setCasosFilterEtiqueta,
    showCasoModal,
    setShowCasoModal,
    editingCasoMasterId,
    setEditingCasoMasterId,
    caseEditorOpen,
    setCaseEditorOpen,
    showVersionsModal,
    setShowVersionsModal,
    caseVersions,
    setCaseVersions,
    versionsCase,
    setVersionsCase,
    selectedCompareVersionId,
    setSelectedCompareVersionId,
    casosSearchResults,
    setCasosSearchResults,
    feedbackModal,
    setFeedbackModal,
    updateMaintenanceState,
    setUpdateMaintenanceState,
    confirmDialog,
    setConfirmDialog,
    confirmResolverRef,
  }
}
