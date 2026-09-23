import { test, expect } from '@playwright/test'

const baseURL = process.env.TRESEKO_BASE_URL ?? 'http://127.0.0.1:5173'
const apiBase = process.env.TRESEKO_API_BASE_URL ?? baseURL
const token = process.env.TRESEKO_EPHEMERAL_TOKEN
const projectId = process.env.TRESEKO_QA_PROJECT_ID
const buildId = process.env.TRESEKO_QA_BUILD_ID
const caseId = process.env.TRESEKO_QA_CASE_ID

test.describe('manual execution and evidence coverage', () => {
  test.skip(!token || !projectId || !buildId || !caseId, 'Requires ephemeral token and existing QA project/build/case context')

  test('selects an existing classic case and starts a manual run', async ({ page }) => {
    await page.goto(`${baseURL}/ejecutar-pruebas`)
    await expect(page.getByText(/ejecutar pruebas|execute tests/i).first()).toBeVisible()
    const caseRow = page.getByText(new RegExp(caseId!, 'i')).first()
    await expect(caseRow).toBeVisible()
    await caseRow.click()
    await page.getByRole('button', { name: /manual|iniciar/i }).click()
    await expect(page.getByText(/acción|action/i).first()).toBeVisible()
  })

  test('rejects unauthenticated access and invalid run state', async ({ request }) => {
    const unauthorized = await request.get(`${apiBase}/test-runs/00000000-0000-0000-0000-000000000000/ejecuciones/`)
    expect(unauthorized.status()).toBe(401)
    const invalid = await request.post(`${apiBase}/test-runs/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { nombre: 'QA invalid state', entorno: 'QA', proyecto_id: projectId, caso_ids: [caseId] },
    })
    expect(invalid.status()).toBe(400)
    expect((await invalid.text()).toLowerCase()).toContain('build')
  })

  test('persists terminal status and snapshot observation through current routes', async ({ request }) => {
    const run = await request.post(`${apiBase}/test-runs/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { nombre: 'QA Playwright manual run', entorno: 'QA', proyecto_id: projectId, build_id: buildId, caso_ids: [caseId], origen: 'MANUAL' },
    })
    expect(run.ok()).toBeTruthy()
    const runBody = await run.json()
    const executions = await request.get(`${apiBase}/test-runs/${runBody.id}/ejecuciones/`, { headers: { Authorization: `Bearer ${token}` } })
    expect(executions.ok()).toBeTruthy()
    const execution = (await executions.json())[0]
    const snapshots = await request.get(`${apiBase}/ejecuciones/${execution.id}/snapshots/`, { headers: { Authorization: `Bearer ${token}` } })
    expect(snapshots.ok()).toBeTruthy()
    const first = (await snapshots.json())[0]
    const savedSnapshots = await request.patch(`${apiBase}/ejecuciones/${execution.id}/snapshots/`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { snapshots: [{ id: first.id, estado: 'PASO', comentarios: 'Playwright evidence persisted', evidencia_url: null }] },
    })
    expect(savedSnapshots.ok()).toBeTruthy()
    const terminal = await request.patch(`${apiBase}/ejecuciones/${execution.id}/`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { estado: 'PASO', comentarios: 'Playwright terminal status persisted' },
    })
    expect(terminal.ok()).toBeTruthy()
    expect((await terminal.json()).estado_resultado).toBe('PASO')
  })
})
