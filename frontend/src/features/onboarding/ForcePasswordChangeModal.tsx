import { useState, type FormEvent } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { API_BASE } from '../../app/constants'

type ForcePasswordChangeModalProps = {
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onPreferencesUpdated: (preferences: any) => void
}

export function needsForcedPasswordChange(profileSettings: any) {
  return profileSettings?.security?.force_password_change === true
}

export function ForcePasswordChangeModal({ loggedUser, fetchWithAuth, onPreferencesUpdated }: ForcePasswordChangeModalProps) {
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
      setError('La confirmacion no coincide con la nueva contraseña.')
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
      if (!response.ok) throw new Error(data?.detail || 'No se pudo cambiar la contraseña.')
      onPreferencesUpdated(data)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || 'No se pudo cambiar la contraseña.')
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
            Protege tu cuenta
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-3">
          <div className="d-flex align-items-start gap-3 mb-3">
            <div className="bg-primary bg-opacity-10 text-primary rounded-3 p-2 d-flex">
              <KeyRound size={22} />
            </div>
            <div>
              <div className="fw-bold text-dark">Cambia la contraseña inicial</div>
              <div className="small text-muted">
                Esta cuenta fue creada durante la instalacion. Antes de continuar, define una contraseña propia.
              </div>
            </div>
          </div>
          {error && <Alert variant="danger" className="small py-2">{error}</Alert>}
          <div className="d-grid gap-3">
            <Form.Group>
              <Form.Label className="small fw-bold text-muted">Contraseña actual</Form.Label>
              <Form.Control
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small fw-bold text-muted">Nueva contraseña</Form.Label>
              <Form.Control
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <div className="x-small text-muted mt-1">Usa al menos 8 caracteres.</div>
            </Form.Group>
            <Form.Group>
              <Form.Label className="small fw-bold text-muted">Confirmar nueva contraseña</Form.Label>
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
            {saving ? <><Spinner size="sm" className="me-2" /> Guardando</> : 'Cambiar contraseña'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
