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

const profileGuidance: Record<string, string> = {
  "treseko/tcases-v1":
    "Usá un paquete .tcases exportado por Treseko. Conserva el árbol, las versiones, los pasos y los adjuntos incluidos en el paquete.",
  "csv/structured-v1":
    "Usá una fila por paso y repetí el ID para agruparlos en un caso. Es la opción indicada para una herramienta propia o no incluida en la lista.",
  "testlink/xml-v1":
    "En TestLink, exportá las suites como XML. Seleccioná este perfil sin editar manualmente el XML generado.",
  "testrail/xml-v1":
    "Exportá las secciones y casos desde TestRail en XML. Treseko reconstruirá las secciones como suites.",
  "testrail/csv-v1":
    "Exportá desde TestRail en CSV incluyendo ID, Title, Section y las columnas de pasos y resultados esperados.",
  "xray/csv-v1":
    "Usá el CSV del Test Case Importer de Xray, conservando Issue Id, Issue Type, Test Summary, Action y Result.",
  "xray/json-v1":
    "El JSON debe usar el contrato de resultados Xray y contener testInfo dentro de cada prueba. Un reporte que sólo tenga estados de ejecución no define casos importables.",
  "zephyr/json-v1":
    "Usá una respuesta de casos de Zephyr Scale Cloud API v2 con el arreglo values y sus testScript.",
  "zephyr/xml-v1":
    "En Zephyr Scale, generá un Project XML export. Este perfil no corresponde a XML de Zephyr Squad o Enterprise.",
  "azure-test-plans/csv-v1":
    "Exportá los Test Cases de Azure Test Plans en CSV e incluí ID, Work Item Type, Title, Test Step, Step Action y Step Expected.",
  "qase/csv-v1":
    "Exportá los casos desde Qase en CSV con suites y pasos. No elimines las filas que describen la jerarquía de suites.",
  "qase/json-v1":
    "Usá una exportación JSON de Qase o una respuesta API v1 de casos. La vista previa indicará qué envoltorio reconoció.",
  "qtest/excel-v1":
    "Exportá desde qTest en XLS o XLSX incluyendo Test Case ID, Test Case Name, Module Path y las columnas de pasos.",
  "practitest/csv-v1":
    "Exportá los tests desde PractiTest en CSV incluyendo Test ID, Test Name, Folder, Step Description y Expected Result.",
  "gherkin/feature-v1":
    "Seleccioná un archivo .feature válido. Cada Scenario o fila de Examples se convertirá en un caso de prueba.",
};

