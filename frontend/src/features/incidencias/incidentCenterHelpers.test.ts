import test from 'node:test'
import assert from 'node:assert/strict'
import { incidentFilterParams, incidentBuildLabel, incidentCaseLabel, incidentOrganizationLabel, filteredIncidents, normalizeIncidentPayload, normalizeIncidentDetail, incidentActionRequest, incidentAttachmentLinkRequest, incidentErrorMessage } from './incidentCenterHelpers'

test('normaliza la respuesta del centro y conserva paginacion', () => {
  assert.deepEqual(normalizeIncidentPayload({ items: [{ id: '1' }], total: 4, skip: 2, limit: 2 }).items, [{ id: '1' }])
  assert.equal(normalizeIncidentPayload({ total: 4, skip: 2, limit: 2 }).total, 4)
})

test('construye filtros combinables sin enviar valores vacios', () => {
  const params = incidentFilterParams({ proyecto_id: 'p1', estado: '', q: 'login' }, 50)
  assert.equal(params.get('proyecto_id'), 'p1')
  assert.equal(params.get('estado'), null)
  assert.equal(params.get('q'), 'login')
  assert.equal(params.get('limit'), '50')
})

test('serializa el filtro de tipo de bug para el Centro de Incidencias', () => {
  const params = incidentFilterParams({ tipo_contexto: 'API', proyecto_id: '', skip: '0' })
  assert.equal(params.get('tipo_contexto'), 'API')
  assert.equal(params.get('skip'), '0')
})

test('serializa fechas de calendario al formato datetime que acepta el endpoint', () => {
  const params = incidentFilterParams({ desde: '2026-09-01', hasta: '2026-09-03' })
  assert.equal(params.get('desde'), '2026-09-01T00:00:00')
  assert.equal(params.get('hasta'), '2026-09-03T23:59:59')
})

test('prioriza nombres humanos y permite vista de mis incidencias', () => {
  const bug = { case_title: 'Login invalido', case_code: 'TC-01', build_name: 'QA 1.7', build_code: 'BLD-1' }
  assert.equal(incidentCaseLabel(bug), 'Login invalido')
  assert.equal(incidentBuildLabel(bug), 'QA 1.7')
  assert.equal(filteredIncidents([{ asignado_a: 'u1' }, { asignado_a: 'u2' }], true, 'u1').length, 1)
})

test('no expone UUID como nombre de solución', () => {
  assert.equal(incidentOrganizationLabel({ id: 'org-uuid-1', nombre: 'Commerce QA' }), 'Commerce QA')
  assert.equal(incidentOrganizationLabel({ id: 'org-uuid-1' }), 'Solución sin nombre')
})

test('construye las acciones operativas con los contratos existentes', () => {
  assert.deepEqual(incidentActionRequest('assign', { asignado_a: 'u1' }), { method: 'PATCH', path: '', body: { asignado_a: 'u1' } })
  assert.deepEqual(incidentActionRequest('assign', { asignado_a: null }), { method: 'PATCH', path: '', body: { asignado_a: null } })
  assert.equal(incidentActionRequest('transition', { estado: 'EN_PROGRESO' }).path, '/transition/')
  assert.equal(incidentActionRequest('solution', { resolucion: 'ok' }).method, 'PATCH')
  assert.equal(incidentActionRequest('comment', { comentario: 'avance' }).path, '/comments/')
})

test('normaliza el detalle y aplana la metadata de adjuntos', () => {
  const detail = normalizeIncidentDetail({ comments: [{ id: 'c1' }], history: [{ id: 'h1' }], attachments: [{ id: 'l1', attachment: { id: 'a1' } }] })
  assert.equal(detail.comments.length, 1)
  assert.equal(detail.history.length, 1)
  assert.deepEqual(detail.attachments, [{ id: 'a1', attachment_id: 'a1' }])
})

test('conserva la referencia del adjunto aunque falte su metadata', () => {
  const detail = normalizeIncidentDetail({ attachments: [{ id: 'link-1', attachment_id: 'attachment-1' }] })
  assert.equal(detail.attachments[0].id, 'link-1')
  assert.equal(detail.attachments[0].attachment_id, 'attachment-1')
})

test('limita y limpia detalles de error del backend', async () => {
  const response = new Response(JSON.stringify({ detail: `bad\u0000${'x'.repeat(400)}` }), { status: 409 })
  const message = await incidentErrorMessage(response, 'No se pudo')
  assert.equal(message.length < 280, true)
  assert.equal(message.includes('\u0000'), false)
})

test('usa el contrato existente para vincular evidencia al bug', () => {
  assert.deepEqual(incidentAttachmentLinkRequest('a1'), { method: 'POST', path: '/attachments/', body: { attachment_id: 'a1', tipo: 'BUG_EVIDENCE' } })
})
