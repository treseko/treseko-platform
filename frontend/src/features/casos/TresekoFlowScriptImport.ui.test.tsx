// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TresekoFlowScriptImport } from './TresekoFlowScriptImport'

const recordedScript = "import { test, expect } from '@playwright/test';\ntest('recorrido', async ({ page }) => { await page.goto('/'); });"
const legacyFlowScript = 'const baseUrl = variables.base_url || variables.BASE_URL || "https://the-internet.herokuapp.com";\nawait page.goto(new URL("/", baseUrl).toString());'

function makeTranslator() {
  const labels: Record<string, string> = {
    'casos.recorderNewCase': 'Caso nuevo',
    'casos.recordWithPlaywright': 'Grabar con la extensión Treseko Flow',
    'casos.recorderOpenExtensionHint': 'Para grabar, instala la extensión Treseko Flow en Chrome o Edge. Graba el recorrido desde la extensión y pulsa “Enviar a Treseko” para cargar el script aquí. Esta pantalla no graba directamente.',
    'casos.recorderImportShort': 'Importar .spec.js',
    'casos.recorderImportExtension': 'Importar script de Treseko Flow',
    'casos.recorderImportFileError': 'Selecciona un archivo JavaScript válido.',
    'casos.recorderImportFileSuccess': 'Se importó {file}.',
    'casos.recorderFlowReplaceTitle': 'Reemplazar el script actual',
    'casos.recorderFlowReplaceMessage': 'El script actual será reemplazado.',
    'casos.recorderFlowReplaceConfirm': 'Cargar en el editor',
    'casos.cancel': 'Cancelar',
    'casos.recorderFlowReceived': 'Se recibió {file}.',
  }
  return (key: string, values?: Record<string, string>) =>
    (labels[key] || key).replace(/\{([^}]+)\}/g, (_match, name: string) => values?.[name] || '')
}

function renderRecorder({ code = '', title = '', script = '', confirmAction = vi.fn().mockResolvedValue(true) } = {}) {
  const setFramework = vi.fn()
  const setLanguage = vi.fn()
  const setScript = vi.fn()
  const context = {
    t: makeTranslator(),
    setNewTestFramework: setFramework,
    setNewTestLanguage: setLanguage,
    setNewTestScript: setScript,
    newTestScript: script,
    newTestTitle: title,
    editingCaseCode: code,
    confirmAction,
  }
  const view = render(<TresekoFlowScriptImport context={context} />)
  return { ...view, setFramework, setLanguage, setScript, confirmAction }
}

afterEach(() => {
  cleanup()
  delete (window as any).__TRESEKO_FLOW_CASE__
  delete (window as any).__TRESEKO_FLOW_READY__
  delete (window as any).__TRESEKO_FLOW_RECEIVE__
})

