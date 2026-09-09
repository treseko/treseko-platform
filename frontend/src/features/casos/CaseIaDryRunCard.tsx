import { Button, Card, Form } from "react-bootstrap";
import { Cpu, PlayCircle, RefreshCw } from "lucide-react";

type Props = { context: any };

export function CaseIaDryRunCard({ context }: Props) {
  const {
    t, newTestType, canUseIaDryRun, aiDryRunRunning, newTestTitle, newTestSteps,
    projectEnvironments, selectedDryRunEnvironment, setDryRunEnvironmentId,
    setDryRunDatasetId, dryRunDatasets, selectedDryRunDataset, currentProjectId,
    newTestComponent, newTestDescription, newTestPre, newTestPost, newTestData,
    onRunAiDryRunFromEditor, uuidOrNull,
  } = context;
  return (
    <>{newTestType === 'AI Agent' && canUseIaDryRun && (
      <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3">
        <Card.Body className="p-3 d-flex justify-content-between align-items-center">
          <div>
            <div className="fw-bold text-dark d-flex align-items-center gap-2">
              <Cpu size={18} className="text-primary" aria-hidden="true" /> {t('casos.aiDryRunTitle')}
            </div>
            <div className="small text-muted">{t('casos.aiDryRunDescription')}</div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end">
            <span className="x-small text-muted fw-bold">{t('casos.aiContext')}</span>
            <Form.Select size="sm" value={selectedDryRunEnvironment?.id || ''} onChange={event => { setDryRunEnvironmentId(event.target.value); setDryRunDatasetId('') }} aria-label={t('casos.aiEnvironmentLabel')} title={t('casos.aiEnvironmentHelp')} className="w-auto">
              <option value="">{t('casos.noEnvironment')}</option>
              {projectEnvironments.map((environment: any) => <option key={environment.id} value={environment.id}>{environment.name || environment.nombre}</option>)}
            </Form.Select>
            <Form.Select size="sm" value={selectedDryRunDataset?.id || ''} onChange={event => setDryRunDatasetId(event.target.value)} aria-label={t('casos.aiDatasetLabel')} title={t('casos.aiDatasetHelp')} className="w-auto" disabled={!selectedDryRunEnvironment || !dryRunDatasets.length}>
              <option value="">{t('casos.noDataset')}</option>
              {dryRunDatasets.map((dataset: any) => <option key={dataset.id} value={dataset.id}>{dataset.nombre || dataset.name}</option>)}
            </Form.Select>
            <Button
            variant="outline-primary"
            size="sm"
            className="fw-bold shadow-none"
            disabled={aiDryRunRunning || !newTestTitle.trim() || newTestSteps.length === 0}
            onClick={() => onRunAiDryRunFromEditor?.({
              proyecto_id: uuidOrNull(currentProjectId) || currentProjectId,
              componente_id: uuidOrNull(newTestComponent),
              titulo: newTestTitle || 'Prueba temporal con IA',
              codigo: 'AI-DRY-RUN',
              descripcion: newTestDescription || '',
              precondiciones: newTestPre || '',
              postcondiciones: newTestPost || '',
              datos_caso: newTestData || '',
              entorno_id: uuidOrNull(selectedDryRunEnvironment?.id),
              dataset_id: uuidOrNull(selectedDryRunDataset?.id),
              debug_mode: false,
              pasos: newTestSteps.map((step: any, index: number) => ({
                numero_paso: index + 1,
                accion: step.action || '',
                datos: step.data || '',
                resultado_esperado: step.expected || ''
              }))
            })}
          >
            {aiDryRunRunning ? <RefreshCw size={14} className="me-1 animate-pulse" /> : <PlayCircle size={14} className="me-1" />}
            {aiDryRunRunning ? t('casos.aiDryRunStarting') : t('casos.aiDryRunAction')}
            </Button>
          </div>
        </Card.Body>
      </Card>
    )}</>
  );
}
