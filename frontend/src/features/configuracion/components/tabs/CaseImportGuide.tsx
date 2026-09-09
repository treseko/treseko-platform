import { useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Modal,
  OverlayTrigger,
  Table,
  Tooltip,
} from "react-bootstrap";
import { Archive, Download, FileSpreadsheet, HelpCircle } from "lucide-react";
import { API_BASE } from "../../../../app/constants";
import { useI18n } from "../../../../i18n";

type GuideProfile = {
  id: string;
  tool: string;
  version: string;
  display_name?: string;
  extensions: string[];
  status: string;
};

type Props = {
  profile?: GuideProfile;
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  onSelectProfile?: (profileId: string) => void;
};

const profileGuidanceKeys: Record<string, string> = {
  "treseko/tcases-v1": "guidanceTcases", "csv/structured-v1": "guidanceCsv",
  "testlink/xml-v1": "guidanceTestlink", "testrail/xml-v1": "guidanceTestrailXml",
  "testrail/csv-v1": "guidanceTestrailCsv", "xray/csv-v1": "guidanceXrayCsv",
  "xray/json-v1": "guidanceXrayJson", "zephyr/json-v1": "guidanceZephyrJson",
  "zephyr/xml-v1": "guidanceZephyrXml", "azure-test-plans/csv-v1": "guidanceAzure",
  "qase/csv-v1": "guidanceQaseCsv", "qase/json-v1": "guidanceQaseJson",
  "qtest/excel-v1": "guidanceQtest", "practitest/csv-v1": "guidancePractitest",
  "gherkin/feature-v1": "guidanceGherkin",
};

const csvFields = [
  ["id", "yes", "importGuideCsvFieldId"], ["title", "no", "importGuideCsvFieldTitle"],
  ["suite", "no", "importGuideCsvFieldSuite"], ["description", "no", "importGuideCsvFieldDescription"],
  ["preconditions", "no", "importGuideCsvFieldPreconditions"], ["postconditions", "no", "importGuideCsvFieldPostconditions"],
  ["priority", "no", "importGuideCsvFieldPriority"], ["severity", "no", "importGuideCsvFieldSeverity"],
  ["type", "no", "importGuideCsvFieldType"], ["status", "no", "importGuideCsvFieldStatus"],
  ["tags", "no", "importGuideCsvFieldTags"], ["external_version", "no", "importGuideCsvFieldVersion"],
  ["step_number", "no", "importGuideCsvFieldStepNumber"], ["step_action", "no", "importGuideCsvFieldAction"],
  ["step_data", "no", "importGuideCsvFieldData"], ["step_expected", "no", "importGuideCsvFieldExpected"],
];

const csvRows = [
  [
    "id", "title", "suite", "description", "preconditions", "postconditions",
    "priority", "severity", "type", "status", "tags", "external_version",
    "step_number", "step_action", "step_data", "step_expected",
  ],
  [
    "TC-LOGIN-001", "Inicio de sesión válido", "Web/Autenticación",
    "Validar el acceso de un usuario activo", "El usuario existe y está habilitado",
    "La sesión queda iniciada", "HIGH", "CRITICAL", "MANUAL", "ACTIVE",
    "smoke;login", "1", "1", "Abrir la pantalla de acceso",
    "URL: https://app.example.test/login", "El formulario es visible",
  ],
  [
    "TC-LOGIN-001", "Inicio de sesión válido", "Web/Autenticación",
    "Validar el acceso de un usuario activo", "El usuario existe y está habilitado",
    "La sesión queda iniciada", "HIGH", "CRITICAL", "MANUAL", "ACTIVE",
    "smoke;login", "1", "2", "Ingresar credenciales válidas", "Usuario: qa@example.test",
    "Se muestra el dashboard",
  ],
  [
    "TC-LOGIN-002", "Contraseña incorrecta", "Web/Autenticación",
    "Validar el rechazo de una clave inválida", "El usuario existe",
    "La sesión no se inicia", "MEDIUM", "HIGH", "MANUAL", "ACTIVE",
    "negative;login", "1", "1", "Ingresar una contraseña incorrecta",
    "Contraseña: inválida", "Se informa que las credenciales son inválidas",
  ],
];

