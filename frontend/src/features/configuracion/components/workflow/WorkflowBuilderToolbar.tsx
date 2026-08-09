import { Badge, Button, Dropdown, Form } from 'react-bootstrap'
import { Archive, Blocks, CheckCircle2, Copy, Download, MoreHorizontal, Network, PlayCircle, RotateCcw, Save, Upload } from 'lucide-react'
import { useI18n } from '../../../../i18n'
import type { AiWorkflow } from '../../types/configuracion'
import { canExportPortableWorkflow } from './workflowBuilderUtils'

type Props = {
  workflowDraft: AiWorkflow | null
  workflowLoading: boolean
  canEditAi: boolean
  onOpenIaScheduler?: () => void
  autoLayoutEnabled: boolean
  workflowStatusColor: (status?: string) => string
  saveWorkflowDraft: () => void
  validateWorkflow: () => void
  publishWorkflowVersion: () => void
  executeCurrentWorkflow: () => void
  switchToAutoLayoutMode: () => void
  switchToManualMode: () => void
  reorderWorkflow: () => void
  postWorkflowAction: (action: 'duplicate' | 'archive' | 'restore-default') => void
  copyWorkflowAsBlocks: () => void
  copyWorkflowAsUniversal: () => void
  exportUniversalWorkflow: () => void
  importUniversalWorkflow: (file?: File) => void
  closeWorkflowBuilder: () => void
}

