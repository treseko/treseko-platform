import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { UpdateMaintenanceState } from '../updateMaintenance'
import { useI18n } from '../../../i18n'

type UpdateMaintenanceOverlayProps = {
  state: UpdateMaintenanceState
  onRetry: () => void
}

export function UpdateMaintenanceOverlay({ state, onRetry }: UpdateMaintenanceOverlayProps) {
  const { t } = useI18n()
  if (!state.active && !state.timedOut) return null
  const remainingSeconds = Math.max(0, Math.ceil((state.until - Date.now()) / 1000))
  const remainingLabel = state.timedOut
    ? t('configuracion.timeoutShort')
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
          <h1>{t('configuracion.maintenanceTitle')}</h1>
          <p>{state.message}</p>
          <div className="update-maintenance-meta">
            {state.timedOut ? t('configuracion.timeoutExpired') : t('configuracion.retrying', { time: remainingLabel })}
            {state.targetVersion && (
              <> {t('configuracion.targetVersion', { version: state.targetVersion })}</>
            )}
            {state.lastCheckedAt && (
              <> {t('configuracion.lastAttempt', { time: new Date(state.lastCheckedAt).toLocaleTimeString() })}</>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-primary fw-bold" onClick={onRetry}>
          <RefreshCw size={16} className="me-2" />
          {t('configuracion.retryNow')}
        </button>
      </section>
    </div>
  )
}
