import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const api = process.env.TEST_API_BASE_URL || 'http://127.0.0.1:8000'
const token = process.env.TEST_ACCESS_TOKEN || ''
const headers = { Authorization: `Bearer ${token}` }
const marker = `QA revisión Bug Tracker ${Date.now()}`
const createdIds: string[] = []
let project: any
let build: any
let bug: any
let original: any

test.describe.serial('Bug Tracker corrections on the local instance', () => {
  test.beforeAll(async ({ request }) => {
    test.skip(!token, 'An existing local QA account is required')
    const projects = await request.get(`${api}/proyectos/`, { headers })
    expect(projects.status()).toBe(200)
    project = (await projects.json()).find((item: any) => item.nombre === 'Operations Mobile/API')
    expect(project).toBeTruthy()
    const builds = await request.get(`${api}/proyectos/${project.id}/builds/`, { headers })
    build = (await builds.json()).find((item: any) => item.activo && item.estado === 'ACTIVA')
    expect(build).toBeTruthy()
    for (const name of ['Reporte', 'Principal']) {
      const response = await request.post(`${api}/bugs/`, { headers, data: {
        proyecto_id: project.id, build_id: build.id, componente_id: build.componente_id,
        titulo: `${marker} ${name}`, pasos_reproduccion: 'Abrir pago y confirmar el importe.',
        descripcion: 'Validación temporal de la gestión de defectos.', resultado_esperado: 'Pago confirmado.',
        resultado_obtenido: 'El pago no se confirma.', severidad: 'MEDIA', prioridad: 'P2',
        metadata_json: { qa_validation: marker },
      } })
      expect(response.status()).toBe(200)
      const payload = await response.json()
      createdIds.push(payload.id)
      if (name === 'Reporte') bug = payload
      else original = payload
    }
  })
  test.afterAll(async () => {
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/bug-tracker-created.json', JSON.stringify({ marker, project_id: project?.id, ids: createdIds }))
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(value => {
      localStorage.setItem('qa_access_token', value)
      localStorage.setItem('qa_session_active', 'true')
      localStorage.setItem('treseko.ui.locale', 'es')
    }, token)
  })
  const path = () => `/?tab=bugs&org_id=${project.organizacion_id}&project_id=${project.id}&comp_id=${build.componente_id}&build_id=${build.id}`

  test('filters and summarizes the exact result, paginates, sorts, and fits mobile', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(path())
    await expect(page.getByLabel('Buscar codigo, titulo, error...')).toBeVisible()
    await page.getByLabel('Buscar codigo, titulo, error...').fill(marker)
    await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
    await expect(page.getByText('Mostrando 1–2 de 2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abiertos 2', exact: true })).toBeVisible()
    const response = await request.get(`${api}/proyectos/${project.id}/bugs/?q=${encodeURIComponent(marker)}&include_summary=true&limit=1&sort=oldest`, { headers })
    expect(response.status()).toBe(200)
    const payload = await response.json()
    expect(payload.total).toBe(2)
    expect(payload.items).toHaveLength(1)
    expect(payload.summary.total).toBe(2)
    await page.getByLabel('Ordenar por').selectOption('priority')
    await page.screenshot({ path: 'test-results/bug-tracker-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByText('Mostrando 1–2 de 2')).toBeVisible()
    const tableOverflow = await page.locator('.bug-tracker-table-wrap').evaluate(node => node.scrollWidth > node.clientWidth + 1)
    await page.screenshot({ path: 'test-results/bug-tracker-mobile.png', fullPage: true })
    expect(tableOverflow).toBe(false)
    expect(errors).toEqual([])
  })

  test('retains editing while commenting, confirms discarding, and saves only the draft', async ({ page, request }) => {
    await page.goto(`${path()}&bug_id=${bug.id}`)
    await expect(page.getByRole('button', { name: 'Editar bug' })).toBeVisible()
    await page.getByRole('button', { name: 'Editar bug' }).click()
    await page.locator('#bug-detail-title').fill(`${marker} corregido`)
    await page.getByLabel('Agregar comentario').fill('La reproducción está confirmada en QA.')
    await page.getByRole('button', { name: 'Comentar', exact: true }).click()
    await expect(page.getByText('La reproducción está confirmada en QA.', { exact: true })).toBeVisible()
    await expect(page.locator('#bug-detail-title')).toHaveValue(`${marker} corregido`)
    await page.locator('#bug-detail-status').selectOption('EN_PROGRESO')
    await expect(page.locator('#bug-detail-status')).toHaveValue('EN_PROGRESO')
    await expect(page.locator('#bug-detail-title')).toHaveValue(`${marker} corregido`)
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(page.getByText('Cambios sin guardar', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    await page.getByRole('button', { name: 'Guardar cambios del bug' }).click()
    await expect(page.locator('#bug-detail-title')).toHaveCount(0)
    const persisted = await request.get(`${api}/bugs/${bug.id}/`, { headers })
    const saved = await persisted.json()
    expect(saved.titulo).toBe(`${marker} corregido`)
    expect(saved.estado).toBe('EN_PROGRESO')
    await page.getByRole('tab', { name: 'Historial' }).click()
    await expect(page.locator('.bug-history')).toBeVisible()
    const header = await page.locator('.bug-detail-modal .modal-header').boundingBox()
    const title = await page.locator('.bug-detail-modal .modal-title').boundingBox()
    expect(title!.y).toBeGreaterThanOrEqual(header!.y)
    expect(title!.y + title!.height).toBeLessThanOrEqual(header!.y + header!.height)
    await page.screenshot({ path: 'test-results/bug-tracker-history.png', fullPage: true })
  })

  test('selects an original for duplication and persists the relationship', async ({ page, request }) => {
    await page.goto(`${path()}&bug_id=${bug.id}`)
    await expect(page.getByRole('button', { name: 'Editar bug' })).toBeVisible()
    const duplicateButton = page.getByRole('button', { name: 'Marcar como duplicado' })
    if (await duplicateButton.count() === 0) {
      const denied = await request.post(`${api}/bugs/${bug.id}/mark-duplicate/`, { headers, data: { duplicate_of_id: original.id } })
      expect(denied.status()).toBe(403)
      return // Community must hide the action and enforce the same gate in the API.
    }
    await duplicateButton.click()
    await page.getByLabel('Buscar bug principal por código o título').fill(original.codigo)
    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect(page.locator('#bug-duplicate-original option').filter({ hasText: original.codigo })).toHaveCount(1)
    await page.getByLabel('Bug principal', { exact: true }).selectOption(original.id)
    await page.getByRole('button', { name: 'Confirmar duplicado' }).click()
    await expect(page.getByRole('button', { name: 'Ver bug principal' })).toBeVisible()
    const persisted = await request.get(`${api}/bugs/${bug.id}/`, { headers })
    const payload = await persisted.json()
    expect(payload.estado).toBe('DUPLICADO')
    expect(payload.duplicate_of_id).toBe(original.id)
  })
})
