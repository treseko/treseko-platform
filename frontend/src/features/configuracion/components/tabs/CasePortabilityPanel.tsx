import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Dropdown,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";
import {
  Download,
  ChevronRight,
  FileCheck2,
  FileUp,
  FileCode2,
  FileJson,
  GitBranch,
  History,
  Folder,
  Link2,
  RotateCcw,
  ScanSearch,
  TestTube2,
  Wind,
} from "lucide-react";
import { API_BASE } from "../../../../app/constants";
import { CaseImportGuide } from "./CaseImportGuide";

type Props = {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  showFeedback: (title: string, message: string, variant?: string) => void;
  canEdit: boolean;
  initialProjectId?: string;
  embedded?: boolean;
};
type Project = { id: string; nombre: string };
type Profile = {
  id: string;
  tool: string;
  version: string;
  status: "stable" | "beta" | "blocked" | string;
  import_enabled?: boolean;
  extensions: string[];
  display_name?: string;
  verification_label?: string;
  verification_detail?: string;
  reason?: string;
};
type Suite = { id: string; nombre: string; parent_id?: string | null };
type Component = { id: string; nombre: string };
type ImportBatch = {
  id: string;
  source_tool: string;
  source_version: string;
  file_name?: string | null;
  status: string;
  summary?: { new?: number; new_versions?: number };
  rollback_available: boolean;
};

const profileVisual = (tool = "") => {
  const value = tool.toLowerCase();
  if (value === "treseko")
    return {
      Icon: FileJson,
      logo: "/tool-logos/treseko.png",
      initials: "TK",
      color: "#2563eb",
      background: "#dbeafe",
    };
  if (value === "csv")
    return {
      Icon: FileJson,
      logo: "/tool-logos/csv.svg",
      initials: "CSV",
      color: "#15803d",
      background: "#dcfce7",
    };
  if (value.includes("azure-test-plans"))
    return {
      Icon: GitBranch,
      logo: "/tool-logos/azure-test-plans.ico",
      initials: "AZ",
      color: "#0078d4",
      background: "#e0f2fe",
    };
  if (value === "qtest")
    return {
      Icon: TestTube2,
      logo: "/tool-logos/qtest.svg",
      initials: "QT",
      color: "#dc2626",
      background: "#fee2e2",
    };
  if (value === "practitest")
    return {
      Icon: TestTube2,
      logo: "/tool-logos/practitest.png",
      initials: "PT",
      color: "#334155",
      background: "#e2e8f0",
    };
  if (value.includes("testrail"))
    return {
      Icon: TestTube2,
      logo: "/tool-logos/testrail.svg",
      initials: "TR",
      color: "#047857",
      background: "#d1fae5",
    };
  if (value.includes("xray"))
    return {
      Icon: GitBranch,
      logo: "/tool-logos/xray.png",
      initials: "XR",
      color: "#7c3aed",
      background: "#ede9fe",
    };
  if (value.includes("zephyr"))
    return {
      Icon: Wind,
      logo: "/tool-logos/zephyr.svg",
      initials: "ZE",
      color: "#0369a1",
      background: "#e0f2fe",
    };
  if (value.includes("qase"))
    return {
      Icon: TestTube2,
      logo: "/tool-logos/qase.svg",
      initials: "QA",
      color: "#4338ca",
      background: "#e0e7ff",
    };
  if (value.includes("testlink"))
    return {
      Icon: Link2,
      logo: "/tool-logos/testlink.png",
      initials: "TL",
      color: "#b45309",
      background: "#fef3c7",
    };
  if (value.includes("gherkin"))
    return {
      Icon: FileCode2,
      logo: "/tool-logos/gherkin.svg",
      initials: "GH",
      color: "#15803d",
      background: "#dcfce7",
    };
  return {
    Icon: FileJson,
    logo: "/tool-logos/csv.svg",
    initials:
      tool
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 3)
        .toUpperCase() || "—",
    color: "#475569",
    background: "#e2e8f0",
  };
};

const profileLabel = (tool = "") => {
  const labels: Record<string, string> = {
    treseko: "Treseko",
    csv: "CSV estructurado",
    testlink: "TestLink",
    xray: "Xray",
    zephyr: "Zephyr",
    "zephyr-scale": "Zephyr Scale",
    "azure-test-plans": "Azure Test Plans",
    qtest: "qTest",
    practitest: "PractiTest",
    testrail: "TestRail",
    qase: "Qase",
    gherkin: "Gherkin",
  };
  return labels[tool.toLowerCase()] || tool;
};

const profileStatus = (status = "", verified = false) => {
  if (status === "stable") return { label: "Estable", bg: "success" };
  if (status === "supported") return { label: "Compatible", bg: "success" };
  if (status === "beta" || (!status && verified))
    return { label: "Beta", bg: "warning" };
  return { label: "En revisión", bg: "secondary" };
};

