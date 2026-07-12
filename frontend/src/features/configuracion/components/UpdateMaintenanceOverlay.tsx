import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { UpdateMaintenanceState } from '../updateMaintenance'

type UpdateMaintenanceOverlayProps = {
  state: UpdateMaintenanceState
  onRetry: () => void
}

export function UpdateMaintenanceOverlay({ state, onRetry }: UpdateMaintenanceOverlayProps) {
  if (!state.active && !state.timedOut) return null
  const remainingSeconds = Math.max(0, Math.ceil((state.until - Date.now()) / 1000))
  const remainingLabel = state.timedOut
    ? 'tiempo agotado'
    : remainingSeconds > 60
    ? `${Math.ceil(remainingSeconds / 60)} min`
    : `${remainingSeconds || 1} s`

  return (
    <div className="update-maintenance-overlay" role="status" aria-live="polite">
      <section className="update-maintenance-panel animate__animated animate__fadeIn">
        <div className="update-maintenance-icon">
          <AlertTriangle size={28} />
        </div>
        <div>
          <h1>Actualizacion en curso</h1>
          <p>{state.message}</p>
          <div className="update-maintenance-meta">
            {state.timedOut ? 'Tiempo de espera agotado.' : `Reintentando automaticamente. Tiempo estimado: ${remainingLabel}.`}
            {state.targetVersion && (
              <> Version destino: {state.targetVersion}.</>
            )}
            {state.lastCheckedAt && (
              <> Ultimo intento: {new Date(state.lastCheckedAt).toLocaleTimeString()}.</>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-primary fw-bold" onClick={onRetry}>
          <RefreshCw size={16} className="me-2" />
          Reintentar ahora
        </button>
      </section>
    </div>
  )
}