describe('Playwright recorder identity and import', () => {
  it('shows an explicit label when a new case has no code or title', () => {
    renderRecorder()

    expect(screen.getByText('Caso nuevo')).toBeTruthy()
    expect((window as any).__TRESEKO_FLOW_CASE__).toEqual({ code: '', title: '' })
  })

  it('shows a title without inventing a case code', () => {
    renderRecorder({ title: 'Validar inicio de sesión' })

    expect(screen.getByText('Validar inicio de sesión')).toBeTruthy()
    expect((window as any).__TRESEKO_FLOW_CASE__).toEqual({ code: '', title: 'Validar inicio de sesión' })
  })

  it('keeps the real title in the extension identity when no reference code exists', () => {
    renderRecorder({ title: 'Validar inicio de sesión' })

    expect((window as any).__TRESEKO_FLOW_CASE__).toEqual({ code: '', title: 'Validar inicio de sesión' })
  })

  it('shows an existing code once when the title already contains it', () => {
    renderRecorder({ code: 'PUB-001', title: 'PUB-001 · Advanced Shadow DOM' })

    expect(screen.getByText('PUB-001 · Advanced Shadow DOM')).toBeTruthy()
    expect(screen.queryByText('PUB-001 · PUB-001 · Advanced Shadow DOM')).toBeNull()
    expect((window as any).__TRESEKO_FLOW_CASE__).toEqual({ code: 'PUB-001', title: 'Advanced Shadow DOM' })
  })

  it('shows only the code when an existing case has no title', () => {
    renderRecorder({ code: 'PUB-014' })

    expect(screen.getByText('PUB-014')).toBeTruthy()
    expect((window as any).__TRESEKO_FLOW_CASE__).toEqual({ code: 'PUB-014', title: '' })
  })

  it('explains where to start recording and keeps script import available', () => {
    renderRecorder()

    fireEvent.click(screen.getByRole('button', { name: 'Grabar con la extensión Treseko Flow' }))
    expect(screen.getByRole('status').textContent).toContain('instala la extensión Treseko Flow')
    expect(screen.getByRole('status').textContent).toContain('Enviar a Treseko')
    expect(screen.getByLabelText('Importar script de Treseko Flow')).toBeTruthy()
  })

  it('receives a valid extension script and selects Playwright JavaScript', async () => {
    const { setFramework, setLanguage, setScript } = renderRecorder({ code: 'PUB-001', title: 'Login' })
    const dispatched = vi.fn()
    window.addEventListener('treseko-flow-import-script', dispatched, { once: true })

    expect((window as any).__TRESEKO_FLOW_RECEIVE__({ script: recordedScript, nonce: 'nonce-1', name: 'login.spec.js' })).toBe(true)
    expect(dispatched).toHaveBeenCalledOnce()
    expect(dispatched.mock.calls[0][0].detail).toEqual({ script: recordedScript, nonce: 'nonce-1', name: 'login.spec.js' })

    await waitFor(() => expect(setScript).toHaveBeenCalledWith(recordedScript))
    expect(setFramework).toHaveBeenCalledWith('playwright')
    expect(setLanguage).toHaveBeenCalledWith('javascript')
    expect(screen.getByRole('status').textContent).toContain('login.spec.js')
  })

  it('pins the recorded origin when importing a legacy Flow script', async () => {
    const { setScript } = renderRecorder()

    ;(window as any).__TRESEKO_FLOW_RECEIVE__({ script: legacyFlowScript, nonce: 'legacy-flow', name: 'recorded.spec.js' })

    await waitFor(() => expect(setScript).toHaveBeenCalledWith('const baseUrl = "https://the-internet.herokuapp.com";\nawait page.goto(new URL("/", baseUrl).toString());'))
  })

  it('pins the recorded origin when importing a legacy Flow file', async () => {
    const { setScript } = renderRecorder()
    const input = screen.getByLabelText('Importar script de Treseko Flow')
    const file = new File([legacyFlowScript], 'recorded.spec.js', { type: 'text/javascript' })
    Object.defineProperty(file, 'text', { value: async () => legacyFlowScript })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(setScript).toHaveBeenCalledWith('const baseUrl = "https://the-internet.herokuapp.com";\nawait page.goto(new URL("/", baseUrl).toString());'))
  })

  it('does not import extension payloads without a fresh nonce', () => {
    const { setScript } = renderRecorder()

    ;(window as any).__TRESEKO_FLOW_RECEIVE__({ script: recordedScript, name: 'missing-nonce.spec.js' })

    expect(setScript).not.toHaveBeenCalled()
  })

  it('asks before replacing an existing script and honors cancellation', async () => {
    const confirmAction = vi.fn().mockResolvedValue(false)
    const { setScript } = renderRecorder({ script: 'existing script', confirmAction })

    ;(window as any).__TRESEKO_FLOW_RECEIVE__({ script: recordedScript, nonce: 'replace-cancel', name: 'new.spec.js' })

    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce())
    expect(setScript).not.toHaveBeenCalled()
  })

  it('replaces an existing script after confirmation', async () => {
    const confirmAction = vi.fn().mockResolvedValue(true)
    const { setFramework, setLanguage, setScript } = renderRecorder({ script: 'existing script', confirmAction })

    ;(window as any).__TRESEKO_FLOW_RECEIVE__({ script: recordedScript, nonce: 'replace-confirm', name: 'new.spec.js' })

    await waitFor(() => expect(setScript).toHaveBeenCalledWith(recordedScript))
    expect(confirmAction).toHaveBeenCalledOnce()
    expect(setFramework).toHaveBeenCalledWith('playwright')
    expect(setLanguage).toHaveBeenCalledWith('javascript')
  })

  it('rejects invalid file types and files above the size limit', async () => {
    const { setScript } = renderRecorder()
    const input = screen.getByLabelText('Importar script de Treseko Flow')

    fireEvent.change(input, { target: { files: [new File(['not a script'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByText('Selecciona un archivo JavaScript válido.')).toBeTruthy()

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(200_001)], 'large.spec.js')] } })
    expect(await screen.findByText('Selecciona un archivo JavaScript válido.')).toBeTruthy()
    expect(setScript).not.toHaveBeenCalled()
  })
})