const csvFields = [
  ["id", "Sí", "Identificador estable y único del caso, por ejemplo TC-LOGIN-001."],
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
  const [show, setShow] = useState(false);
  const [downloadingTcases, setDownloadingTcases] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const profileName = profile?.display_name || profile?.tool || "Formato externo";

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
        throw new Error(body.detail || "No se pudo generar el ejemplo .tcases.");
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
      setDownloadError(error.message || "No se pudo descargar el ejemplo.");
    } finally {
      setDownloadingTcases(false);
    }
  };

  return (
    <>
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>Cómo preparar un archivo compatible</Tooltip>}
      >
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={() => setShow(true)}
          aria-label="Abrir guía de importación de casos"
        >
          <HelpCircle size={15} className="me-1" aria-hidden="true" />
          Guía de importación
        </Button>
      </OverlayTrigger>

      <Modal show={show} onHide={() => setShow(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="h5">Preparar casos para importar</Modal.Title>
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
              <div className="fw-bold">Importá sin modificar el archivo original</div>
              <div className="small text-muted">
                Elegí la herramienta que produjo el archivo, revisá la vista previa y confirmá únicamente los casos que necesitás.
              </div>
            </div>
          </div>

          <div className="row g-2 mb-4">
            {[
              ["1", "Exportar", "Generá el archivo desde la herramienta de origen."],
              ["2", "Revisar", "Elegí el perfil correcto y ejecutá Vista previa."],
              ["3", "Confirmar", "Controlá el árbol, los avisos y los casos seleccionados."],
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
              <div>{profileGuidance[profile.id] || "Usá el archivo exportado por la herramienta y verificá su contenido en la vista previa."}</div>
              <div className="mt-1">
                Extensiones admitidas: <strong>{profile.extensions.join(", ")}</strong>.
              </div>
            </Alert>
          )}

          <h6 className="fw-bold mt-4">Adaptar otra herramienta a Treseko</h6>
          <p className="small text-muted">
            Elegí el nivel de migración según la información que necesites
            conservar. El paquete <code>.tcases</code> es el formato completo;
            el CSV es una alternativa más sencilla para casos sin adjuntos.
          </p>

          <Accordion className="mb-3">
            <Accordion.Item eventKey="tcases">
              <Accordion.Header>
                <span className="d-flex align-items-center gap-2">
                  <Archive size={17} className="text-primary" />
                  <strong>.tcases</strong> · migración completa
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <p className="small text-muted">
                  Es un ZIP versionado. Conserva suites anidadas, casos, pasos,
                  versiones y archivos adjuntos. Cada JSON declarado debe tener
                  su SHA-256 en <code>manifest.json</code>.
                </p>
                <div className="table-responsive border rounded-3 mb-3">
                  <Table size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr><th>Entrada</th><th>Contenido</th></tr>
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
                <div className="small fw-bold mb-1">Campos de cada caso</div>
                <div className="small text-muted mb-2">
                  <code>external_id</code>, <code>external_version</code>, <code>suite_id</code>,
                  {" "}<code>titulo</code>, <code>descripcion</code>, <code>precondiciones</code>,
                  {" "}<code>postcondiciones</code>, <code>prioridad</code>, <code>criticidad</code>,
                  {" "}<code>tipo_prueba</code>, <code>estado_caso</code>, <code>etiquetas</code> y <code>pasos</code>.
                </div>
                <div className="small fw-bold mb-1">Campos de cada paso</div>
                <div className="small text-muted mb-3">
                  <code>numero_paso</code>, <code>accion</code>, <code>datos</code> y
                  {" "}<code>resultado_esperado</code>. Un adjunto agrega
                  {" "}<code>case_external_id</code>, <code>step_number</code>,
                  {" "}<code>filename</code>, <code>content_type</code>, <code>size</code>,
                  {" "}<code>sha256</code>, <code>tipo</code> y <code>archive_path</code>.
                </div>
                <Alert variant="secondary" className="small py-2">
                  Valores principales: prioridad <strong>ALTA, MEDIA, BAJA</strong>;
                  criticidad <strong>CRITICA, ALTA, MEDIA, BAJA</strong>; tipo
                  {" "}<strong>MANUAL o AUTOMATIZADA</strong>; estado
                  {" "}<strong>ACTIVO o ARCHIVADO</strong>.
                </Alert>
                {downloadError && <Alert variant="danger" className="small py-2">{downloadError}</Alert>}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={downloadTcasesExample}
                  disabled={downloadingTcases}
                >
                  <Download size={14} className="me-1" aria-hidden="true" />
                  {downloadingTcases ? "Generando…" : "Descargar ejemplo .tcases"}
                </Button>
              </Accordion.Body>
            </Accordion.Item>

            <Accordion.Item eventKey="csv">
              <Accordion.Header>
                <span className="d-flex align-items-center gap-2">
                  <FileSpreadsheet size={17} className="text-success" />
                  <strong>CSV estructurado</strong> · migración simple
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <p className="small text-muted">
                  Generá una fila por paso y repetí los datos del caso (al menos
                  <code>id</code>, <code>title</code> y <code>suite</code>) en cada
                  fila. Treseko agrupa las filas del mismo <code>id</code> y ordena
                  sus pasos por <code>step_number</code>. Seleccioná <strong>CSV estructurado</strong>;
                  Treseko construirá las suites usando la columna <code>suite</code>.
                </p>
                <div className="d-flex justify-content-between align-items-center gap-3 mb-2">
                  <div className="small fw-bold">Columnas admitidas</div>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => {
                      onSelectProfile?.("csv/structured-v1");
                      downloadTemplate();
                    }}
                  >
                    <Download size={14} className="me-1" aria-hidden="true" />
                    Descargar plantilla CSV
                  </Button>
                </div>
                <div className="table-responsive border rounded-3">
                  <Table size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr><th>Columna</th><th>Requerida</th><th>Uso</th></tr>
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
            Cambiar la extensión de un archivo no cambia su formato. Si la vista
            previa muestra campos ignorados, casos sin pasos o una estructura
            inesperada, cancelá la importación y corregí el archivo de origen.
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShow(false)}>Entendido</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
