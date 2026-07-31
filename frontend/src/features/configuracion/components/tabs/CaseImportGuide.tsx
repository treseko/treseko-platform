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
  ["id", "yes", "csvId"],
  ["title", "Sí", "Nombre visible del caso de prueba."],
  ["suite", "No", "Ruta jerárquica separada por /, por ejemplo Web/Autenticación."],
  ["description", "No", "Objetivo o alcance del caso, en texto."],
  ["preconditions", "No", "Estado requerido antes de ejecutar el caso."],
  ["postconditions", "No", "Estado esperado después de completar el caso."],
  ["priority", "No", "HIGH, MEDIUM o LOW."],
  ["severity", "No", "CRITICAL, HIGH, MEDIUM o LOW."],
  ["type", "No", "MANUAL o AUTOMATED."],
  ["status", "No", "ACTIVE o ARCHIVED."],
  ["tags", "No", "Etiquetas separadas por coma o punto y coma."],
  ["external_version", "No", "Versión del caso en el sistema de origen."],
  ["step_number", "No", "Orden del paso dentro del caso."],
  ["step_action", "No", "Acción que debe ejecutar la persona o automatización."],
  ["step_data", "No", "Datos, parámetros o valores utilizados por el paso."],
  ["step_expected", "No", "Resultado esperado específico del paso."],
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
  const { locale, t } = useI18n();
  const text = (es: string, en: string) => locale === "en" ? en : es;
  const [show, setShow] = useState(false);
  const [downloadingTcases, setDownloadingTcases] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const profileName = profile?.display_name || profile?.tool || text("Formato externo", "External format");

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
        throw new Error(body.detail || text("No se pudo generar el ejemplo .tcases.", "Could not generate the .tcases example."));
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
      setDownloadError(error.message || text("No se pudo descargar el ejemplo.", "Could not download the example."));
    } finally {
      setDownloadingTcases(false);
    }
  };

  return (
    <>
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>{text("Cómo preparar un archivo compatible", "How to prepare a compatible file")}</Tooltip>}
      >
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={() => setShow(true)}
          aria-label={text("Abrir guía de importación de casos", "Open case import guide")}
        >
          <HelpCircle size={15} className="me-1" aria-hidden="true" />
          {text("Guía de importación", "Import guide")}
        </Button>
      </OverlayTrigger>

      <Modal show={show} onHide={() => setShow(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="h5">{text("Preparar casos para importar", "Prepare cases for import")}</Modal.Title>
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
              <div className="fw-bold">{text("Importá sin modificar el archivo original", "Import without modifying the original file")}</div>
              <div className="small text-muted">
                {text("Elegí la herramienta que produjo el archivo, revisá la vista previa y confirmá únicamente los casos que necesitás.", "Choose the tool that produced the file, review the preview, and confirm only the cases you need.")}
              </div>
            </div>
          </div>

          <div className="row g-2 mb-4">
            {[
              ["1", text("Exportar", "Export"), text("Generá el archivo desde la herramienta de origen.", "Generate the file from the source tool.")],
              ["2", text("Revisar", "Review"), text("Elegí el perfil correcto y ejecutá Vista previa.", "Choose the correct profile and run Preview.")],
              ["3", text("Confirmar", "Confirm"), text("Controlá el árbol, los avisos y los casos seleccionados.", "Check the tree, warnings, and selected cases.")],
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
              <div>{profileGuidanceKeys[profile.id] ? t(`configuracion.${profileGuidanceKeys[profile.id]}`) : text("Usá el archivo exportado por la herramienta y verificá su contenido en la vista previa.", "Use the file exported by the tool and verify its content in the preview.")}</div>
              <div className="mt-1">
                {text("Extensiones admitidas:", "Supported extensions:")} <strong>{profile.extensions.join(", ")}</strong>.
              </div>
            </Alert>
          )}

          <h6 className="fw-bold mt-4">{text("Adaptar otra herramienta a Treseko", "Adapt another tool to Treseko")}</h6>
          <p className="small text-muted">
            {text("Elegí el nivel de migración según la información que necesites conservar. El paquete ", "Choose the migration level based on the information you need to preserve. The ")}<code>.tcases</code>{text(" es el formato completo; el CSV es una alternativa más sencilla para casos sin adjuntos.", " package is the complete format; CSV is a simpler alternative for cases without attachments.")}
          </p>

          <Accordion className="mb-3">
            <Accordion.Item eventKey="tcases">
              <Accordion.Header>
                <span className="d-flex align-items-center gap-2">
                  <Archive size={17} className="text-primary" />
                  <strong>.tcases</strong> · {text("migración completa", "complete migration")}
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <p className="small text-muted">
                  {text("Es un ZIP versionado. Conserva suites anidadas, casos, pasos, versiones y archivos adjuntos. Cada JSON declarado debe tener su SHA-256 en ", "It is a versioned ZIP. It preserves nested suites, cases, steps, versions, and attachments. Each declared JSON must have its SHA-256 in ")}<code>manifest.json</code>.
                </p>
                <div className="table-responsive border rounded-3 mb-3">
                  <Table size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr><th>{text("Entrada", "Entry")}</th><th>{text("Contenido", "Contents")}</th></tr>
                    </thead>
                    <tbody>
                      <tr><td><code>manifest.json</code></td><td className="small">Formato, fecha, proyecto, cantidad y checksums.</td></tr>
                      <tr><td><code>suites.json</code></td><td className="small">ID, parent_id, nombre, descripción y orden.</td></tr>
                      <tr><td><code>cases.json</code></td><td className="small">Definición completa de cada caso y sus pasos.</td></tr>
                      <tr><td><code>versions.json</code></td><td className="small">Relación entre master_id, versión y definición.</td></tr>
                      <tr><td><code>attachments.json</code></td><td className="small">Metadatos, hashes y vínculo con caso y paso.</td></tr>
                      <tr><td><code>attachments/…</code></td><td className="small">Binarios de las evidencias declaradas.</td></tr>
                    </tbody>
                  </Table>
                </div>
                <div className="small fw-bold mb-1">{text("Campos de cada caso", "Fields for each case")}</div>
                <div className="small text-muted mb-2">
                  <code>external_id</code>, <code>external_version</code>, <code>suite_id</code>,
                  {" "}<code>titulo</code>, <code>descripcion</code>, <code>precondiciones</code>,
                  {" "}<code>postcondiciones</code>, <code>prioridad</code>, <code>criticidad</code>,
                  {" "}<code>tipo_prueba</code>, <code>estado_caso</code>, <code>etiquetas</code> y <code>pasos</code>.
                </div>
                <div className="small fw-bold mb-1">{text("Campos de cada paso", "Fields for each step")}</div>
                <div className="small text-muted mb-3">
                  <code>numero_paso</code>, <code>accion</code>, <code>datos</code> y
                  {" "}<code>resultado_esperado</code>. Un adjunto agrega
                  {" "}<code>case_external_id</code>, <code>step_number</code>,
                  {" "}<code>filename</code>, <code>content_type</code>, <code>size</code>,
                  {" "}<code>sha256</code>, <code>tipo</code> y <code>archive_path</code>.
                </div>
                <Alert variant="secondary" className="small py-2">
                  {text("Valores principales: prioridad ", "Main values: priority ")}<strong>ALTA, MEDIA, BAJA</strong>; {text("criticidad ", "severity ")}<strong>CRITICA, ALTA, MEDIA, BAJA</strong>; {text("tipo ", "type ")}<strong>MANUAL o AUTOMATIZADA</strong>; {text("estado ", "status ")}<strong>ACTIVO o ARCHIVADO</strong>.
                </Alert>
                {downloadError && <Alert variant="danger" className="small py-2">{downloadError}</Alert>}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={downloadTcasesExample}
                  disabled={downloadingTcases}
                >
                  <Download size={14} className="me-1" aria-hidden="true" />
                  {downloadingTcases ? text("Generando…", "Generating…") : text("Descargar ejemplo .tcases", "Download .tcases example")}
                </Button>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey="csv">
              <Accordion.Header>
                <span className="d-flex align-items-center gap-2">
                  <FileSpreadsheet size={17} className="text-success" />
                  <strong>{text("CSV estructurado", "Structured CSV")}</strong> · {text("migración simple", "simple migration")}
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <p className="small text-muted">
                  {text("Generá una fila por paso y repetí los datos del caso (al menos ", "Generate one row per step and repeat the case data (at least ")}<code>id</code>, <code>title</code>{text(" y ", " and ")}<code>suite</code>{text(") en cada fila. Treseko agrupa las filas del mismo ", ") in each row. Treseko groups rows with the same ")}<code>id</code>{text(" y ordena sus pasos por ", " and orders their steps by ")}<code>step_number</code>. {text("Seleccioná ", "Select ")}<strong>{text("CSV estructurado", "Structured CSV")}</strong>{text("; Treseko construirá las suites usando la columna ", "; Treseko will build suites using the ")}<code>suite</code>.
                </p>
                <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
                  <div className="small fw-bold">{text("Columnas admitidas", "Supported columns")}</div>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => {
                      onSelectProfile?.("csv/structured-v1");
                      downloadTemplate();
                    }}
                  >
                    <Download size={14} className="me-1" aria-hidden="true" />
                    {text("Descargar plantilla CSV", "Download CSV template")}
                  </Button>
                </div>
                <div className="table-responsive border rounded-3">
                  <Table size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr><th>{text("Columna", "Column")}</th><th>{text("Requerida", "Required")}</th><th>{text("Uso", "Usage")}</th></tr>
                    </thead>
                    <tbody>
                      {csvFields.map(([field, required, description]) => (
                        <tr key={field}>
                          <td><code>{field}</code></td>
                          <td>{required}</td>
                          <td className="small text-muted">{description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>

          <Alert variant="light" className="border small mt-3 mb-0">
            {text("Cambiar la extensión de un archivo no cambia su formato. Si la vista previa muestra campos ignorados, casos sin pasos o una estructura inesperada, cancelá la importación y corregí el archivo de origen.", "Changing a file extension does not change its format. If the preview shows ignored fields, cases without steps, or an unexpected structure, cancel the import and correct the source file.")}
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShow(false)}>{text("Entendido", "Got it")}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
