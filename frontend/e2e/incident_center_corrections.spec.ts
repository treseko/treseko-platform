import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const api = process.env.TEST_API_BASE_URL || 'http://127.0.0.1:8000'
const token = process.env.TEST_ACCESS_TOKEN || ''
const headers = { Authorization: `Bearer ${token}` }
const marker = `QA Centro de Incidencias ${Date.now()}`
const ids: string[] = []
let project: any
let build: any
let bug: any

test.describe.serial('Incident Center corrections on the local instance', () => {
  test.beforeAll(async ({ request }) => {
    test.skip(!token, 'An existing local QA account is required')
    expect((await request.get(`${api}/health`)).status()).toBe(200)
    const projects = await request.get(`${api}/proyectos/`, { headers })
    expect(projects.status()).toBe(200)
    project = (await projects.json()).find((item: any) => item.nombre === 'Operations Mobile/API')
    expect(project).toBeTruthy()
    const builds = await request.get(`${api}/proyectos/${project.id}/builds/`, { headers })
    build = (await builds.json()).find((item: any) => item.activo && item.estado === 'ACTIVA')
    expect(build).toBeTruthy()
    const user = await request.get(`${api}/users/me/`, { headers })
    expect(user.status()).toBe(200)
    const response = await request.post(`${api}/bugs/`, { headers, data: {
      proyecto_id: project.id, build_id: build.id, componente_id: build.componente_id,
      titulo: marker, descripcion: 'La confirmación del pago falla al finalizar la compra.',
      pasos_reproduccion: 'Abrir el pago y confirmar el importe.', resultado_esperado: 'Pago confirmado.',
      resultado_obtenido: 'No se confirma.', resolucion_pantalla: '1920x1080',
      asignado_a: (await user.json()).id, severidad: 'ALTA', prioridad: 'P1',
      metadata_json: { qa_validation: marker },
    } })
    expect(response.status()).toBe(200)
    bug = await response.json(); ids.push(bug.id)
  })
  test.afterAll(() => {
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/incident-center-created.json', JSON.stringify({ marker, project_id: project?.id, ids }))
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(value => {
      localStorage.setItem('qa_access_token', value); localStorage.setItem('qa_session_active', 'true')
      localStorage.setItem('treseko.ui.locale', 'es')
    }, token)
  })
  const path = () => `/?tab=incidencias&org_id=${project.organizacion_id}&project_id=${project.id}&comp_id=${build.componente_id}&build_id=${build.id}`
  test('filters, prioritizes and adapts to mobile', async ({ page, request }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(path())
    await page.getByRole('textbox', { name: 'Buscar por código, título o error…' }).fill(marker)
    await expect(page.locator('.incident-row')).toHaveCount(1)
    await page.getByRole('button', { name: 'Críticos y altos' }).click()
    await page.getByRole('combobox', { name: 'Ordenar por' }).selectOption('priority')
    await expect(page.locator('.incident-row')).toHaveCount(1)
    const result = await request.get(`${api}/incidencias/centro/?q=${encodeURIComponent(marker)}&attention=critical&sort=priority`, { headers })
    expect(result.status()).toBe(200)
    const payload = await result.json(); expect(payload.total).toBe(1); expect(payload.summary.criticos).toBe(1)
    await page.screenshot({ path: 'test-results/incident-center-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: 'Más filtros' })).toBeVisible()
    expect(await page.locator('.incident-center-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: 'test-results/incident-center-mobile.png', fullPage: true })
    expect(errors).toEqual([])
  })
  test('preserves drafts and persists solution, comments and resolution', async ({ page, request }) => {
    await page.goto(`${path()}&bug_id=${bug.id}`)
    const detail = page.getByRole('dialog')
    await expect(detail.getByText('La confirmación del pago falla al finalizar la compra.')).toBeVisible()
    await detail.getByRole('tab', { name: 'Reproducción' }).click()
    await expect(detail.getByText('1920x1080')).toBeVisible()
    await detail.getByRole('tab', { name: 'Acciones', exact: true }).click()
    await detail.getByLabel('Solución registrada').fill('Se corrigió la validación del importe.')
    await detail.getByLabel('Notas para QA').fill('Repetir el pago con el mismo importe.')
    await detail.getByRole('tab', { name: 'Diagnóstico' }).click()
    await detail.getByRole('tab', { name: 'Acciones', exact: true }).click()
    await expect(detail.getByLabel('Solución registrada')).toHaveValue('Se corrigió la validación del importe.')
    await detail.getByLabel('Comentario', { exact: true }).fill('Validación temporal del flujo completo.')
    await detail.getByRole('button', { name: 'Agregar comentario' }).click()
    await expect(detail.getByLabel('Comentario', { exact: true })).toHaveValue('')
    await expect(detail.getByLabel('Notas para QA')).toHaveValue('Repetir el pago con el mismo importe.')
    await detail.getByRole('button', { name: 'Cerrar detalle' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(detail.getByLabel('Notas para QA')).toHaveValue('Repetir el pago con el mismo importe.')
    await detail.getByRole('button', { name: 'Guardar solución' }).click()
    await expect(detail.getByRole('button', { name: 'Guardar solución' })).toBeDisabled()
    await detail.getByLabel('Estado', { exact: true }).selectOption('RESUELTO')
    await detail.getByLabel('Build de corrección').selectOption(build.id)
    const transitionResponse = page.waitForResponse(response => response.url().endsWith(`/bugs/${bug.id}/transition/`) && response.request().method() === 'POST')
    await detail.getByRole('button', { name: 'Actualizar estado' }).click()
    expect((await transitionResponse).status()).toBe(200)
    await expect(detail.getByLabel('Estado', { exact: true })).toHaveValue('RESUELTO')
    await expect(detail.getByRole('button', { name: 'Actualizar estado' })).toBeDisabled()
    const stored = await request.get(`${api}/bugs/${bug.id}/`, { headers })
    expect(stored.status()).toBe(200)
    const data = await stored.json(); expect(data.estado).toBe('RESUELTO'); expect(data.resolved_build_id).toBe(build.id)
    expect(data.resolucion_pantalla).toBe('1920x1080'); expect(data.resolucion).toBe('Se corrigió la validación del importe.')
    expect(data.notas_qa).toBe('Repetir el pago con el mismo importe.')
    await detail.getByRole('tab', { name: 'Evidencia e historial' }).click()
    await expect(detail.getByRole('tab', { selected: true })).toHaveText('Evidencia e historial')
    await expect(detail.getByText('Validación temporal del flujo completo.')).toBeVisible()
    await expect(detail.getByText('Abierto → Resuelto')).toBeVisible()
    await page.screenshot({ path: 'test-results/incident-center-history.png', fullPage: true })
  })
  test('requires reappearance build and keeps screen context after reopening', async ({ page, request }) => {
    await page.goto(`${path()}&bug_id=${bug.id}`)
    const detail = page.getByRole('dialog')
    await detail.getByRole('tab', { name: 'Acciones', exact: true }).click()
    await detail.getByLabel('Estado', { exact: true }).selectOption('REABIERTO')
    await expect(detail.getByRole('button', { name: 'Actualizar estado' })).toBeDisabled()
    await detail.getByLabel(/Build donde reapareció/).selectOption(build.id)
    const transitionResponse = page.waitForResponse(response => response.url().endsWith(`/bugs/${bug.id}/transition/`) && response.request().method() === 'POST')
    await detail.getByRole('button', { name: 'Actualizar estado' }).click()
    expect((await transitionResponse).status()).toBe(200)
    await expect(detail.getByLabel('Estado', { exact: true })).toHaveValue('REABIERTO')
    const response = await request.get(`${api}/bugs/${bug.id}/`, { headers }); const stored = await response.json()
    expect(stored.estado).toBe('REABIERTO'); expect(stored.reopened_count).toBe(1); expect(stored.resolved_build_id).toBeNull()
    expect(stored.resolucion_pantalla).toBe('1920x1080')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(detail.getByLabel('Solución registrada')).toHaveValue('Se corrigió la validación del importe.')
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: 'test-results/incident-center-mobile-detail.png', fullPage: true })
  })
})
