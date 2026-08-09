import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Table,
} from "react-bootstrap";
import { History, RotateCcw } from "lucide-react";
import { API_BASE } from "../../../../app/constants";
import { CaseImportGuide } from "./CaseImportGuide";
import { CasePortabilityActions } from "./CasePortabilityActions";
import { CaseImportModal } from "./CaseImportModal";
import { useI18n } from "../../../../i18n";
import {
  isProfileEnabled, profileLabel, profileStatus, profileVerification,
  profileVisual, readAsBase64,
} from "./casePortabilityUtils";
import type { Component, ImportBatch, Profile, Project, Props, Suite } from "./casePortabilityUtils";

export function CasePortabilityPanel({
  fetchWithAuth,
  showFeedback,
  canEdit,
  initialProjectId,
  embedded = false,
}: Props) {
  const { t } = useI18n();
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
    (key) => t(key as any),
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
    if (!file) throw new Error(t("configuracion.caseSelectFile"));
    return {
      profile_id: profileId,
      file_name: file.name,
      content_base64: await readAsBase64(file, t('configuracion.caseReadFileError')),
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
        t("configuracion.preview"),
        error.message || t("configuracion.casePreviewError"),
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
        t("configuracion.importCompleted"),
        t("configuracion.importSummary", { cases: data.summary?.new || 0, versions: data.summary?.new_versions || 0 }),
        "success",
      );
    } catch (error: any) {
      showFeedback(
        t("configuracion.importTitle"),
        error.message || t("configuracion.importError"),
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
        t("configuracion.exportTitle"),
        error.message || t("configuracion.exportError"),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };
  const rollback = async (batch: ImportBatch) => {
    if (
      !window.confirm(
        t("configuracion.rollbackConfirm", { batch: batch.file_name || batch.id }),
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
        t("configuracion.rollbackCompleted"),
        t("configuracion.rollbackSuccess"),
        "success",
      );
    } catch (error: any) {
      showFeedback(
        t("configuracion.rollbackTitle"),
        error.message || t("configuracion.rollbackError"),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };
  const exportProps = {
    showExportPicker, showImportModal,
    components, exportComponentId, setExportComponentId, suites, cases,
    selectedSuiteIds, setSelectedSuiteIds, selectedCaseIds, setSelectedCaseIds,
    expandedSuites, setExpandedSuites,
  };
  const importProps = {
    showExportPicker, showImportModal,
    profiles, selectedProfile, profileId, selectedVisual, profileTone,
    selectedVerification, selectedStatus, components, importComponentId,
    setImportComponentId, preview, importGroups, selectedImportIds,
    setSelectedImportIds, expandedImportSuites, setExpandedImportSuites,
    expandedImportCases, setExpandedImportCases, setFile, file, setPreview,
    setProfileId, runPreview, importCases,
  };
  return (
    <Card className="border-0 shadow-sm rounded-4 mb-3">
      <Card.Body className="p-4">
        <div className="d-flex justify-content-between gap-3 align-items-start mb-3">
          <div>
            <h6 className="fw-bold mb-1">{t("configuracion.casePortabilityTitle")}</h6>
            <p className="small text-muted mb-0">
              {t("configuracion.casePortabilityDesc")} <code>.tcases</code>. {t("configuracion.previewNoWrite")}
            </p>
          </div>
          <Badge bg="success">{t("configuracion.official")}</Badge>
        </div>
        {!embedded && (
          <Row className="g-3">
            <Col md={6}>
              <Form.Label className="small fw-bold">{t("configuracion.project")}</Form.Label>
              <Form.Select name="a11y-caseportabilitypaneltsx-321" aria-label="Campo de formulario"
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
            {t("configuracion.officialExport")}{" "}
            <code>.tcases</code>.
          </div>
        )}
        <CasePortabilityActions
          t={t}
          busy={busy}
          canEdit={canEdit}
          projectId={projectId}
          selectedProfile={selectedProfile}
          fetchWithAuth={fetchWithAuth}
          setProfileId={setProfileId}
          setFile={setFile}
          setPreview={setPreview}
          setShowExportPicker={setShowExportPicker}
          setShowImportModal={setShowImportModal}
          exportProps={{
            ...exportProps,
            t,
            busy,
            exportCases,
          }}
          importProps={{
            ...importProps,
            t,
            busy,
            importCases,
          }}
        />
        <div className="d-flex align-items-center gap-2 mt-4 mb-2">
          <History size={16} />
          <h6 className="mb-0 fw-bold">{t("configuracion.recentBatches")}</h6>
        </div>
        <div className="table-responsive">
          <Table size="sm" hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>{t("configuracion.source")}</th>
                <th>{t("configuracion.file")}</th>
                <th>{t("configuracion.result")}</th>
                <th>{t("configuracion.status")}</th>
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
                        {t("configuracion.rollback")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted text-center py-3">
                    {t("configuracion.noImportBatches")}
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
