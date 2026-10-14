import { Button, Form } from 'react-bootstrap'
import { INCIDENT_STATUS_KEYS, INCIDENT_STATUSES, incidentActionRequest, isOpenIncident, userLabel } from './incidentCenterHelpers'

export function IncidentActions({ incident, draft, users = [], builds = [], t, canAssign, canEdit,
  canTransition, canResolve, canClose, canDuplicate, currentUserId, canComment, actionLoading, onAction, onDuplicate }: any) {
  const { form, setForm } = draft
  const change = (key: string, value: string) => setForm((previous: any) => ({ ...previous, [key]: value }))
  const ownResolution = canResolve && String(incident.asignado_a || '') === String(currentUserId || '') && Boolean(currentUserId)
  const allowed = (status: string) => status === incident.estado || (status === 'RESUELTO' ? ownResolution
    : ['CERRADO', 'NO_REPRODUCIBLE', 'NO_CORRESPONDE'].includes(status) ? canClose : status !== 'DUPLICADO' && canTransition)
  const statuses = INCIDENT_STATUSES.filter(allowed)
  const canChangeStatus = statuses.some(status => status !== incident.estado)
  const corrected = ['RESUELTO', 'CERRADO'].includes(form.estado)
  const reopening = !isOpenIncident(incident.estado) && isOpenIncident(form.estado)
  const needsBuild = form.estado !== incident.estado && (corrected || reopening)
  const activeBuilds = builds.filter((build: any) => String(build.projectId || build.proyecto_id) === String(incident.proyecto_id)
    && build.activo !== false && (!build.estado || build.estado === 'ACTIVA'))
  const solutionChanged = form.resolucion !== (incident.resolucion || '')
  const qaChanged = form.notas_qa !== (incident.notas_qa || '')
  const saveSolution = () => {
    const fields: Record<string, string> = {}
    if (solutionChanged) fields.resolucion = form.resolucion
    if (qaChanged) fields.notas_qa = form.notas_qa
    void onAction(incident, incidentActionRequest('solution', fields))
  }
  const transition = async () => {
    const fields: any = { estado: form.estado }
    if (needsBuild) fields.resolution_build_id = form.resolution_build_id
    if (solutionChanged && (canEdit || ownResolution)) fields.resolucion = form.resolucion
    if (form.motivo_cierre.trim()) fields.motivo_cierre = form.motivo_cierre.trim()
    if (await onAction(incident, incidentActionRequest('transition', fields))) {
      setForm((previous: any) => ({ ...previous, resolution_build_id: '', motivo_cierre: '' }))
    }
  }
  const hasActions = canAssign || canChangeStatus || canEdit || canComment || canDuplicate
  return <section className="incident-quick-actions">
    <h3 className="h6 fw-bold">{t('incidencias.quickActions')}</h3>
    {!hasActions && <div role="status" className="alert alert-info">{t('incidencias.actionsReadOnly')}</div>}
    <fieldset disabled={actionLoading}>
      <div className="row g-3">
        {canChangeStatus && <div className="col-md-6">
          <Form.Label htmlFor="incident-quick-status">{t('incidencias.status')}</Form.Label>
          <Form.Select id="incident-quick-status" value={form.estado} onChange={event => setForm((previous: any) => ({ ...previous, estado: event.target.value, resolution_build_id: '' }))}>
            {statuses.map(status => <option key={status} value={status}>{t(`incidencias.${INCIDENT_STATUS_KEYS[status]}`)}</option>)}
          </Form.Select>
          {needsBuild && <div className="mt-2">
            <Form.Label htmlFor="incident-resolution-build">{t(reopening ? 'bugs.reappearanceBuild' : 'bugs.correctionBuild')}</Form.Label>
            <Form.Select id="incident-resolution-build" value={form.resolution_build_id} onChange={event => change('resolution_build_id', event.target.value)} required>
              <option value="">{t('bugs.selectBuild')}</option>
              {activeBuilds.map((build: any) => <option key={build.id} value={build.id}>{build.codigo ? `${build.codigo} · ` : ''}{build.nombre || build.name}</option>)}
            </Form.Select>
          </div>}
          {form.estado !== incident.estado && !isOpenIncident(form.estado) && !corrected && <div className="mt-2">
            <Form.Label htmlFor="incident-close-reason">{t('bugs.closureReason')}</Form.Label>
            <Form.Control id="incident-close-reason" as="textarea" rows={2} value={form.motivo_cierre} onChange={event => change('motivo_cierre', event.target.value)} maxLength={20000} />
          </div>}
          <Button className="mt-2" size="sm" variant="outline-primary" disabled={form.estado === incident.estado || (needsBuild && !form.resolution_build_id)} onClick={() => void transition()}>{t('incidencias.updateStatus')}</Button>
        </div>}
        {canAssign && <div className="col-md-6">
          <Form.Label htmlFor="incident-quick-assignee">{t('incidencias.assignee')}</Form.Label>
          <Form.Select id="incident-quick-assignee" value={form.asignado_a} onChange={event => change('asignado_a', event.target.value)}>
            <option value="">{t('incidencias.unassigned')}</option>
            {users.map((user: any) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}
          </Form.Select>
          <Button className="mt-2" size="sm" variant="outline-primary" disabled={form.asignado_a === String(incident.asignado_a || '')} onClick={() => void onAction(incident, incidentActionRequest('assign', { asignado_a: form.asignado_a || null }))}>{t('incidencias.save')}</Button>
        </div>}
        {(canEdit || ownResolution) && <div className="col-12">
          <Form.Label htmlFor="incident-quick-solution">{t('incidencias.solutionNotes')}</Form.Label>
          <Form.Control id="incident-quick-solution" as="textarea" rows={3} value={form.resolucion} onChange={event => change('resolucion', event.target.value)} placeholder={t('incidencias.solvePlaceholder')} maxLength={20000} />
          {canEdit && <>
            <Form.Label htmlFor="incident-quick-qa" className="mt-2">{t('incidencias.qaNotes')}</Form.Label>
            <Form.Control id="incident-quick-qa" as="textarea" rows={3} value={form.notas_qa} onChange={event => change('notas_qa', event.target.value)} maxLength={20000} />
            <Button className="mt-2" size="sm" disabled={!solutionChanged && !qaChanged} onClick={saveSolution}>{t('incidencias.saveSolution')}</Button>
          </>}
        </div>}
        {canComment && <div className="col-12 border-top pt-3">
          <Form.Label htmlFor="incident-comment">{t('incidencias.comment')}</Form.Label>
          <Form.Control id="incident-comment" as="textarea" rows={3} value={form.comentario} onChange={event => change('comentario', event.target.value)} placeholder={t('incidencias.commentPlaceholder')} maxLength={12000} />
          <Button className="mt-2" size="sm" variant="outline-primary" disabled={!form.comentario.trim()} onClick={async () => {
            if (await onAction(incident, incidentActionRequest('comment', { comentario: form.comentario.trim() }))) change('comentario', '')
          }}>{t('incidencias.addComment')}</Button>
        </div>}
        {canDuplicate && <div className="col-12 border-top pt-3"><Button size="sm" variant="outline-secondary" onClick={onDuplicate}>{t('bugs.markDuplicate')}</Button></div>}
      </div>
    </fieldset>
  </section>
}
