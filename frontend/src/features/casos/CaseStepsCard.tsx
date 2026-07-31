import { Button, Card, Form } from "react-bootstrap";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, LayoutList, Plus, Trash2 } from "lucide-react";
import { EvidenceUpload } from "../../EvidenceUpload";

type Props = { context: any };

export function CaseStepsCard({ context }: Props) {
  const {
    t, collapsedSections, setCollapsedSections, canEditSteps, addStepInput, newTestSteps,
    handleStepInputChange, attachmentConfig, updateStepAttachments, moveStepInput,
    duplicateStepInput, removeStepInput, canEditAttachments,
  } = context;
  return (
    <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3 overflow-hidden">
      <div
        className="bg-light border-bottom py-2 px-3 d-flex justify-content-between align-items-center"
        onClick={() => setCollapsedSections(prev => ({ ...prev, steps: !prev.steps }))}
        style={{ cursor: 'pointer' }}
      >
        <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
            <LayoutList size={18} className="text-primary"/> {t('casos.stepSequence')}
        </h6>
        <div className="d-flex align-items-center gap-2">
          {!collapsedSections.steps && canEditSteps && (
            <Button variant="outline-primary" size="sm" onClick={(e) => { e.stopPropagation(); addStepInput() }} className="fw-bold rounded-pill px-3 shadow-none bg-white">
                <Plus size={14} className="me-1" /> {t('casos.addStep')}
            </Button>
          )}
          {collapsedSections.steps ? <ChevronRight size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
        </div>
      </div>
      {!collapsedSections.steps && (
      <Card.Body className="p-4 bg-light">
        {/* Header de Columnas */}
        <div className="case-step-grid-header mb-2 px-2 text-muted fw-bold text-uppercase">
          <div>#</div>
          <div>{t('casos.chooseAction')} <span className="text-danger">*</span></div>
          <div>Datos (Input Data)</div>
          <div>Resultado Esperado <span className="text-danger">*</span></div>
          <div></div>
        </div>

        {newTestSteps.length === 0 && (
          <div className="text-center py-4 text-muted bg-white rounded-3 border border-light-subtle">
            <LayoutList size={22} className="mb-2 opacity-50" />
            <div className="small fw-bold">{t('casos.noStepsYet')}</div>
            <div className="x-small">{t('casos.saveAndCompleteLater')}</div>
          </div>
        )}

        {newTestSteps.map((step, idx) => (
          <div key={idx} className="case-step-grid mb-3 animate__animated animate__fadeIn bg-white p-2 rounded-3 border border-light-subtle shadow-sm">
            <div className="case-step-number-cell">
              <span className="case-step-index">#{idx + 1}</span>
            </div>
            <div className="d-flex flex-column">
              <Form.Control required as="textarea" rows={2} placeholder={t('casos.actionPlaceholder')} value={step.action} onChange={(e) => handleStepInputChange(idx, 'action', e.target.value)} className="border-light-subtle shadow-none small text-dark mb-2 flex-grow-1" style={{ resize: 'none' }} disabled={!canEditSteps} />
              <EvidenceUpload
                compact
                iconOnly
                label={t('casos.actionImage')}
                uploadScope="CASE_STEP_REFERENCE"
                maxFileSize={attachmentConfig.max_file_size_mb}
                enablePaste={attachmentConfig.enable_clipboard_paste}
                currentAttachments={step.actionAttachments || []}
                currentEvidence={step.actionImg}
                onUploadComplete={(attachment) => updateStepAttachments(idx, 'actionAttachments', [...(step.actionAttachments || []), attachment])}
                onRemoveAttachment={(attachment) => updateStepAttachments(idx, 'actionAttachments', (step.actionAttachments || []).filter(item => item.id !== attachment.id))}
                disabled={!canEditAttachments}
              />
            </div>
            <div className="d-flex flex-column">
              <Form.Control as="textarea" rows={2} placeholder="Variables a inyectar" value={step.data} onChange={(e) => handleStepInputChange(idx, 'data', e.target.value)} className="border-light-subtle shadow-none font-monospace small text-primary mb-2 flex-grow-1" style={{ resize: 'none' }} disabled={!canEditSteps} />
            </div>
            <div className="d-flex flex-column">
              <Form.Control required as="textarea" rows={2} placeholder={t('casos.validationCriteriaPlaceholder')} value={step.expected} onChange={(e) => handleStepInputChange(idx, 'expected', e.target.value)} className="border-light-subtle shadow-none small text-dark mb-2 flex-grow-1" style={{ resize: 'none' }} disabled={!canEditSteps} />
              <EvidenceUpload
                compact
                iconOnly
                label="Imagen esperada"
                uploadScope="CASE_STEP_REFERENCE"
                maxFileSize={attachmentConfig.max_file_size_mb}
                enablePaste={attachmentConfig.enable_clipboard_paste}
                currentAttachments={step.expectedAttachments || []}
                currentEvidence={step.expectedImg}
                onUploadComplete={(attachment) => updateStepAttachments(idx, 'expectedAttachments', [...(step.expectedAttachments || []), attachment])}
                onRemoveAttachment={(attachment) => updateStepAttachments(idx, 'expectedAttachments', (step.expectedAttachments || []).filter(item => item.id !== attachment.id))}
                disabled={!canEditAttachments}
              />
            </div>
            <div className="case-step-actions-cell">
              {canEditSteps && (
                <>
                <Button variant="light" className="case-step-action-btn text-secondary border shadow-none hover-text-primary transition-all" onClick={() => moveStepInput(idx, 'up')} disabled={idx === 0} title={t('casos.moveStepUp')} aria-label={t('casos.moveStepUp')}>
                  <ArrowUp size={15} />
                </Button>
                <Button variant="light" className="case-step-action-btn text-secondary border shadow-none hover-text-primary transition-all" onClick={() => moveStepInput(idx, 'down')} disabled={idx === newTestSteps.length - 1} title={t('casos.moveStepDown')} aria-label={t('casos.moveStepDown')}>
                  <ArrowDown size={15} />
                </Button>
                <Button variant="light" className="case-step-action-btn text-secondary border shadow-none hover-text-primary transition-all" onClick={() => duplicateStepInput(idx)} title={t('casos.copyStep')} aria-label={t('casos.copyStep')}>
                  <Copy size={15} />
                </Button>
                <Button variant="light" className="case-step-action-btn text-danger border shadow-none hover-bg-danger hover-text-white transition-all" onClick={() => removeStepInput(idx)} title={t('casos.deleteStep')} aria-label={t('casos.deleteStep')}>
                  <Trash2 size={16} />
                </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </Card.Body>
      )}
    </Card>
  );
}
