import type { Dispatch, SetStateAction } from "react";
import {
  Alert,
  Badge,
  Button,
  Col,
  Dropdown,
  Form,
  Modal,
  Row,
} from "react-bootstrap";
import { ScanSearch } from "lucide-react";
import { CaseImportPreview } from "./CaseImportPreview";
import {
  profileLabel,
  profileStatus,
  profileVerification,
  profileVisual,
} from "./casePortabilityUtils";

type Props = {
  show: boolean;
  onHide: () => void;
  t: (key: string, values?: Record<string, unknown>) => string;
  busy: boolean;
  profiles: any[];
  selectedProfile?: any;
  profileId: string;
  setProfileId: (value: string) => void;
  setFile: (value: File | null) => void;
  file: File | null;
  setPreview: (value: any) => void;
  selectedVisual: any;
  profileTone: any;
  selectedVerification: any;
  selectedStatus: any;
  components: any[];
  importComponentId: string;
  setImportComponentId: (value: string) => void;
  runPreview: () => void;
  importCases: () => void;
  preview: any;
  importGroups: any[];
  selectedImportIds: string[];
  setSelectedImportIds: Dispatch<SetStateAction<string[]>>;
  expandedImportSuites: string[];
  setExpandedImportSuites: Dispatch<SetStateAction<string[]>>;
  expandedImportCases: string[];
  setExpandedImportCases: Dispatch<SetStateAction<string[]>>;
};

const isProfileEnabled = (profile?: any) =>
  Boolean(profile) && profile.import_enabled !== false && profile.status !== "blocked";

export function CaseImportModal({
  show, onHide, t, busy, profiles, selectedProfile, profileId, setProfileId,
  setFile, file, setPreview, selectedVisual, profileTone, selectedVerification,
  selectedStatus, components, importComponentId, setImportComponentId, runPreview,
  importCases, preview, importGroups, selectedImportIds, setSelectedImportIds,
  expandedImportSuites, setExpandedImportSuites, expandedImportCases,
  setExpandedImportCases,
}: Props) {
  return (<Modal
  show={show}
  onHide={onHide}
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
      {t("configuracion.importTitle")}
    </Modal.Title>
  </Modal.Header>
  <Modal.Body className="pt-0">
    <Form.Label className="small fw-bold">
      {t("configuracion.sourceToolVersion")}
    </Form.Label>
    <Dropdown className="mb-3">
      <Dropdown.Toggle
        variant="light"
        className="w-100 d-flex align-items-center gap-3 border rounded-3 bg-white p-2 text-start shadow-sm"
        disabled={busy}
        aria-label={t("configuracion.selectSourceTool")}
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
              profileLabel(selectedProfile?.tool, (key) => t(key as any)) ||
              t("configuracion.selectTool")}
          </span>
          <span className="d-block x-small text-muted text-truncate">
            {selectedProfile?.version || t("configuracion.compatibleVersion")}
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
            (key) => t(key as any),
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
                  {profile.display_name || profileLabel(profile.tool, (key) => t(key as any))}
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
          {t("configuracion.targetComponent")}
        </Form.Label>
        <Form.Select
          id="case-import-component"
          name="case_import_component"
          value={importComponentId}
          onChange={(event) => setImportComponentId(event.target.value)}
          disabled={busy || components.length === 0}
          required
        >
          <option value="">{t("configuracion.selectComponent")}</option>
          {components.map((component) => (
            <option key={component.id} value={component.id}>
              {component.nombre}
            </option>
          ))}
        </Form.Select>
        <div className="x-small text-muted mt-1">
          {t("configuracion.importComponentHint")}
        </div>
      </Col>
    </Row>
    {components.length === 0 && (
      <Alert variant="warning" className="small">
        {t("configuracion.noComponentsForImport")}
      </Alert>
    )}
    <Form.Label htmlFor="case-import-file" className="small fw-bold">
      {t("configuracion.importFile")}
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
      {t("configuracion.profileFormats")}{" "}
      {selectedProfile?.extensions?.join(", ") || "—"}.
    </div>
    <Button
      className="mt-3"
      variant="outline-secondary"
      onClick={runPreview}
      disabled={!file || busy}
    >
      <ScanSearch size={15} className="me-1" /> {t("configuracion.preview")}
    </Button>
    {preview && (
      <>
        {(preview.diagnostics?.warnings?.length > 0 ||
          preview.diagnostics?.ignored_fields?.length > 0) && (
          <Alert variant="warning" className="small mt-3 mb-2">
            <div className="fw-semibold mb-1">
              {t("configuracion.reviewDifferences")}
            </div>
            <ul className="mb-0 ps-3">
              {(preview.diagnostics?.warnings || []).map(
                (warning: string) => (
                  <li key={warning}>{warning}</li>
                ),
              )}
              {preview.diagnostics?.ignored_fields?.length > 0 && (
                <li>
                  {t("configuracion.unmappedFields")}:{" "}
                  {preview.diagnostics.ignored_fields.join(", ")}
                </li>
              )}
            </ul>
          </Alert>
        )}
        <div className="d-flex flex-wrap gap-2 mt-3 mb-2">
          <Badge bg="light" text="dark">
            {preview.diagnostics?.suite_count || 0} {t("configuracion.suites")}
          </Badge>
          <Badge bg="light" text="dark">
            {preview.diagnostics?.step_count || 0} {t("configuracion.steps")}
          </Badge>
          <Badge bg="light" text="dark">
            {preview.diagnostics?.cases_with_description || 0} {t("configuracion.withDescription")}
          </Badge>
          <Badge bg="light" text="dark">
            {preview.diagnostics?.cases_with_preconditions || 0} {t("configuracion.withPreconditions")}
          </Badge>
        </div>
        <CaseImportPreview
          t={t}
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
    )}
  </Modal.Body>
<Modal.Footer className="border-0 pt-0">
    <Button
      variant="secondary"
              onClick={onHide}
    >
      {t("configuracion.cancel")}
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
      {t("configuracion.importSelected", { count: selectedImportIds.length || t("configuracion.selection") })}
    </Button>
  </Modal.Footer>
</Modal>);

}
