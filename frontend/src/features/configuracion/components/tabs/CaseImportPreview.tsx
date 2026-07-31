import type { Dispatch, SetStateAction } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { ChevronRight, FileCheck2, Folder } from "lucide-react";

type Props = {
  t: (key: string, values?: Record<string, unknown>) => string;
  preview: any;
  importGroups: any[];
  selectedImportIds: string[];
  setSelectedImportIds: Dispatch<SetStateAction<string[]>>;
  expandedImportSuites: string[];
  setExpandedImportSuites: Dispatch<SetStateAction<string[]>>;
  expandedImportCases: string[];
  setExpandedImportCases: Dispatch<SetStateAction<string[]>>;
};

export function CaseImportPreview({
  t, preview, importGroups, selectedImportIds, setSelectedImportIds,
  expandedImportSuites, setExpandedImportSuites, expandedImportCases,
  setExpandedImportCases,
}: Props) {
  return (
<div className="border rounded-3 overflow-hidden">
<div className="d-flex align-items-center justify-content-between gap-3 bg-light border-bottom px-3 py-2">
  <div>
    <div className="small fw-bold">{t("configuracion.importStructure")}</div>
    <div className="x-small text-muted">
      {t("configuracion.selectedCases", { selected: selectedImportIds.length, total: preview.summary.total })}
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
      {t("configuracion.selectAll")}
    </Button>
    <Button
      size="sm"
      variant="link"
      onClick={() => setSelectedImportIds([])}
    >
      {t("configuracion.clear")}
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
aria-label={t("configuracion.selectSuiteAria", { path })}
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
                      aria-label={t("configuracion.selectCaseAria", { title: item.titulo || id })}
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
                      aria-label={t(caseExpanded ? "configuracion.collapseCaseAria" : "configuracion.viewCaseDetailAria", { title: item.titulo || id })}
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
                        {item.titulo || t("configuracion.untitledCase")}
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
                        ? t("configuracion.new")
                        : outcome === "new_version"
                          ? t("configuracion.newVersion")
                          : t("configuracion.noChanges")}
                    </Badge>
                  </div>
                  {caseExpanded && (
                    <section
                      className="bg-light-subtle px-3 pb-3 pt-2 ps-md-5"
                      aria-label={t("configuracion.caseDetailAria", { title: item.titulo || id })}
                    >
                      <div className="border rounded-3 bg-white p-3 mb-3">
                        <dl className="row g-3 small mb-0">
                          <div className="col-12">
                            <dt className="x-small text-uppercase text-muted mb-1">
                              {t("configuracion.description")}
                            </dt>
                            <dd className="mb-0 text-break">
                              {item.descripcion || t("configuracion.noDescription")}
                            </dd>
                          </div>
                          <div className="col-12 col-md-6">
                            <dt className="x-small text-uppercase text-muted mb-1">
                              {t("configuracion.preconditions")}
                            </dt>
                            <dd className="mb-0 text-break">
                              {item.precondiciones || t("configuracion.noPreconditions")}
                            </dd>
                          </div>
                          <div className="col-12 col-md-6">
                            <dt className="x-small text-uppercase text-muted mb-1">
                              {t("configuracion.postconditions")}
                            </dt>
                            <dd className="mb-0 text-break">
                              {item.postcondiciones || t("configuracion.noPostconditions")}
                            </dd>
                          </div>
                        </dl>
                        <hr className="my-3" />
                        <dl className="row g-2 small mb-0">
                          {[
                            [t("configuracion.externalId"), item.external_id],
                            [t("configuracion.version"), item.external_version],
                            [t("configuracion.priority"), item.prioridad],
                            [t("configuracion.criticality"), item.criticidad],
                            [t("configuracion.type"), item.tipo_prueba],
                            [t("configuracion.caseStatus"), item.estado_caso],
                            [
                              t("configuracion.tags"),
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
                                  label === t("configuracion.externalId")
                                    ? "no"
                                    : undefined
                                }
                              >
                                {value || t("configuracion.notReported")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      <h4 className="small fw-semibold mb-2">
                        {t("configuracion.caseSteps")}
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
                                    {t("configuracion.step", { number: step.numero_paso || stepIndex + 1 })}
                                  </Badge>
                                </div>
                                <dl className="row g-2 mb-0">
                                  <dt className="col-12 col-sm-4 text-muted">
                                    {t("configuracion.actionField")}
                                  </dt>
                                  <dd className="col-12 col-sm-8 mb-1 text-break">
                                    {step.accion || t("configuracion.noAction")}
                                  </dd>
                                  <dt className="col-12 col-sm-4 text-muted">
                                    {t("configuracion.dataField")}
                                  </dt>
                                  <dd className="col-12 col-sm-8 mb-1 text-break">
                                    {step.datos || t("configuracion.noSpecificData")}
                                  </dd>
                                  <dt className="col-12 col-sm-4 text-muted">
                                    {t("configuracion.expectedResult")}
                                  </dt>
                                  <dd className="col-12 col-sm-8 mb-0 text-break">
                                    {step.resultado_esperado || t("configuracion.noExpectedResult")}
                                  </dd>
                                </dl>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <Alert variant="warning" className="small py-2 mb-0">
                          {t("configuracion.noCaseSteps")}
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
  );
}
