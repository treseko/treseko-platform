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
    <>{newTestType !== 'Automatizada' && canUseIaDryRun && (
      <Card className="border-0 shadow-sm rounded-3 bg-white text-start mb-3">
        <Card.Body className="p-3 d-flex justify-content-between align-items-center">
          <div>
            <div className="fw-bold text-dark d-flex align-items-center gap-2">
              <Cpu size={18} className="text-primary" /> Ejecutar prueba con IA
            </div>
            <div className="small text-muted">Muestra pasos, capturas y observaciones del Motor IA en tiempo real. No guarda historial.</div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end">
            <span className="x-small text-muted fw-bold">CONTEXTO IA</span>
            <Form.Select size="sm" value={selectedDryRunEnvironment?.id || ''} onChange={event => { setDryRunEnvironmentId(event.target.value); setDryRunDatasetId('') }} aria-label="Ambiente para prueba con IA" title="Ambiente y URL que usara la IA" className="w-auto">
              <option value="">Sin ambiente</option>
              {projectEnvironments.map((environment: any) => <option key={environment.id} value={environment.id}>{environment.name || environment.nombre}</option>)}
            </Form.Select>
            <Form.Select size="sm" value={selectedDryRunDataset?.id || ''} onChange={event => setDryRunDatasetId(event.target.value)} aria-label="Dataset para prueba con IA" title="Dataset que usara la IA" className="w-auto" disabled={!selectedDryRunEnvironment || !dryRunDatasets.length}>
              <option value="">Sin dataset</option>
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
            {aiDryRunRunning ? 'Iniciando...' : 'Ejecutar con IA'}
            </Button>
          </div>
        </Card.Body>
      </Card>
    )}</>
  );
}
