import { useState, type FormEvent } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { applyPasswordChangeResult } from './passwordChangeResult'
import { useI18n } from '../../i18n'

type ForcePasswordChangeModalProps = {
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onAccessTokenRefreshed: (accessToken: string) => void
  onPreferencesUpdated: (preferences: any) => void
}

export function needsForcedPasswordChange(profileSettings: any) {
  return profileSettings?.security?.force_password_change === true
}

export function ForcePasswordChangeModal({
  loggedUser,
  fetchWithAuth,
  onAccessTokenRefreshed,
  onPreferencesUpdated
}: ForcePasswordChangeModalProps) {
  const { t } = useI18n()
  const show = needsForcedPasswordChange(loggedUser?.profileSettings || {})
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canSubmit = currentPassword.trim().length > 0 && newPassword.length >= 8 && confirmPassword.length >= 8 && !saving

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setError('')
    if (newPassword !== confirmPassword) {
      setError(t('forcePasswordChange.passwordMismatch'))
      return
    }
    setSaving(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/users/me/password`, {
        method: 'PATCH',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.detail || t('forcePasswordChange.changePasswordError'))
      applyPasswordChangeResult(data, onAccessTokenRefreshed, onPreferencesUpdated)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || t('forcePasswordChange.changePasswordError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal show={show} centered backdrop="static" keyboard={false}>
      <Form onSubmit={handleSubmit}>
        <Modal.Header className="border-0 pb-0">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2 text-dark">
            <ShieldCheck size={22} className="text-primary" />
            {t('forcePasswordChange.protectAccount')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-3">
          <div className="d-flex align-items-start gap-3 mb-3">
            <div className="bg-primary bg-opacity-10 text-primary rounded-3 p-2 d-flex">
              <KeyRound size={22} />
            </div>
            <div>
              <div className="fw-bold text-dark">{t('forcePasswordChange.changeInitialPassword')}</div>
              <div className="small text-muted">
                {t('forcePasswordChange.installationDescription')}
              </div>
            </div>
          </div>
          {error && <Alert variant="danger" className="small py-2">{error}</Alert>}
          <div className="d-grid gap-3">
            <Form.Group>
              <Form.Label className="small fw-bold text-muted">{t('forcePasswordChange.currentPassword')}</Form.Label>
              <Form.Control
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small fw-bold text-muted">{t('forcePasswordChange.newPassword')}</Form.Label>
              <Form.Control
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <div className="x-small text-muted mt-1">{t('forcePasswordChange.minimumPasswordLength')}</div>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small fw-bold text-muted">{t('forcePasswordChange.confirmNewPassword')}</Form.Label>
              <Form.Control
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button type="submit" variant="primary" className="fw-bold px-4" disabled={!canSubmit}>
            {saving ? <><Spinner size="sm" className="me-2" /> {t('forcePasswordChange.saving')}</> : t('forcePasswordChange.changePassword')}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
