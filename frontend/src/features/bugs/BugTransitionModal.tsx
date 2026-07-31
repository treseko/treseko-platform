import { Bug } from 'lucide-react'
import { Button, Form, Modal } from 'react-bootstrap'
import { useI18n } from '../../i18n'

type Props = {
  target: { bug: any; estado: string } | null
  form: { resolution_build_id: string; resolucion: string; motivo_cierre: string }
  builds: any[]
  busy: boolean
  isCorrected: (status: string) => boolean
  onChange: (form: Props['form']) => void
  onClose: () => void
  onConfirm: () => void
}

export function BugTransitionModal({ target, form, builds, busy, isCorrected, onChange, onClose, onConfirm }: Props) {
  const { t } = useI18n()
  const corrected = Boolean(target && isCorrected(target.estado))
  const reopening = target?.estado === 'REABIERTO'
  return (
    <Modal show={Boolean(target)} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Bug size={18} className="text-primary" />
          {t('bugs.changeTo', { status: target?.estado || '' })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="small text-muted mb-3">{target?.bug?.codigo} · {target?.bug?.titulo}</div>
        {target && (
          <Form.Group className="mb-3">
            <Form.Label>{corrected ? t('bugs.correctionBuild') : reopening ? t('bugs.reappearanceBuild') : t('bugs.optionalBuild')}</Form.Label>
            <Form.Select value={form.resolution_build_id} onChange={(event) => onChange({ ...form, resolution_build_id: event.target.value })}>
              <option value="">{t('bugs.selectBuild')}</option>
              {builds.map((build: any) => <option key={build.id} value={build.id}>{build.codigo ? `${build.codigo} · ` : ''}{build.nombre || build.name}</option>)}
            </Form.Select>
            <Form.Text>{t('bugs.buildHelpText')}</Form.Text>
          </Form.Group>
        )}
        <Form.Group className="mb-3">
          <Form.Label>{corrected ? t('bugs.resolution') : reopening ? t('bugs.reopeningContext') : t('bugs.closureReason')}</Form.Label>
          <Form.Control as="textarea" rows={3} value={corrected || reopening ? form.resolucion : form.motivo_cierre}
            onChange={(event) => onChange(corrected || reopening ? { ...form, resolucion: event.target.value } : { ...form, motivo_cierre: event.target.value })} />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="outline-secondary" onClick={onClose}>{t('bugs.cancel')}</Button>
        <Button onClick={onConfirm} disabled={busy}>{t('bugs.confirmChange')}</Button>
      </Modal.Footer>
    </Modal>
  )
}
