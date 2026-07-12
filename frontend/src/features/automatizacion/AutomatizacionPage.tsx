import { Alert } from 'react-bootstrap'
import { Code } from 'lucide-react'
import { AutomationCodesPanel } from './components/AutomationCodesPanel'
import { FuncionesManager } from './components/FuncionesManager'
import { WorkersManager } from './components/WorkersManager'
import { PremiumGate } from '../premium/PremiumGate'
import { featureEnabled, type FeatureLookup } from '../premium/featureAccess'

type AutomatizacionPageProps = {
  currentProjectId: string
  currentOrgId: string
  currentCompId: string
  currentBuildId: string
  organizations: any[]
  projectsList: any[]
  componentsList: any[]
  buildsList: any[]
  buildCaseIds: Record<string, string[]>
  currentProjectCases: any[]
  currentComponentCases: any[]
  projectsSource: 'local' | 'backend'
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
  showFeedback: (title: string, message: string, variant?: 'success' | 'danger' | 'warning' | 'info') => void
  copyToClipboard: (value: string, label?: string) => void
  confirmAction: (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>
  canAccessModule: (moduleId: any, level?: any) => boolean
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  hasSystemFeature?: FeatureLookup
}

export function AutomatizacionPage({
  currentProjectId,
  currentOrgId,
  currentCompId,
  currentBuildId,
  organizations,
  projectsList,
  componentsList,
  buildsList,
  buildCaseIds,
  currentProjectCases,
  currentComponentCases,
  projectsSource,
  fetchWithAuth,
  showFeedback,
  copyToClipboard,
  confirmAction,
  canAccessModule,
  canAccessCapability,
  hasSystemFeature,
}: AutomatizacionPageProps) {
  const canUseCapability = canAccessCapability || ((capabilityId: string, level = 'read') => canAccessModule(capabilityId.split('.')[0], level))
  const multiWorkerEnabled = featureEnabled(hasSystemFeature, 'automation.multi_worker')
  const schedulerEnabled = featureEnabled(hasSystemFeature, 'automation.scheduler')
  const canReadWorkers = canUseCapability('automatizacion.workers', 'read')
  const canEditWorkers = canUseCapability('automatizacion.workers', 'edit') && multiWorkerEnabled
  const canReadJobs = canUseCapability('automatizacion.jobs', 'read') && schedulerEnabled
  const canReadFunctions = canUseCapability('automatizacion.funciones', 'read')
  const canEditFunctions = canUseCapability('automatizacion.funciones', 'edit')
  const canReadValidation = canUseCapability('automatizacion.validacion_scripts', 'read')

  return (
    <div className="p-4 animate__animated animate__fadeIn text-dark text-start">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
          <Code size={24} /> Gestión de Automatización
        </h4>
      </div>

      {!currentProjectId ? (
        <Alert variant="warning">
          Selecciona un proyecto para gestionar workers y funciones de automatizacion.
        </Alert>
      ) : (
        <>
          {(canReadWorkers || canReadJobs) && (
            <WorkersManager
              currentProjectId={currentProjectId}
              currentCompId={currentCompId}
              currentBuildId={currentBuildId}
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
              canViewWorkers={canReadWorkers}
              canManageWorkers={canEditWorkers}
              canViewJobs={canReadJobs}
              multiWorkerEnabled={multiWorkerEnabled}
              schedulerEnabled={schedulerEnabled}
            />
          )}
          {canReadWorkers && !multiWorkerEnabled && (
            <PremiumGate
              feature="automation.multi_worker"
              hasFeature={hasSystemFeature}
              title="Workers distribuidos Premium"
              description="Community permite un worker local basico. Premium habilita vinculacion, revocacion y administracion de multiples workers."
              mode="card"
              className="mb-4"
            />
          )}
          {canUseCapability('automatizacion.jobs', 'read') && !schedulerEnabled && (
            <PremiumGate
              feature="automation.scheduler"
              hasFeature={hasSystemFeature}
              title="Scheduler y jobs Premium"
              description="Community ejecuta casos bajo demanda. Premium agrega scheduler, cola distribuida y observabilidad de jobs recientes."
              mode="card"
              className="mb-4"
            />
          )}
          {canReadFunctions && (
            <FuncionesManager
              proyectoId={currentProjectId}
              currentCompId={currentCompId}
              componentsList={componentsList}
              fetchWithAuth={fetchWithAuth}
              showFeedback={showFeedback}
              confirmAction={confirmAction}
              canEdit={canEditFunctions}
            />
          )}
          {canReadValidation && (
            <AutomationCodesPanel
              organizations={organizations}
              projectsList={projectsList}
              componentsList={componentsList}
              buildsList={buildsList}
              buildCaseIds={buildCaseIds}
              currentOrgId={currentOrgId}
              currentProjectId={currentProjectId}
              currentCompId={currentCompId}
              currentBuildId={currentBuildId}
              currentProjectCases={currentProjectCases}
              currentComponentCases={currentComponentCases}
              projectsSource={projectsSource}
              fetchWithAuth={fetchWithAuth}
              copyToClipboard={copyToClipboard}
            />
          )}
        </>
      )}
    </div>
  )
}