export function WorkflowBuilderToolbar({
  workflowDraft,
  workflowLoading,
  canEditAi,
  onOpenIaScheduler,
  autoLayoutEnabled,
  workflowStatusColor,
  saveWorkflowDraft,
  validateWorkflow,
  publishWorkflowVersion,
  executeCurrentWorkflow,
  switchToAutoLayoutMode,
  switchToManualMode,
  reorderWorkflow,
  postWorkflowAction,
  copyWorkflowAsBlocks,
  copyWorkflowAsUniversal,
  exportUniversalWorkflow,
  importUniversalWorkflow,
  closeWorkflowBuilder,
}: Props) {
  const { t } = useI18n()

  return (
    <div className="workflow-engine-toolbar">
      <div>
        <h6 className="fw-bold mb-1">{t('configuracion.workflowToolbarTitle')}</h6>
        <div className="workflow-toolbar-meta">
          <span>{workflowDraft?.name || t('configuracion.workflowToolbarNoWorkflow')}</span>
          <span>v{workflowDraft?.version || 1}</span>
          <Badge bg={workflowDraft?.workflow_format === 'universal_v2' ? 'success' : workflowDraft?.workflow_format === 'block_v2' ? 'primary' : 'secondary'}>{workflowDraft?.workflow_format === 'universal_v2' ? t('configuracion.workflowToolbarUniversalFormat') : workflowDraft?.workflow_format === 'block_v2' ? t('configuracion.workflowToolbarBlocksFormat') : t('configuracion.workflowToolbarClassicFormat')}</Badge>
          <Badge bg={workflowStatusColor(workflowDraft?.status)}>{workflowDraft?.status || t('configuracion.workflowToolbarDraftStatus')}</Badge>
        </div>
      </div>
      <div className="workflow-main-actions">
        {workflowDraft?.workflow_format === 'block_v2' && workflowDraft.source_workflow_id && (
          <span className="small text-warning-emphasis fw-semibold">{t('configuracion.workflowToolbarBlockCopyWarning')}</span>
        )}
        {canEditAi && (
          <Button size="sm" variant="light" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={saveWorkflowDraft}>
            <Save size={15} /> {t('configuracion.workflowToolbarSaveDraft')}
          </Button>
        )}
        {canEditAi && (
          <Button size="sm" variant="outline-success" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={validateWorkflow}>
            <CheckCircle2 size={15} /> {t('configuracion.workflowToolbarValidate')}
          </Button>
        )}
        {canEditAi && (
          <Button size="sm" variant="primary" className="workflow-action-btn" type="button" disabled={!workflowDraft || workflowLoading} onClick={publishWorkflowVersion}>
            <Upload size={15} /> {t('configuracion.workflowToolbarPublish')}
          </Button>
        )}
        {canEditAi && (
          <Button
            size="sm"
            variant="outline-primary"
            className="workflow-action-btn"
            type="button"
            disabled={!onOpenIaScheduler || workflowLoading}
            onClick={executeCurrentWorkflow}
            title={t('configuracion.workflowToolbarExecuteTitle')}
          >
            <PlayCircle size={15} /> {t('configuracion.workflowToolbarExecute')}
          </Button>
        )}
        {canEditAi && (
          <div className="workflow-mode-toggle" role="group" aria-label={t('configuracion.workflowToolbarLayoutMode')}>
            <Button
              size="sm"
              variant={autoLayoutEnabled ? 'primary' : 'light'}
              className="workflow-action-btn"
              type="button"
              onClick={switchToAutoLayoutMode}
            >
              {t('configuracion.workflowToolbarAutoLayout')}
            </Button>
            <Button
              size="sm"
              variant={!autoLayoutEnabled ? 'primary' : 'light'}
              className="workflow-action-btn"
              type="button"
              onClick={switchToManualMode}
            >
              {t('configuracion.workflowToolbarManualMode')}
            </Button>
          </div>
        )}
        <Badge bg={autoLayoutEnabled ? 'primary' : 'secondary'} className="workflow-mode-badge">
          {autoLayoutEnabled ? t('configuracion.workflowToolbarAutoLayoutActive') : t('configuracion.workflowToolbarManualMode')}
        </Badge>
        {canEditAi && (
          <Button size="sm" variant="light" className="workflow-action-btn" type="button" disabled={!workflowDraft} onClick={reorderWorkflow}>
            <Network size={14} /> {t('configuracion.workflowToolbarReorder')}
          </Button>
        )}
        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="light" className="workflow-more-btn" aria-label={t('configuracion.workflowToolbarMoreActions')}>
            <MoreHorizontal size={18} />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('duplicate')} disabled={!workflowDraft}><Copy size={14} className="me-2" />{t('configuracion.workflowToolbarDuplicate')}</Dropdown.Item>}
            {canEditAi && workflowDraft?.workflow_format !== 'block_v2' && <Dropdown.Item onClick={copyWorkflowAsBlocks} disabled={!workflowDraft}><Blocks size={14} className="me-2" />{t('configuracion.workflowToolbarCreateBlockCopy')}</Dropdown.Item>}
            {canEditAi && workflowDraft?.workflow_format !== 'universal_v2' && <Dropdown.Item onClick={copyWorkflowAsUniversal} disabled={!workflowDraft}><Blocks size={14} className="me-2" />{t('configuracion.workflowToolbarCreateUniversalCopy')}</Dropdown.Item>}
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('archive')} disabled={!workflowDraft?.id || workflowDraft?.is_default}><Archive size={14} className="me-2" />{t('configuracion.workflowToolbarArchive')}</Dropdown.Item>}
            {canEditAi && <Dropdown.Item onClick={() => postWorkflowAction('restore-default')} disabled={!workflowDraft}><RotateCcw size={14} className="me-2" />{t('configuracion.workflowToolbarRestoreDefault')}</Dropdown.Item>}
            {canEditAi && <Dropdown.Divider />}
            <Dropdown.Item onClick={exportUniversalWorkflow} disabled={!canExportPortableWorkflow(workflowDraft)}>
              <Download size={14} className="me-2" />{t('configuracion.workflowToolbarExportPortable')}
            </Dropdown.Item>
            {canEditAi && <Dropdown.Item as="label" className="mb-0">
              <Upload size={14} className="me-2" />{t('configuracion.workflowToolbarImportPortable')}
              <Form.Control
                id="workflow-portable-file"
                name="workflowPortableFile"
                aria-label={t('configuracion.workflowToolbarImportPortable')}
                type="file"
                accept="application/zip,.zip,.treseko-workflow.zip"
                className="d-none"
                onChange={(event) => {
                  const input = event.currentTarget as HTMLInputElement
                  importUniversalWorkflow(input.files?.[0])
                  input.value = ''
                }}
              />
            </Dropdown.Item>}
          </Dropdown.Menu>
        </Dropdown>
        <button type="button" className="workflow-builder-close" aria-label={t('configuracion.workflowToolbarClose')} onClick={closeWorkflowBuilder}>×</button>
      </div>
    </div>
  )
}