const csvExample = csvRows
  .map((row) =>
    row
      .map((value) =>
        /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value,
      )
      .join(","),
  )
  .join("\n");

const downloadTemplate = () => {
  const blob = new Blob(["\ufeff", csvExample], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "plantilla-importacion-casos-treseko.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export function CaseImportGuide({
  profile,
  fetchWithAuth,
  onSelectProfile,
}: Props) {
  const { t } = useI18n();
  const text = (key: string) => t(`configuracion.${key}`);
  const [show, setShow] = useState(false);
  const [downloadingTcases, setDownloadingTcases] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const profileName = profile?.display_name || profile?.tool || text("importGuideExternalFormat");

  const downloadTcasesExample = async () => {
    try {
      onSelectProfile?.("treseko/tcases-v1");
      setDownloadingTcases(true);
      setDownloadError("");
      const response = await fetchWithAuth(
        `${API_BASE}/case-portability/templates/tcases-example`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || text("importGuideDownloadTcasesError"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ejemplo-migracion-treseko.tcases";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setDownloadError(error.message || text("importGuideDownloadError"));
    } finally {
      setDownloadingTcases(false);
    }
  };

  return (
    <>
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>{text("importGuideTooltip")}</Tooltip>}
      >
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={() => setShow(true)}
          aria-label={text("importGuideOpen")}
        >
          <HelpCircle size={15} className="me-1" aria-hidden="true" />
          {text("importGuideButton")}
        </Button>
      </OverlayTrigger>

      <Modal show={show} onHide={() => setShow(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="h5">{text("importGuideTitle")}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex gap-3 mb-4">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary flex-shrink-0"
              style={{ width: 46, height: 46 }}
              aria-hidden="true"
            >
              <FileSpreadsheet size={23} />
            </span>
            <div>
              <div className="fw-bold">{text("importGuideIntroTitle")}</div>
              <div className="small text-muted">
                {text("importGuideIntroDescription")}
              </div>
            </div>
          </div>

          <div className="row g-2 mb-4">
            {[
              ["1", text("importGuideStepExport"), text("importGuideStepExportDesc")],
              ["2", text("importGuideStepReview"), text("importGuideStepReviewDesc")],
              ["3", text("importGuideStepConfirm"), text("importGuideStepConfirmDesc")],
            ].map(([number, title, text]) => (
              <div className="col-md-4" key={number}>
                <div className="border rounded-3 h-100 p-3">
                  <Badge bg="primary" pill className="mb-2">{number}</Badge>
                  <div className="small fw-bold">{title}</div>
                  <div className="x-small text-muted">{text}</div>
                </div>
              </div>
            ))}
          </div>

          {profile && (
            <Alert variant="info" className="small">
              <div className="fw-bold mb-1">
                {profileName} · {profile.version}
              </div>
              <div>{profileGuidanceKeys[profile.id] ? t(`configuracion.${profileGuidanceKeys[profile.id]}`) : text("importGuideProfileFallback")}</div>
              <div className="mt-1">
                {text("importGuideSupportedExtensions")} <strong>{profile.extensions.join(", ")}</strong>.
              </div>
            </Alert>
          )}

          <h6 className="fw-bold mt-4">{text("importGuideAdapt")}</h6>
          <p className="small text-muted">
            {text("importGuideLevels")}<code>.tcases</code>{text("importGuideTcasesSuffix")}
          </p>

          <Accordion className="mb-3">
            <Accordion.Item eventKey="tcases">
              <Accordion.Header>
                <span className="d-flex align-items-center gap-2">
                  <Archive size={17} className="text-primary" />
                  <strong>.tcases</strong> · {text("importGuideCompleteMigration")}
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <p className="small text-muted">
                  {text("importGuideZipDescription")}<code>manifest.json</code>.
                </p>
                <div className="table-responsive border rounded-3 mb-3">
                  <Table size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr><th>{text("importGuideEntry")}</th><th>{text("importGuideContents")}</th></tr>
                    </thead>
                    <tbody>
                      <tr><td><code>manifest.json</code></td><td className="small">{text("importGuideManifest")}</td></tr>
                      <tr><td><code>suites.json</code></td><td className="small">{text("importGuideSuites")}</td></tr>
                      <tr><td><code>cases.json</code></td><td className="small">{text("importGuideCases")}</td></tr>
                      <tr><td><code>versions.json</code></td><td className="small">{text("importGuideVersions")}</td></tr>
                      <tr><td><code>attachments.json</code></td><td className="small">{text("importGuideAttachments")}</td></tr>
                      <tr><td><code>attachments/…</code></td><td className="small">{text("importGuideAttachmentFiles")}</td></tr>
                    </tbody>
                  </Table>
                </div>
                <div className="small fw-bold mb-1">{text("importGuideCaseFields")}</div>
                <div className="small text-muted mb-2">
                  <code>external_id</code>, <code>external_version</code>, <code>suite_id</code>,
                  {" "}<code>titulo</code>, <code>descripcion</code>, <code>precondiciones</code>,
                  {" "}<code>postcondiciones</code>, <code>prioridad</code>, <code>criticidad</code>,
                  {" "}<code>tipo_prueba</code>, <code>estado_caso</code>, <code>etiquetas</code> y <code>pasos</code>.
                </div>
                <div className="small fw-bold mb-1">{text("importGuideStepFields")}</div>
                <div className="small text-muted mb-3">
                  <code>numero_paso</code>, <code>accion</code>, <code>datos</code> y
                  {" "}<code>resultado_esperado</code>. Un adjunto agrega
                  {" "}<code>case_external_id</code>, <code>step_number</code>,
                  {" "}<code>filename</code>, <code>content_type</code>, <code>size</code>,
                  {" "}<code>sha256</code>, <code>tipo</code> y <code>archive_path</code>.
                </div>
                <Alert variant="secondary" className="small py-2">
                  {text("importGuideMainValues")}<strong>ALTA, MEDIA, BAJA</strong>; {text("importGuideSeverity")}<strong>CRITICA, ALTA, MEDIA, BAJA</strong>; {text("importGuideType")}<strong>MANUAL o AUTOMATIZADA</strong>; {text("importGuideStatus")}<strong>ACTIVO o ARCHIVADO</strong>.
                </Alert>
                {downloadError && <Alert variant="danger" className="small py-2">{downloadError}</Alert>}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={downloadTcasesExample}
                  disabled={downloadingTcases}
                >
                  <Download size={14} className="me-1" aria-hidden="true" />
                  {downloadingTcases ? text("importGuideGenerating") : text("importGuideDownloadTcases")}
                </Button>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey="csv">
              <Accordion.Header>
                <span className="d-flex align-items-center gap-2">
                  <FileSpreadsheet size={17} className="text-success" />
                  <strong>{text("importGuideCsvTitle")}</strong> · {text("importGuideSimpleMigration")}
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <p className="small text-muted">
                  {text("importGuideCsvDescriptionStart")}<code>id</code>, <code>title</code>{text("importGuideAnd")}<code>suite</code>{text("importGuideCsvDescriptionMiddle")}<code>id</code>{text("importGuideCsvDescriptionOrder")}<code>step_number</code>. {text("importGuideSelect")}<strong>{text("importGuideCsvTitle")}</strong>{text("importGuideCsvDescriptionEnd")}<code>suite</code>.
                </p>
                <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
                  <div className="small fw-bold">{text("importGuideSupportedColumns")}</div>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => {
                      onSelectProfile?.("csv/structured-v1");
                      downloadTemplate();
                    }}
                  >
                    <Download size={14} className="me-1" aria-hidden="true" />
                    {text("importGuideDownloadCsv")}
                  </Button>
                </div>
                <div className="table-responsive border rounded-3">
                  <Table size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr><th>{text("importGuideColumn")}</th><th>{text("importGuideRequired")}</th><th>{text("importGuideUsage")}</th></tr>
                    </thead>
                    <tbody>
                      {csvFields.map(([field, required, description]) => (
                        <tr key={field}>
                          <td><code>{field}</code></td>
                          <td>{text(required)}</td>
                          <td className="small text-muted">{text(description)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>

          <Alert variant="light" className="border small mt-3 mb-0">
            {text("importGuideWarning")}
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShow(false)}>{text("importGuideGotIt")}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
