import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { ChevronDown, ChevronRight, FileText, Info, Tag, X } from "lucide-react";
import { RequiredLabel } from "../../shared/ui/RequiredLabel";
import { VariableReferenceHints } from "./VariableReferenceHints";

type Props = { context: any };

type ExpandableTextFieldProps = {
  t: (key: string, params?: Record<string, string | number>) => string;
  name: string;
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  labelActions?: ReactNode;
  variableContext?: any;
};

function ExpandableTextField({ t, name, label, value, onChange, placeholder, className = "", labelActions, variableContext }: ExpandableTextFieldProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Form.Group>
      <div className="case-metadata-field-label d-flex align-items-center justify-content-between gap-2">
        {label && <Form.Label className="fw-bold x-small text-muted mb-2">{label}</Form.Label>}
        {labelActions}
      </div>
      <Form.Control
        name={name}
        aria-label={t('common.formField')}
        as="textarea"
        rows={expanded ? 3 : 1}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        className={`case-metadata-expandable bg-light border-light-subtle shadow-none text-dark ${className}`}
      />
      {variableContext && <VariableReferenceHints value={value} {...variableContext} />}
    </Form.Group>
  );
}

export function CaseMetadataCard({ context }: Props) {
  const {
    t, collapsedSections, setCollapsedSections, editingCaseCode, canEditCases,
    newTestTitle, setNewTestTitle, newTestTags, tagDraft, setTagDraft, commitTagDraft,
    removeTag, newTestDescription, setNewTestDescription, newTestPriority,
    setNewTestPriority, newTestCriticality, setNewTestCriticality, newTestStatus,
    setNewTestStatus, newTestType, setNewTestType, newTestFormat, newTestPre, setNewTestPre,
    newTestPost, setNewTestPost, newTestData, setNewTestData, showFeedback,
    projectEnvironments, selectedDryRunEnvironment, selectedDryRunDataset,
    componentsList, newTestComponent,
  } = context;
  const variableContext = {
    environments: projectEnvironments,
    selectedEnvironment: selectedDryRunEnvironment,
    selectedDataset: selectedDryRunDataset,
    component: componentsList?.find((item: any) => String(item.id) === String(newTestComponent)),
    caseData: newTestData,
    t
  };
  useEffect(() => {
    if (newTestFormat === 'API' && newTestType === 'AI Agent') setNewTestType('Automatizada');
  }, [newTestFormat, newTestType, setNewTestType]);
  return (
    <>
    <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
      <div
        className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center cursor-pointer"
        onClick={() => setCollapsedSections(prev => ({ ...prev, metadata: !prev.metadata }))}
        style={{ cursor: 'pointer' }}
      >
        <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
            <FileText size={18} className="text-primary"/> {t('casos.caseDefinition')}
        </h6>
        {collapsedSections.metadata ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
      </div>
      {!collapsedSections.metadata && (
      <Card.Body className="p-3">
        <Row className="g-2">
          <Col md={8}>
            <Form.Group>
              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                <Form.Label className="fw-bold x-small text-muted mb-0"><RequiredLabel required>{t('casos.mainTitle')}</RequiredLabel></Form.Label>
                {editingCaseCode ? (
                  <span className="small text-muted font-monospace text-nowrap" title={t('casos.immutableCaseCode')} translate="no">
                    {t('casos.caseCodeLabel')}: {editingCaseCode}
                  </span>
                ) : (
                  <span className="small text-muted text-end">{t('casos.caseCodeAssigned')}</span>
                )}
              </div>
              <Form.Control
                name="a11y-casemetadatacardtsx-35"
                aria-label={t('casos.mainTitle')}
                type="text"
                placeholder={t('casos.caseTitlePlaceholder')}
                value={newTestTitle}
                onChange={(e) => setNewTestTitle(e.target.value)}
                required
                className="case-title-input bg-light border-light-subtle shadow-none fw-bold text-primary fs-6"
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted d-flex align-items-center gap-1">
                <Tag size={13} /> {t('casos.tags')}
              </Form.Label>
              <div className="bg-light border border-light-subtle rounded-2 p-2 d-flex flex-wrap align-items-center gap-2">
                {newTestTags.map((tag: string) => (
                  <Badge key={tag} bg="primary" className="d-inline-flex align-items-center gap-1 rounded-pill px-2 py-1">
                    {tag}
                    <button type="button" className="btn btn-link btn-sm p-0 text-white lh-1" onClick={() => removeTag(tag)} title={t('casos.removeTag', { tag })}>
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
                <Form.Control name="a11y-casemetadatacardtsx-52" aria-label={t('common.formField')}
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault()
                      commitTagDraft()
                    }
                  }}
                  onBlur={commitTagDraft}
                  placeholder={newTestTags.length ? t('casos.addAnotherTag') : t('casos.tagsPlaceholder')}
                  className="border-0 bg-transparent shadow-none p-0 flex-grow-1 small"
                  style={{ minWidth: 120 }}
                />
              </div>
            </Form.Group>
          </Col>
          <Col md={12}>
            <ExpandableTextField
              t={t}
              name="a11y-casemetadatacardtsx-72"
              label={t('casos.description')}
              value={newTestDescription}
              onChange={setNewTestDescription}
              placeholder={t('casos.descriptionPlaceholder')}
              variableContext={variableContext}
            />
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>{t('casos.priority')}</RequiredLabel></Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-78" aria-label={t('common.formField')} required value={newTestPriority} onChange={(e) => setNewTestPriority(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                <option value="ALTA">{t('casos.priorityHigh')}</option>
                <option value="MEDIA">{t('casos.priorityMedium')}</option>
                <option value="BAJA">{t('casos.priorityLow')}</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.criticality')}</Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-88" aria-label={t('common.formField')} value={newTestCriticality} onChange={(e) => setNewTestCriticality(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                <option value="CRITICA">{t('casos.critical')}</option>
                <option value="ALTA">{t('casos.priorityHigh')}</option>
                <option value="MEDIA">{t('casos.priorityMedium')}</option>
                <option value="BAJA">{t('casos.priorityLow')}</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted">{t('casos.status')}</Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-99" aria-label={t('common.formField')} value={newTestStatus} onChange={(e) => setNewTestStatus(e.target.value)} className="bg-light border-light-subtle shadow-none text-dark fw-bold">
                <option value="ACTIVO">{t('casos.statusActive')}</option>
                <option value="EN_REVISION">{t('casos.statusInReview')}</option>
                <option value="DEPRECADO">{t('casos.statusDeprecated')}</option>
                {newTestStatus === 'ARCHIVADO' && <option value="ARCHIVADO">{t('casos.statusArchived')}</option>}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label className="fw-bold x-small text-muted"><RequiredLabel required>{t('casos.mode')}</RequiredLabel></Form.Label>
              <Form.Select name="a11y-casemetadatacardtsx-110" aria-label={t('common.formField')} required value={newTestType} onChange={(e) => setNewTestType(e.target.value)} className="bg-primary bg-opacity-10 border-primary text-primary fw-bold shadow-none">
                {newTestFormat !== 'API' && <option value="AI Agent">{t('casos.modeAi')}</option>}
                <option value="Automatizada">{t('casos.automated')}</option>
                <option value="Manual">{t('casos.modeManual')}</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <ExpandableTextField
              t={t}
              name="a11y-casemetadatacardtsx-120"
              label={t('casos.preconditions')}
              value={newTestPre}
              onChange={setNewTestPre}
              placeholder={t('casos.preconditionsPlaceholder')}
              variableContext={variableContext}
            />
          </Col>
          <Col md={4}>
            <ExpandableTextField
              t={t}
              name="a11y-casemetadatacardtsx-126"
              label={t('casos.postconditions')}
              value={newTestPost}
              onChange={setNewTestPost}
              placeholder={t('casos.postconditionsPlaceholder')}
              variableContext={variableContext}
            />
          </Col>
          <Col md={4}>
            <ExpandableTextField
              t={t}
              name="a11y-casemetadatacardtsx-144"
              label={newTestFormat === 'CONVERSACIONAL' ? t('casos.scenarioVariablesOptional') : t('casos.specificData')}
              value={newTestData}
              onChange={setNewTestData}
              placeholder={newTestFormat === 'CONVERSACIONAL' ? t('casos.scenarioVariablesPlaceholder') : t('casos.specificDataPlaceholder')}
              className="font-monospace x-small"
              variableContext={variableContext}
              labelActions={(
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="p-0 text-primary shadow-none"
                  title={t('casos.datasetFormats')}
                  aria-label={t('casos.datasetFormats')}
                  onClick={() => showFeedback(t('casos.specificData'), t('casos.specificDataHelp'), 'info')}
                >
                  <Info size={14} aria-hidden="true" />
                </Button>
              )}
            />
          </Col>
        </Row>
      </Card.Body>
      )}
    </Card>
    </>
  );
}
