import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaseEditorActions } from './caseEditorActions'
import { emptyCaseEditorSaveState } from './caseEditorSaveState'

const id = '11111111-1111-4111-8111-111111111111'
const event = { preventDefault() {}, currentTarget: { elements: { namedItem: () => null } } } as any
function setup() {
  const params: any = {
    caseEditorSaveRef: { current: emptyCaseEditorSaveState() },
    t: (key: string) => key, newTestSteps: [{ action: 'Pay', expected: 'Approved', data: '', actionAttachments: [{ id }] }],
    newTestTitle: 'Payment', newTestSuite: id, newTestSuiteSub: '', newTestComponent: id,
    newTestDescription: '', newTestPre: '', newTestPost: '', newTestData: '', newTestTags: [],
    newTestPriority: 'MEDIA', newTestCriticality: 'MEDIA', newTestStatus: 'ACTIVO', newTestType: 'Manual', newTestFormat: 'CLASICA',
    newTestChatbotConfig: {}, newTestApiConfig: {}, newTestScript: '', newTestFramework: 'playwright', newTestLanguage: 'javascript',
    pendingTraceabilityStoryIds: [], caseEditorSaving: false, editingCasoMasterId: null, selectedTest: null,
    projectsSource: 'backend', currentProjectId: id, currentCompId: id, componentsList: [], casosList: [], suitesTree: [], currentCaseEditorSnapshot: {},
    handleCreateCaso: vi.fn(async () => ({ id, master_id: id, version: 1 })),
    handleUpdateCaso: vi.fn(async () => ({ id, master_id: id, version: 1 })),
    fetchWithAuth: vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/casos/') ? { pasos: [{ numero_paso: 1, id }] } : []))),
    showFeedback: vi.fn(), setCaseEditorOpen: vi.fn(), setProjectSyncMessage: vi.fn(),
    setEditingCasoMasterId: vi.fn((value: string | null) => { params.editingCasoMasterId = value }),
    setPendingTraceabilityStoryIds: vi.fn((value: string[]) => { params.pendingTraceabilityStoryIds = value }),
  }
  const proxy = new Proxy(params, { get: (target, key) => key in target ? target[key] : () => {} })
  return { params, actions: () => createCaseEditorActions(proxy) }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
describe('case editor save recovery', () => {
  it('serializes concurrent saves before a React render', async () => {
    const { params, actions } = setup()
    const action = actions()
    await Promise.all([action.handleSaveTest(event), action.handleSaveTest(event)])
    expect(params.handleCreateCaso).toHaveBeenCalledTimes(1)
  })
  it('keeps the editor open after reference failure and retries without creating again', async () => {
    const { params, actions } = setup()
    params.fetchWithAuth.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await actions().handleSaveTest(event)
    expect(params.setCaseEditorOpen).not.toHaveBeenCalled()
    expect(params.showFeedback.mock.calls.at(-1)?.[2]).toBe('danger')
    await actions().handleSaveTest(event)
    expect(params.handleCreateCaso).toHaveBeenCalledTimes(1)
    expect(params.handleUpdateCaso).not.toHaveBeenCalled()
    expect(params.setCaseEditorOpen).toHaveBeenCalledWith(false)
  })
  it('preserves story selection through partial synchronization', async () => {
    const { params, actions } = setup()
    params.pendingTraceabilityStoryIds = [id]
    params.fetchWithAuth.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    await actions().handleSaveTest(event)
    expect(params.pendingTraceabilityStoryIds).toEqual([id])
    await actions().handleSaveTest(event)
    expect(params.handleCreateCaso).toHaveBeenCalledTimes(1)
    const writes = params.fetchWithAuth.mock.calls.filter(([url]: [string]) => url.endsWith('/historias/'))
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1][1].body).historia_ids).toEqual([id])
  })
  it('updates the saved identity when definition changes during recovery', async () => {
    const { params, actions } = setup()
    params.fetchWithAuth.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await actions().handleSaveTest(event)
    params.newTestTitle = 'Updated'
    await actions().handleSaveTest(event)
    expect(params.handleCreateCaso).toHaveBeenCalledTimes(1)
    expect(params.handleUpdateCaso).toHaveBeenCalledWith(id, expect.objectContaining({ titulo: 'Updated' }))
  })
  it('reuses the request ID after a lost create response', async () => {
    const { params, actions } = setup()
    params.handleCreateCaso.mockResolvedValueOnce(false)
    await actions().handleSaveTest(event)
    await actions().handleSaveTest(event)
    expect(params.handleCreateCaso.mock.calls[0][0].request_id).toBe(params.handleCreateCaso.mock.calls[1][0].request_id)
  })
  it('replaces references atomically and aligns steps after filtering empty rows', async () => {
    const { params, actions } = setup()
    params.newTestSteps.unshift({ action: '', expected: '', data: '' })
    await actions().handleSaveTest(event)
    const replacements = params.fetchWithAuth.mock.calls.filter(([url]: [string]) => url.endsWith('/references/'))
    expect(replacements).toHaveLength(1)
    expect(replacements[0][1].method).toBe('PUT')
    expect(JSON.parse(replacements[0][1].body).attachments).toEqual([{ attachment_id: id, tipo: 'ACTION_REFERENCE' }])
    expect(params.fetchWithAuth.mock.calls.some(([, options]: [string, any]) => options?.method === 'DELETE')).toBe(false)
  })
})