const isProfileEnabled = (profile?: Profile) =>
  Boolean(profile) &&
  profile?.import_enabled !== false &&
  profile?.status !== "blocked";

const profileVerification = (profile?: Profile) => {
  if (!profile) return null;
  if (profile.verification_label) {
    return {
      label: profile.verification_label,
      detail: profile.verification_detail,
    };
  }
  if (profile.id === "testlink/xml-v1") {
    return {
      label: "Verificado",
      detail: "Probado con exportaciones XML reales de TestLink.",
    };
  }
  return null;
};

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });

export function CasePortabilityPanel({
  fetchWithAuth,
  showFeedback,
  canEdit,
  initialProjectId,
  embedded = false,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projectId, setProjectId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>([]);
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [cases, setCases] = useState<any[]>([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [expandedSuites, setExpandedSuites] = useState<string[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [components, setComponents] = useState<Component[]>([]);
  const [exportComponentId, setExportComponentId] = useState("");
  const [importComponentId, setImportComponentId] = useState("");
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);
  const [expandedImportSuites, setExpandedImportSuites] = useState<string[]>(
    [],
  );
  const [expandedImportCases, setExpandedImportCases] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );
  const selectedVisual = profileVisual(selectedProfile?.tool);
  const selectedVerification = profileVerification(selectedProfile);
  const selectedStatus = profileStatus(
    selectedProfile?.status,
    Boolean(selectedVerification),
  );
  const profileTone = {
    color: selectedVisual.color,
    background: selectedVisual.background,
  };
  const importGroups = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const item of preview?.package?.cases || []) {
      const path = String(item.suite_path || "Importados");
      grouped.set(path, [...(grouped.get(path) || []), item]);
    }
    return Array.from(grouped, ([path, items]) => ({ path, items }));
  }, [preview]);
  const loadBatches = async (id = projectId) => {
    if (!id) return;
    const response = await fetchWithAuth(
      `${API_BASE}/case-portability/projects/${id}/batches`,
    );
    if (response.ok) setBatches(await response.json());
  };
  useEffect(() => {
    (async () => {
      const [projectResponse, profileResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}/proyectos/`),
        fetchWithAuth(`${API_BASE}/case-portability/profiles`),
      ]);
      const projectData = await projectResponse.json().catch(() => []);
      const profileData = await profileResponse.json().catch(() => ({}));
      const nextProjects = Array.isArray(projectData)
        ? projectData
        : projectData.items || [];
      setProjects(nextProjects);
      setProjectId(nextProjects[0]?.id || "");
      setProfiles(profileData.profiles || []);
      setProfileId(
        profileData.profiles?.find((profile: Profile) =>
          isProfileEnabled(profile),
        )
          ?.id || "",
      );
      if (initialProjectId) setProjectId(initialProjectId);
    })();
  }, []); // the parent owns authenticated transport
  useEffect(() => {
    setPreview(null);
    setSelectedSuiteIds([]);
    setSelectedCaseIds([]);
    setExpandedSuites([]);
    setExportComponentId("");
    setImportComponentId("");
    setComponents([]);
    setSuites([]);
    setCases([]);
    if (projectId) {
      fetchWithAuth(`${API_BASE}/proyectos/${projectId}/componentes/`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          const next = Array.isArray(data) ? data : [];
          setComponents(next);
          setImportComponentId(next[0]?.id || "");
        });
    }
    loadBatches();
  }, [projectId]);

  useEffect(() => {
    setSelectedSuiteIds([]);
    setSelectedCaseIds([]);
    setExpandedSuites([]);
    if (!projectId || !exportComponentId) {
      setSuites([]);
      setCases([]);
      return;
    }
    fetchWithAuth(
      `${API_BASE}/proyectos/${projectId}/suites/?componente_id=${exportComponentId}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSuites(Array.isArray(data) ? data : []));
    fetchWithAuth(`${API_BASE}/proyectos/${projectId}/casos/`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const rows = Array.isArray(data) ? data : data.items || [];
        setCases(rows.filter((item: any) => String(item.componente_id || item.componentId || "") === exportComponentId));
      });
  }, [projectId, exportComponentId]);

  const payload = async (includeSelection = false) => {
    if (!file) throw new Error("Selecciona un archivo para importar.");
    return {
      profile_id: profileId,
      file_name: file.name,
      content_base64: await readAsBase64(file),
      ...(includeSelection
        ? {
            selected_external_ids: selectedImportIds,
            component_id: importComponentId,
          }
        : {}),
    };
  };
  const runPreview = async () => {
    try {
      setBusy(true);
      const response = await fetchWithAuth(
        `${API_BASE}/case-portability/projects/${projectId}/preview`,
        { method: "POST", body: JSON.stringify(await payload()) },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      setPreview(data);
      const previewCases = data?.package?.cases || [];
      setSelectedImportIds(
        previewCases.map((item: any) => String(item.external_id)),
      );
      setExpandedImportSuites(
        Array.from(
          new Set(
            previewCases.map((item: any) =>
              String(item.suite_path || "Importados"),
            ),
          ),
        ) as string[],
      );
      setExpandedImportCases([]);
    } catch (error: any) {
      showFeedback(
        "Vista previa",
        error.message || "No se pudo analizar el archivo.",
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };
  const importCases = async () => {
    try {
      setBusy(true);
      const response = await fetchWithAuth(
        `${API_BASE}/case-portability/projects/${projectId}/import`,
        { method: "POST", body: JSON.stringify(await payload(true)) },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      setPreview(null);
      setSelectedImportIds([]);
      setExpandedImportSuites([]);
      setExpandedImportCases([]);
      setShowImportModal(false);
      await loadBatches();
      showFeedback(
        "Importación completada",
        `${data.summary?.new || 0} casos nuevos y ${data.summary?.new_versions || 0} versiones creadas.`,
        "success",
      );
    } catch (error: any) {
      showFeedback(
        "Importación",
        error.message || "No se pudo importar.",
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };
  const exportCases = async () => {
    try {
      setBusy(true);
      const params = new URLSearchParams();
      params.set("component_id", exportComponentId);
      selectedSuiteIds.forEach((id) => params.append("suite_ids", id));
      selectedCaseIds.forEach((id) => params.append("case_ids", id));
      const query = params.toString() ? `?${params}` : "";
      const response = await fetchWithAuth(
        `${API_BASE}/case-portability/projects/${projectId}/export${query}`,
      );
      if (!response.ok) throw new Error((await response.json()).detail);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "treseko-cases.tcases";
      anchor.click();
      URL.revokeObjectURL(url);
      setShowExportPicker(false);
    } catch (error: any) {
      showFeedback(
        "Exportación",
        error.message || "No se pudo exportar.",
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };
  const rollback = async (batch: ImportBatch) => {
    if (
      !window.confirm(
        `¿Revertir el lote ${batch.file_name || batch.id}? Sólo se eliminarán datos sin cambios posteriores.`,
      )
    )
      return;
    try {
      setBusy(true);
      const response = await fetchWithAuth(
        `${API_BASE}/case-portability/batches/${batch.id}/rollback`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      await loadBatches();
      showFeedback(
        "Lote revertido",
        "La reversión segura se completó.",
        "success",
      );
    } catch (error: any) {
      showFeedback(
        "Reversión",
        error.message || "No se pudo revertir el lote.",
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-0 shadow-sm rounded-4 mb-3">
      <Card.Body className="p-4">
        <div className="d-flex justify-content-between gap-3 align-items-start mb-3">
          <div>
            <h6 className="fw-bold mb-1">Portabilidad de Casos</h6>
            <p className="small text-muted mb-0">
              Importa archivos versionados y exporta únicamente el paquete
              oficial <code>.tcases</code>. La vista previa no escribe datos.
            </p>
          </div>
          <Badge bg="success">Oficial</Badge>
        </div>
        {!embedded && (
          <Row className="g-3">
            <Col md={6}>
              <Form.Label className="small fw-bold">Proyecto</Form.Label>
              <Form.Select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={busy}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.nombre}
                  </option>
                ))}
              </Form.Select>
            </Col>
          </Row>
        )}
        {embedded && (
          <div className="small text-muted mb-3">
            Exportación oficial Treseko: se genera siempre en formato{" "}
            <code>.tcases</code>.
          </div>
        )}
        <div className="border rounded-3 p-3 mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <Form.Label className="small fw-bold mb-0">
              Exportación Treseko
            </Form.Label>
            <span className="x-small text-muted">Formato .tcases</span>
          </div>
          <div className="small text-muted mb-2">
            Elegí el componente y las suites o casos que querés exportar dentro
            del selector.
          </div>
          <Button
            variant="outline-primary"
            onClick={() => setShowExportPicker(true)}
            disabled={!projectId || busy}
          >
            <Download size={15} className="me-1" /> Exportar
          </Button>
        </div>
        <Modal
          show={showExportPicker && !showImportModal}
          onHide={() => setShowExportPicker(false)}
          size="lg"
          centered
        >
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title className="fw-bold d-flex align-items-center gap-2">
              <Download size={18} className="text-primary" />
              Casos para exportar
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-0">
            <div className="mb-3">
              <Form.Label className="small fw-bold">Componente</Form.Label>
              <Form.Select
                value={exportComponentId}
                onChange={(event) => setExportComponentId(event.target.value)}
                disabled={busy || components.length === 0}
              >
                <option value="">Seleccionar componente…</option>
                {components.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.nombre}
                  </option>
                ))}
              </Form.Select>
              {!components.length && (
                <div className="small text-muted mt-1">
                  Este proyecto todavía no tiene componentes disponibles.
                </div>
              )}
            </div>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <span className="small text-muted">
                Seleccioná suites o casos individuales
              </span>
              <div className="d-flex gap-2">
                <Button
                  size="sm"
                  variant="outline-primary"
                  onClick={() => {
                    setSelectedSuiteIds(suites.map((s) => s.id));
                    setSelectedCaseIds(cases.map((item) => String(item.id)));
                  }}
                >
                  Seleccionar todos
                </Button>
                <Button
                  size="sm"
                  variant="link"
                  onClick={() => {
                    setSelectedSuiteIds([]);
                    setSelectedCaseIds([]);
                  }}
                >
                  Limpiar
                </Button>
              </div>
            </div>
            <div
              className="border rounded-2 p-2"
              style={{ maxHeight: 420, overflowY: "auto" }}
            >
              {!exportComponentId && (
                <div className="small text-muted p-2">
                  Seleccioná un componente para ver sus suites y casos.
                </div>
              )}
              {exportComponentId && suites.map((suite) => {
                const suiteCases = cases.filter(
                  (item) => String(item.suite_id || item.suiteId) === suite.id,
                );
                const suiteCaseIds = suiteCases.map((item) => String(item.id));
                const suiteAllCasesSelected = suiteCaseIds.length > 0 && suiteCaseIds.every((id) => selectedCaseIds.includes(id));
                const suitePartiallySelected = !suiteAllCasesSelected && suiteCaseIds.some((id) => selectedCaseIds.includes(id));
                const suiteChecked = selectedSuiteIds.includes(suite.id) || suiteAllCasesSelected;
                const expanded = expandedSuites.includes(suite.id);
                return (
                  <div key={suite.id} className="mb-2">
                    <div className="d-flex align-items-center gap-2 bg-light rounded-2 px-2 py-2">
                      <Form.Check
                        type="checkbox"
                        checked={suiteChecked}
                        ref={(input: HTMLInputElement | null) => {
                          if (input) input.indeterminate = suitePartiallySelected;
                        }}
                        onChange={() => {
                          setSelectedSuiteIds((current) =>
                            suiteChecked
                              ? current.filter((id) => id !== suite.id)
                              : [...current, suite.id],
                          );
                          setSelectedCaseIds((current) =>
                            suiteChecked
                              ? current.filter((id) => !suiteCaseIds.includes(id))
                              : [...new Set([...current, ...suiteCaseIds])],
                          );
                        }}
                      />
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-decoration-none fw-bold text-start flex-grow-1"
                        onClick={() =>
                          setExpandedSuites((current) =>
                            expanded
                              ? current.filter((id) => id !== suite.id)
                              : [...current, suite.id],
                          )
                        }
                        aria-expanded={expanded}
                      >
                        {expanded ? "▾" : "▸"} {suite.nombre}
                      </Button>
                      <span className="x-small text-muted">
                        {suiteCases.length} caso(s)
                      </span>
                    </div>
                    {expanded &&
                      suiteCases.map((item) => {
                        const id = String(item.id);
                        const checked = selectedCaseIds.includes(id);
                        return (
                          <label
                            key={id}
                            className="d-flex align-items-center gap-2 border-bottom px-3 py-2"
                          >
                            <Form.Check
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedSuiteIds((current) => current.filter((suiteId) => suiteId !== suite.id));
                                setSelectedCaseIds((current) =>
                                  checked
                                    ? current.filter((value) => value !== id)
                                    : [...current, id],
                                );
                              }}
                            />
                            <span className="small">
                              {item.codigo || item.master_id} · {item.titulo}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </Modal.Body>
          <Modal.Footer className="border-0 pt-0">
            <Button
              variant="secondary"
              onClick={() => setShowExportPicker(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={exportCases}
              disabled={busy || !exportComponentId}
            >
              Exportar selección
            </Button>
          </Modal.Footer>
        </Modal>
        <div className="border rounded-3 p-3 mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <Form.Label className="small fw-bold mb-0">
              Importación de casos
            </Form.Label>
            <span className="x-small text-muted">
              Formatos externos compatibles
            </span>
          </div>
          <div className="small text-muted mb-2">
            Seleccioná un archivo para revisar y elegir qué casos incorporar al
            proyecto.
          </div>
        <div className="d-flex flex-wrap gap-2">
            <Button
              variant="outline-primary"
              onClick={() => {
                setShowExportPicker(false)
                setShowImportModal(true)
              }}
              disabled={busy || !canEdit}
            >
              <FileUp size={15} className="me-1" /> Importar
            </Button>
            <CaseImportGuide
              profile={selectedProfile}
              fetchWithAuth={fetchWithAuth}
              onSelectProfile={(nextProfileId) => {
                setProfileId(nextProfileId);
                setFile(null);
                setPreview(null);
                setExpandedImportCases([]);
              }}
            />
          </div>
        </div>
        <div style={{ display: "none" }}>
          <div className="border rounded-3 bg-light p-3 mt-3">
            <Row className="g-3 align-items-end">
              <Col md={6}>
                <Form.Control
                  type="file"
                  onChange={(event) => {
                    setFile(
                      (event.target as HTMLInputElement).files?.[0] || null,
                    );
                    setPreview(null);
                    setExpandedImportCases([]);
                  }}
                />
              </Col>
            </Row>
            {!canEdit && (
              <Alert variant="warning" className="small mt-3 mb-0">
                Tu rol permite consultar la portabilidad, pero no importar ni
                revertir lotes.
              </Alert>
            )}
            {busy && (
              <div className="small text-muted mt-3">
                <Spinner size="sm" className="me-2" />
                Procesando de forma segura…
              </div>
            )}
            {preview && (
              <Alert variant="info" className="mt-3 mb-0">
                Vista previa lista para confirmar.
              </Alert>
            )}
          </div>
        </div>
        <Modal
          show={showImportModal && !showExportPicker}
          onHide={() => setShowImportModal(false)}
          size="lg"
          centered
        >
          <Modal.Header closeButton className="border-0 pb-2">
            <Modal.Title className="h6 d-flex align-items-center gap-2">
              <span
                className="d-inline-flex align-items-center justify-content-center rounded-2"
                style={{ width: 34, height: 34, ...profileTone }}
              >
                <img
                  src={selectedVisual.logo}
                  alt=""
                  width={22}
                  height={22}
                  style={{ objectFit: "contain" }}
                />
              </span>
              Importar casos
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-0">
            <Form.Label className="small fw-bold">
              Herramienta y versión de origen
            </Form.Label>
            <Dropdown className="mb-3">
              <Dropdown.Toggle
                variant="light"
                className="w-100 d-flex align-items-center gap-3 border rounded-3 bg-white p-2 text-start shadow-sm"
                disabled={busy}
                aria-label="Seleccionar herramienta y versión de origen"
              >
                <span
                  className="d-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                  style={{ width: 44, height: 44, ...profileTone }}
                  aria-hidden="true"
                >
                  <img
                    src={selectedVisual.logo}
                    alt=""
                    width={28}
                    height={28}
                    style={{ objectFit: "contain" }}
                  />
                </span>
                <span className="flex-grow-1 min-w-0">
                  <span className="d-block fw-bold text-dark text-truncate">
                    {selectedProfile?.display_name ||
                      profileLabel(selectedProfile?.tool) ||
                      "Seleccionar herramienta"}
                  </span>
                  <span className="d-block x-small text-muted text-truncate">
                    {selectedProfile?.version || "Elegí una versión compatible"}
                    {selectedVerification && (
                      <span
                        className="ms-2 fw-semibold text-success"
                        title={selectedVerification.detail}
                      >
                        ✓ {selectedVerification.label}
                      </span>
                    )}
                  </span>
                </span>
                <Badge bg={selectedStatus.bg} className="me-2">
                  {selectedStatus.label}
                </Badge>
              </Dropdown.Toggle>
              <Dropdown.Menu
                className="w-100 p-2 shadow border-0"
                style={{ maxHeight: 320, overflowY: "auto" }}
              >
                {profiles.map((profile) => {
                  const visual = profileVisual(profile.tool);
                  const verification = profileVerification(profile);
                  const status = profileStatus(
                    profile.status,
                    Boolean(verification),
                  );
                  return (
                    <Dropdown.Item
                      key={profile.id}
                      active={profile.id === profileId}
                      disabled={!isProfileEnabled(profile)}
                      className="d-flex align-items-center gap-3 rounded-2 px-2 py-2 mb-1"
                      onClick={() => {
                        setProfileId(profile.id);
                        setFile(null);
                        setPreview(null);
                        setExpandedImportCases([]);
                      }}
                    >
                      <span
                        className="d-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                        style={{
                          width: 38,
                          height: 38,
                          color: visual.color,
                          background: visual.background,
                        }}
                        aria-hidden="true"
                      >
                        <img
                          src={visual.logo}
                          alt=""
                          width={24}
                          height={24}
                          style={{ objectFit: "contain" }}
                        />
                      </span>
                      <span className="flex-grow-1 min-w-0">
                        <span className="d-block fw-semibold text-truncate">
                          {profile.display_name || profileLabel(profile.tool)}
                        </span>
                        <span className="d-block x-small opacity-75 text-truncate">
                          {profile.version}
                          {verification && (
                            <span
                              className="ms-2 fw-semibold text-success"
                              title={verification.detail}
                            >
                              ✓ {verification.label}
                            </span>
                          )}
                        </span>
                      </span>
                      <Badge bg={status.bg}>{status.label}</Badge>
                    </Dropdown.Item>
                  );
                })}
              </Dropdown.Menu>
            </Dropdown>
            {selectedProfile?.reason && (
              <Alert variant="warning" className="small py-2">
                {selectedProfile.reason}
              </Alert>
            )}
            <Row className="g-3 mb-3">
              <Col md={12}>
                <Form.Label htmlFor="case-import-component" className="small fw-bold">
                  Componente destino
                </Form.Label>
                <Form.Select
                  id="case-import-component"
                  name="case_import_component"
                  value={importComponentId}
                  onChange={(event) => setImportComponentId(event.target.value)}
                  disabled={busy || components.length === 0}
                  required
                >
                  <option value="">Seleccionar componente…</option>
                  {components.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.nombre}
                    </option>
                  ))}
                </Form.Select>
                <div className="x-small text-muted mt-1">
                  Después podrás incluir los casos en una build desde su alcance
                  de ejecución.
                </div>
              </Col>
            </Row>
            {components.length === 0 && (
              <Alert variant="warning" className="small">
                Este proyecto no tiene componentes. Creá uno antes de importar
                para evitar casos sin destino operativo.
              </Alert>
            )}
            <Form.Label htmlFor="case-import-file" className="small fw-bold">
              Archivo de importación
            </Form.Label>
            <Form.Control
              id="case-import-file"
              name="case_import_file"
              type="file"
              accept={(selectedProfile?.extensions || []).join(",")}
              onChange={(event) => {
                setFile((event.target as HTMLInputElement).files?.[0] || null);
                setPreview(null);
                setExpandedImportCases([]);
              }}
              disabled={busy}
            />
            <div className="x-small text-muted mt-1">
              Formatos para este perfil:{" "}
              {selectedProfile?.extensions?.join(", ") || "—"}.
            </div>
            <Button
              className="mt-3"
              variant="outline-secondary"
              onClick={runPreview}
              disabled={!file || busy}
            >
              <ScanSearch size={15} className="me-1" /> Vista previa
            </Button>
            {preview && (
              <>
                {(preview.diagnostics?.warnings?.length > 0 ||
                  preview.diagnostics?.ignored_fields?.length > 0) && (
                  <Alert variant="warning" className="small mt-3 mb-2">
                    <div className="fw-semibold mb-1">
                      Revisá estas diferencias antes de importar
                    </div>
                    <ul className="mb-0 ps-3">
                      {(preview.diagnostics?.warnings || []).map(
                        (warning: string) => (
                          <li key={warning}>{warning}</li>
                        ),
                      )}
                      {preview.diagnostics?.ignored_fields?.length > 0 && (
                        <li>
                          Campos sin equivalente:{" "}
                          {preview.diagnostics.ignored_fields.join(", ")}
                        </li>
                      )}
                    </ul>
                  </Alert>
                )}
                <div className="d-flex flex-wrap gap-2 mt-3 mb-2">
                  <Badge bg="light" text="dark">
                    {preview.diagnostics?.suite_count || 0} suites
                  </Badge>
                  <Badge bg="light" text="dark">
                    {preview.diagnostics?.step_count || 0} pasos
                  </Badge>
                  <Badge bg="light" text="dark">
                    {preview.diagnostics?.cases_with_description || 0} con
                    descripción
                  </Badge>
                  <Badge bg="light" text="dark">
                    {preview.diagnostics?.cases_with_preconditions || 0} con
                    precondiciones
                  </Badge>
                </div>
                <div className="border rounded-3 overflow-hidden">
                <div className="d-flex align-items-center justify-content-between gap-3 bg-light border-bottom px-3 py-2">
                  <div>
                    <div className="small fw-bold">Estructura a importar</div>
                    <div className="x-small text-muted">
                      {selectedImportIds.length} de {preview.summary.total}{" "}
                      casos seleccionados
                    </div>
                  </div>
                  <div className="d-flex gap-2">
                    <Button
                      size="sm"
                      variant="outline-primary"
                      onClick={() =>
                        setSelectedImportIds(
                          (preview.package?.cases || []).map((item: any) =>
                            String(item.external_id),
                          ),
                        )
                      }
                    >
                      Seleccionar todos
                    </Button>
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => setSelectedImportIds([])}
                    >
                      Limpiar
                    </Button>
                  </div>
                </div>
                <div
                  className="p-2"
                  style={{ maxHeight: 440, overflowY: "auto", overscrollBehavior: "contain" }}
                >
                  {importGroups.map(({ path, items }) => {
                    const expanded = expandedImportSuites.includes(path);
                    const itemIds = items.map((item: any) =>
                      String(item.external_id),
                    );
                    const selectedCount = itemIds.filter((id: string) =>
                      selectedImportIds.includes(id),
                    ).length;
                    const allSelected = selectedCount === itemIds.length;
                    return (
                      <div key={path} className="mb-2">
                        <div className="d-flex align-items-center gap-2 rounded-2 bg-light px-2 py-2">
                          <Form.Check
                            type="checkbox"
                            checked={allSelected}
                            ref={(control: HTMLInputElement | null) => {
                              if (control)
                                control.indeterminate =
                                  selectedCount > 0 && !allSelected;
                            }}
                            onChange={() =>
                              setSelectedImportIds((current) =>
                                allSelected
                                  ? current.filter(
                                      (id) => !itemIds.includes(id),
                                    )
                                  : Array.from(
                                      new Set([...current, ...itemIds]),
                                    ),
                              )
                            }
                            aria-label={`Seleccionar suite ${path}`}
                          />
                          <Button
                            variant="link"
                            size="sm"
                            className="d-flex align-items-center gap-2 flex-grow-1 min-w-0 p-0 text-start text-decoration-none fw-semibold"
                            onClick={() =>
                              setExpandedImportSuites((current) =>
                                expanded
                                  ? current.filter((value) => value !== path)
                                  : [...current, path],
                              )
                            }
                            aria-expanded={expanded}
                          >
                            <ChevronRight
                              size={15}
                              aria-hidden="true"
                              style={{
                                transform: expanded
                                  ? "rotate(90deg)"
                                  : undefined,
                                transition: "transform 120ms ease",
                              }}
                            />
                            <Folder size={16} aria-hidden="true" />
                            <span className="text-truncate">{path}</span>
                          </Button>
                          <Badge bg="secondary">
                            {selectedCount}/{items.length}
                          </Badge>
                        </div>
                        {expanded && (
                          <div className="ps-4 pt-1">
                            {items.map((item: any) => {
                              const id = String(item.external_id);
                              const checked = selectedImportIds.includes(id);
                              const caseExpanded =
                                expandedImportCases.includes(id);
                              const outcome = preview.items?.find(
                                (result: any) =>
                                  String(result.external_id) === id,
                              )?.outcome;
                              return (
                                <div key={id} className="border-bottom">
                                  <div className="d-flex align-items-center gap-2 px-2 py-2">
                                    <Form.Check
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        setSelectedImportIds((current) =>
                                          checked
                                            ? current.filter(
                                                (value) => value !== id,
                                              )
                                            : [...current, id],
                                        )
                                      }
                                      aria-label={`Seleccionar caso ${item.titulo || id}`}
                                    />
                                    <Button
                                      variant="link"
                                      size="sm"
                                      className="d-flex align-items-center gap-2 flex-grow-1 min-w-0 p-0 text-start text-decoration-none text-body"
                                      onClick={() =>
                                        setExpandedImportCases((current) =>
                                          caseExpanded
                                            ? current.filter(
                                                (value) => value !== id,
                                              )
                                            : [...current, id],
                                        )
                                      }
                                      aria-expanded={caseExpanded}
                                      aria-label={`${caseExpanded ? "Contraer" : "Ver detalle de"} ${item.titulo || id}`}
                                    >
                                      <ChevronRight
                                        size={14}
                                        aria-hidden="true"
                                        style={{
                                          transform: caseExpanded
                                            ? "rotate(90deg)"
                                            : undefined,
                                          transition: "transform 120ms ease",
                                        }}
                                      />
                                      <FileCheck2
                                        size={15}
                                        className="text-primary flex-shrink-0"
                                        aria-hidden="true"
                                      />
                                      <span className="small flex-grow-1 min-w-0 text-truncate">
                                        {item.titulo || "Caso sin título"}
                                      </span>
                                    </Button>
                                    <Badge bg="light" text="dark">
                                      {(item.pasos || []).length} pasos
                                    </Badge>
                                    <Badge
                                      bg={
                                        outcome === "new"
                                          ? "success"
                                          : outcome === "new_version"
                                            ? "warning"
                                            : "secondary"
                                      }
                                    >
                                      {outcome === "new"
                                        ? "Nuevo"
                                        : outcome === "new_version"
                                          ? "Nueva versión"
                                          : "Sin cambios"}
                                    </Badge>
                                  </div>
                                  {caseExpanded && (
                                    <section
                                      className="bg-light-subtle px-3 pb-3 pt-2 ps-md-5"
                                      aria-label={`Detalle de ${item.titulo || id}`}
                                    >
                                      <div className="border rounded-3 bg-white p-3 mb-3">
                                        <dl className="row g-3 small mb-0">
                                          <div className="col-12">
                                            <dt className="x-small text-uppercase text-muted mb-1">
                                              Descripción
                                            </dt>
                                            <dd className="mb-0 text-break">
                                              {item.descripcion || "Sin descripción"}
                                            </dd>
                                          </div>
                                          <div className="col-12 col-md-6">
                                            <dt className="x-small text-uppercase text-muted mb-1">
                                              Precondiciones
                                            </dt>
                                            <dd className="mb-0 text-break">
                                              {item.precondiciones || "Sin precondiciones"}
                                            </dd>
                                          </div>
                                          <div className="col-12 col-md-6">
                                            <dt className="x-small text-uppercase text-muted mb-1">
                                              Postcondiciones
                                            </dt>
                                            <dd className="mb-0 text-break">
                                              {item.postcondiciones || "Sin postcondiciones"}
                                            </dd>
                                          </div>
                                        </dl>
                                        <hr className="my-3" />
                                        <dl className="row g-2 small mb-0">
                                          {[
                                            ["ID externo", item.external_id],
                                            ["Versión", item.external_version],
                                            ["Prioridad", item.prioridad],
                                            ["Criticidad", item.criticidad],
                                            ["Tipo", item.tipo_prueba],
                                            ["Estado", item.estado_caso],
                                            [
                                              "Etiquetas",
                                              (item.etiquetas || []).join(", "),
                                            ],
                                          ].map(([label, value]) => (
                                            <div
                                              key={label}
                                              className="col-6 col-lg-3"
                                            >
                                              <dt className="x-small text-uppercase text-muted mb-1">
                                                {label}
                                              </dt>
                                              <dd
                                                className="mb-0 fw-medium text-break"
                                                translate={
                                                  label === "ID externo"
                                                    ? "no"
                                                    : undefined
                                                }
                                              >
                                                {value || "Sin informar"}
                                              </dd>
                                            </div>
                                          ))}
                                        </dl>
                                      </div>
                                      <h4 className="small fw-semibold mb-2">
                                        Pasos del caso
                                      </h4>
                                      {(item.pasos || []).length > 0 ? (
                                        <div className="d-grid gap-2">
                                          {(item.pasos || []).map(
                                            (step: any, stepIndex: number) => (
                                              <div
                                                key={`${id}-step-${step.numero_paso || stepIndex + 1}`}
                                                className="border rounded-3 bg-white p-3 small"
                                              >
                                                <div className="d-flex align-items-center gap-2 mb-3">
                                                  <Badge bg="primary">
                                                    Paso {step.numero_paso || stepIndex + 1}
                                                  </Badge>
                                                </div>
                                                <dl className="row g-2 mb-0">
                                                  <dt className="col-12 col-sm-4 text-muted">
                                                    Acción
                                                  </dt>
                                                  <dd className="col-12 col-sm-8 mb-1 text-break">
                                                    {step.accion || "Sin acción"}
                                                  </dd>
                                                  <dt className="col-12 col-sm-4 text-muted">
                                                    Datos
                                                  </dt>
                                                  <dd className="col-12 col-sm-8 mb-1 text-break">
                                                    {step.datos || "Sin datos específicos"}
                                                  </dd>
                                                  <dt className="col-12 col-sm-4 text-muted">
                                                    Resultado esperado
                                                  </dt>
                                                  <dd className="col-12 col-sm-8 mb-0 text-break">
                                                    {step.resultado_esperado || "Sin resultado esperado"}
                                                  </dd>
                                                </dl>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      ) : (
                                        <Alert variant="warning" className="small py-2 mb-0">
                                          Este caso no contiene pasos.
                                        </Alert>
                                      )}
                                    </section>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>
              </>
            )}
          </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
            <Button
              variant="secondary"
              onClick={() => setShowImportModal(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={importCases}
              disabled={
                !preview ||
                busy ||
                selectedImportIds.length === 0 ||
                !importComponentId ||
                !isProfileEnabled(selectedProfile)
              }
            >
              Importar {selectedImportIds.length || "selección"}
            </Button>
          </Modal.Footer>
        </Modal>
        <div className="d-flex align-items-center gap-2 mt-4 mb-2">
          <History size={16} />
          <h6 className="mb-0 fw-bold">Lotes recientes</h6>
        </div>
        <div className="table-responsive">
          <Table size="sm" hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>Origen</th>
                <th>Archivo</th>
                <th>Resultado</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    {batch.source_tool} · {batch.source_version}
                  </td>
                  <td>{batch.file_name || "—"}</td>
                  <td>
                    {batch.summary?.new || 0} nuevos /{" "}
                    {batch.summary?.new_versions || 0} versiones
                  </td>
                  <td>
                    <Badge
                      bg={
                        batch.status === "COMPLETED" ? "success" : "secondary"
                      }
                    >
                      {batch.status}
                    </Badge>
                  </td>
                  <td>
                    {batch.rollback_available && canEdit && (
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => rollback(batch)}
                        disabled={busy}
                      >
                        <RotateCcw size={13} className="me-1" />
                        Revertir
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted text-center py-3">
                    No hay lotes de importación en este proyecto.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </Card.Body>
    </Card>
  );
}
