import { Button, Form, Modal, Badge } from "react-bootstrap";
import { Download, FileUp } from "lucide-react";
import { CaseImportGuide } from "./CaseImportGuide";
import { CaseImportModal } from "./CaseImportModal";
import { CaseExportPicker } from "./CaseExportPicker";

type Props = {
  t: (key: string, values?: Record<string, unknown>) => string;
  busy: boolean;
  canEdit: boolean;
  projectId: string;
  selectedProfile: any;
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  setProfileId: (value: string) => void;
  setFile: (value: File | null) => void;
  setPreview: (value: any) => void;
  setShowExportPicker: (value: boolean) => void;
  setShowImportModal: (value: boolean) => void;
  exportProps: any;
  importProps: any;
};

export function CasePortabilityActions({
  t, busy, canEdit, projectId, selectedProfile, fetchWithAuth, setProfileId,
  setFile, setPreview, setShowExportPicker,
  setShowImportModal, exportProps, importProps,
}: Props) {
  const {
    showExportPicker, showImportModal, components, exportComponentId,
    setExportComponentId, suites, cases, selectedSuiteIds, setSelectedSuiteIds,
    selectedCaseIds, setSelectedCaseIds, expandedSuites, setExpandedSuites,
    exportCases,
  } = exportProps;
  const {
    profiles, profileId, selectedVisual, profileTone, selectedVerification,
    selectedStatus, importComponentId, setImportComponentId, runPreview,
    importCases, preview, importGroups, selectedImportIds, setSelectedImportIds,
    expandedImportSuites, setExpandedImportSuites, expandedImportCases,
    setExpandedImportCases, file,
  } = importProps;
  return (
    <>
<div className="border rounded-3 p-3 mb-3">
  <div className="d-flex justify-content-between align-items-center mb-2">
    <Form.Label className="small fw-bold mb-0">
      {t("configuracion.tresekoExport")}
    </Form.Label>
    <span className="x-small text-muted">{t("configuracion.tcasesFormat")}</span>
  </div>
  <div className="small text-muted mb-2">
    {t("configuracion.exportSelectionHint")}
  </div>
  <Button
    variant="outline-primary"
    onClick={() => setShowExportPicker(true)}
    disabled={!projectId || busy}
  >
    <Download size={15} className="me-1" /> {t("configuracion.exportTitle")}
  </Button>
</div>
<CaseExportPicker
  show={showExportPicker}
  onHide={() => setShowExportPicker(false)}
  t={t}
  busy={busy}
  components={components}
  exportComponentId={exportComponentId}
  setExportComponentId={setExportComponentId}
  suites={suites}
  cases={cases}
  selectedSuiteIds={selectedSuiteIds}
  setSelectedSuiteIds={setSelectedSuiteIds}
  selectedCaseIds={selectedCaseIds}
  setSelectedCaseIds={setSelectedCaseIds}
  expandedSuites={expandedSuites}
  setExpandedSuites={setExpandedSuites}
  exportCases={exportCases}
/>
<div className="border rounded-3 p-3 mb-3">
  <div className="d-flex justify-content-between align-items-center mb-2">
    <Form.Label className="small fw-bold mb-0">
      {t("configuracion.caseImportTitle")}
    </Form.Label>
    <span className="x-small text-muted">
      {t("configuracion.externalFormats")}
    </span>
  </div>
  <div className="small text-muted mb-2">
    {t("configuracion.importSelectionHint")}
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
      <FileUp size={15} className="me-1" /> {t("configuracion.importTitle")}
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
<CaseImportModal
  show={showImportModal}
  onHide={() => setShowImportModal(false)}
  t={t}
  busy={busy}
  profiles={profiles}
  selectedProfile={selectedProfile}
  profileId={profileId}
  setProfileId={(value) => {
    setProfileId(value);
    setFile(null);
    setPreview(null);
    setExpandedImportCases([]);
  }}
  setFile={setFile}
  file={file}
  setPreview={setPreview}
  selectedVisual={selectedVisual}
  profileTone={profileTone}
  selectedVerification={selectedVerification}
  selectedStatus={selectedStatus}
  components={components}
  importComponentId={importComponentId}
  setImportComponentId={setImportComponentId}
  runPreview={runPreview}
  importCases={importCases}
  preview={preview}
  importGroups={importGroups}
  selectedImportIds={selectedImportIds}
  setSelectedImportIds={setSelectedImportIds}
  expandedImportSuites={expandedImportSuites}
  setExpandedImportSuites={setExpandedImportSuites}
  expandedImportCases={expandedImportCases}
  setExpandedImportCases={setExpandedImportCases}
/>

    </>
  );
}
