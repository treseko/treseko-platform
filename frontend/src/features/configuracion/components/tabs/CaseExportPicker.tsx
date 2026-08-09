import type { Dispatch, SetStateAction } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { Download } from "lucide-react";

type Props = {
  show: boolean;
  onHide: () => void;
  t: (key: string) => string;
  busy: boolean;
  components: any[];
  exportComponentId: string;
  setExportComponentId: (value: string) => void;
  suites: any[];
  cases: any[];
  selectedSuiteIds: string[];
  setSelectedSuiteIds: Dispatch<SetStateAction<string[]>>;
  selectedCaseIds: string[];
  setSelectedCaseIds: Dispatch<SetStateAction<string[]>>;
  expandedSuites: string[];
  setExpandedSuites: Dispatch<SetStateAction<string[]>>;
  exportCases: () => void;
};

export function CaseExportPicker({
  show, onHide, t, busy, components, exportComponentId, setExportComponentId,
  suites, cases, selectedSuiteIds, setSelectedSuiteIds, selectedCaseIds,
  setSelectedCaseIds, expandedSuites, setExpandedSuites, exportCases,
}: Props) {
  return (
<Modal
  show={show}
  onHide={onHide}
  size="lg"
  centered
>
  <Modal.Header closeButton className="border-0 pb-2">
    <Modal.Title className="fw-bold d-flex align-items-center gap-2">
      <Download size={18} className="text-primary" />
      {t("configuracion.casesToExport")}
    </Modal.Title>
  </Modal.Header>
  <Modal.Body className="pt-0">
    <div className="mb-3">
      <Form.Label className="small fw-bold">{t("configuracion.component")}</Form.Label>
      <Form.Select name="a11y-caseexportpickertsx-45" aria-label="Campo de formulario"
        value={exportComponentId}
        onChange={(event) => setExportComponentId(event.target.value)}
        disabled={busy || components.length === 0}
      >
        <option value="">{t("configuracion.selectComponent")}</option>
        {components.map((component) => (
          <option key={component.id} value={component.id}>
            {component.nombre}
          </option>
        ))}
      </Form.Select>
      {!components.length && (
        <div className="small text-muted mt-1">
          {t("configuracion.noComponentsAvailable")}
        </div>
      )}
    </div>
    <div className="d-flex justify-content-between align-items-center mb-2">
      <span className="small text-muted">{t("configuracion.selectSuitesCases")}</span>
      <div className="d-flex gap-2">
        <Button
          size="sm"
          variant="outline-primary"
          onClick={() => {
            setSelectedSuiteIds(suites.map((s) => s.id));
            setSelectedCaseIds(cases.map((item) => String(item.id)));
          }}
        >
          {t("configuracion.selectAll")}
        </Button>
        <Button
          size="sm"
          variant="link"
          onClick={() => {
            setSelectedSuiteIds([]);
            setSelectedCaseIds([]);
          }}
        >
          {t("configuracion.clear")}
        </Button>
      </div>
    </div>
    <div
      className="border rounded-2 p-2"
      style={{ maxHeight: 420, overflowY: "auto" }}
    >
      {!exportComponentId && (
        <div className="small text-muted p-2">
          {t("configuracion.selectComponentToView")}
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
              <Form.Check name="a11y-caseexportpickertsx-109" aria-label="Campo de formulario"
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
                {suiteCases.length} {t("configuracion.caseCount")}
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
                    <Form.Check name="a11y-caseexportpickertsx-156" aria-label="Campo de formulario"
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
              onClick={onHide}
    >
      {t("configuracion.cancel")}
    </Button>
    <Button
      variant="primary"
      onClick={exportCases}
      disabled={busy || !exportComponentId}
    >
      {t("configuracion.exportSelection")}
    </Button>
  </Modal.Footer>
</Modal>

  );
}
