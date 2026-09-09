// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseConversationalCard, CHATBOT_CONNECTION_PREVIEW_PATH } from './CaseConversationalCard'
import { I18nProvider } from '../../i18n'

const chatbotConfig = {
  connection: { endpoint: 'http://chatbot.test/chat', headers: {}, request_template: {} },
  conversation: {
    session_mode: 'reuse',
    turns: [{
      order: 1,
      role: 'user',
      input: { mode: 'fixed', text: 'hola' },
      expected: { semantic: 'saluda' },
      assertions: [],
    }],
  },
}

const testT = (key: string) => ({
  'casos.chatbotPrimarySetup': '1. Conexión y datos de ejecución',
  'casos.chatbotPrimarySetupHelp': 'Elegí el endpoint y los datos del chatbot.',
  'casos.chatbotEndpointLabel': 'URL o endpoint del chatbot',
  'casos.chatbotEndpointHelp': 'Usá variables del ambiente o dataset.',
  'casos.chatbotAvailableVariables': 'Variables disponibles',
  'casos.chatbotNoVariables': 'Sin variables',
  'casos.chatbotConversationTitle': '2. Turnos de conversación',
  'casos.messageInstruction': 'Mensaje o instrucción',
  'casos.chatbotReady': 'Listo para ejecutar',
  'casos.collapseConfiguration': 'Ocultar configuración',
  'casos.expandConfiguration': 'Mostrar configuración',
  'casos.connectionType': 'Tipo de conexión',
  'casos.connectionPresetGenericHttp': 'HTTP JSON genérico',
  'casos.connectionPresetGenericHttpHelp': 'Para APIs HTTP.',
  'casos.connectionPresetOpenAi': 'Compatible con OpenAI',
  'casos.connectionPresetOpenAiHelp': 'Para APIs compatibles.',
  'casos.connectionPresetTextHttp': 'HTTP texto',
  'casos.connectionPresetTextHttpHelp': 'Para texto plano.',
  'casos.responseContractTitle': 'Contrato de respuesta',
  'casos.responseContractHelp': 'Cómo encontrar la respuesta.',
  'casos.responseContractRequired': 'Necesario para evaluar',
  'casos.responseFormat': 'Formato',
  'casos.responseFormatAuto': 'Detectar automáticamente',
  'casos.responseFormatJson': 'JSON',
  'casos.responseFormatText': 'Texto plano',
  'casos.connectionPreviewButton': 'Probar conexión',
  'casos.connectionPreviewLoading': 'Probando conexión…',
  'casos.connectionPreviewSample': 'Hola',
  'casos.connectionPreviewSuccess': 'La conexión respondió correctamente',
  'casos.connectionPreviewErrorTitle': 'No se pudo probar la conexión',
  'casos.connectionPreviewError': 'No respondió.',
  'casos.connectionPreviewErrorHelp': 'Revisá la configuración.',
  'casos.previewHttpStatus': 'Estado HTTP',
  'casos.previewLatency': 'Latencia',
  'casos.previewFormat': 'Formato detectado',
  'casos.previewSession': 'Sesión',
  'casos.previewSessionDetected': 'Detectada',
  'casos.previewSessionNotDetected': 'No detectada',
  'casos.previewExtractedMessage': 'Mensaje extraído',
  'casos.notReported': 'No informado',
  'casos.noTurnsTitle': 'La conversación todavía está incompleta',
  'casos.addFirstTurn': 'Agregar primer turno',
}[key] || key)

describe('CaseConversationalCard', () => {
  afterEach(() => cleanup())

  it('permite contraer la configuración extensa sin ocultar el estado del caso', () => {
    render(
      <I18nProvider>
        <CaseConversationalCard context={{
          newTestFormat: 'CONVERSACIONAL',
          newTestChatbotConfig: chatbotConfig,
          setNewTestChatbotConfig: vi.fn(),
          selectedTest: null,
          selectedDryRunEnvironment: null,
          selectedDryRunDataset: null,
          projectEnvironments: [],
          componentsList: [],
          newTestComponent: '',
          t: testT,
        }} />
      </I18nProvider>,
    )

    const toggle = screen.getByRole('button', { name: 'Ocultar configuración' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('2. Turnos de conversación')).toBeTruthy()

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Mostrar configuración' })).toBeTruthy()
    expect(screen.getByText('2. Turnos de conversación')).toBeTruthy()
    expect(screen.queryByText('1. Conexión y datos de ejecución')).toBeNull()
    expect(screen.getByText('Listo para ejecutar')).toBeTruthy()
  })

  it('envía al estado la edición de la respuesta esperada de un turno', () => {
    const setNewTestChatbotConfig = vi.fn()
    const { getByTestId } = render(
      <I18nProvider>
        <CaseConversationalCard
        context={{
          newTestFormat: 'CONVERSACIONAL',
          newTestChatbotConfig: chatbotConfig,
          setNewTestChatbotConfig,
          selectedTest: { id: 'case-chat-1', configuracion_chatbot: chatbotConfig },
          selectedDryRunEnvironment: null,
          selectedDryRunDataset: null,
          projectEnvironments: [],
          componentsList: [],
          newTestComponent: '',
        }}
        />
      </I18nProvider>,
    )

    const expected = getByTestId('expected-response-1')
    const message = screen.getByRole('textbox', { name: /messageInstruction/ })
    expect(message.tagName).toBe('TEXTAREA')
    expect(message.classList.contains('chatbot-turn-message-input')).toBe(true)
    expect(getByTestId('chatbot-turn-fields-1').querySelector('.chatbot-turn-number')).toBeTruthy()
    expect(getByTestId('chatbot-turn-fields-1').querySelector('.chatbot-turn-role')).toBeTruthy()
    expect(getByTestId('chatbot-turn-fields-1').querySelector('.chatbot-turn-message')).toBeTruthy()
    expect(getByTestId('chatbot-turn-fields-1').querySelector('.chatbot-turn-expected')).toBeTruthy()
    expect(getByTestId('chatbot-turn-fields-1').querySelector('.chatbot-turn-must-include')).toBeTruthy()
    fireEvent.change(expected, { target: { value: 'respuesta actualizada' } })

    expect(setNewTestChatbotConfig).toHaveBeenCalledTimes(1)
    const updater = setNewTestChatbotConfig.mock.calls[0][0]
    const updated = updater(chatbotConfig)
    expect(updated.conversation.turns[0].expected.semantic).toBe('respuesta actualizada')
  })

  it('muestra primero el endpoint y el contexto de datos antes de los turnos', () => {
    render(
      <I18nProvider>
        <CaseConversationalCard
          context={{
            newTestFormat: 'CONVERSACIONAL',
            newTestChatbotConfig: chatbotConfig,
            setNewTestChatbotConfig: vi.fn(),
            selectedTest: null,
            selectedDryRunEnvironment: {
              id: 'env-1',
              name: 'Staging',
              chatbotConfig: { connection: { endpoint: '{{ENV.CHATBOT_URL}}/chat' } },
              variables: { CHATBOT_URL: 'https://chat.example.test' },
            },
            selectedDryRunDataset: { id: 'dataset-1', name: 'Datos demo', variables: { customer_id: 'qa-1' } },
            projectEnvironments: [],
            dryRunDatasets: [{ id: 'dataset-1', name: 'Datos demo' }],
            componentsList: [],
            newTestComponent: '',
            t: testT,
          }}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('1. Conexión y datos de ejecución')).toBeTruthy()
    expect(screen.getByLabelText('URL o endpoint del chatbot*')).toBeTruthy()
    expect(screen.getByText('Variables disponibles:')).toBeTruthy()
    expect(screen.getByText('2. Turnos de conversación')).toBeTruthy()
  })

  it('ofrece presets de conexión sin perder headers existentes', () => {
    const setNewTestChatbotConfig = vi.fn()
    render(
      <I18nProvider>
        <CaseConversationalCard context={{
          newTestFormat: 'CONVERSACIONAL',
          newTestChatbotConfig: { connection: { endpoint: 'https://chat.test', headers: { Authorization: 'Bearer test-token' } }, conversation: { turns: [] } },
          setNewTestChatbotConfig,
          selectedTest: null,
          selectedDryRunEnvironment: null,
          selectedDryRunDataset: null,
          projectEnvironments: [],
          componentsList: [],
          newTestComponent: '',
          t: testT,
        }} />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByLabelText('Tipo de conexión'), { target: { value: 'text_http' } })
    const updater = setNewTestChatbotConfig.mock.calls.at(-1)?.[0]
    const updated = updater({ connection: { endpoint: 'https://chat.test', headers: { Authorization: 'Bearer test-token' } }, conversation: { turns: [] } })
    expect(updated.connection.adapter).toBe('generic_http')
    expect(updated.connection.response_mapping.response_format).toBe('text')
    expect(updated.connection.headers.Authorization).toBe('Bearer test-token')
  })

  it('prueba la conexión por el cliente autenticado y muestra un resumen seguro', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 200, latency_ms: 42, response_format: 'json', message_extracted: 'Hola', session_id: 'session-secret', session_detected: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(
      <I18nProvider>
        <CaseConversationalCard context={{
          newTestFormat: 'CONVERSACIONAL',
          newTestChatbotConfig: chatbotConfig,
          setNewTestChatbotConfig: vi.fn(),
          fetchWithAuth,
          currentProjectId: 'project-1',
          selectedTest: null,
          selectedDryRunEnvironment: { id: 'env-1', name: 'QA' },
          selectedDryRunDataset: { id: 'dataset-1', name: 'Datos demo' },
          projectEnvironments: [],
          componentsList: [],
          newTestComponent: 'component-1',
          t: testT,
        }} />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }))
    await waitFor(() => expect(screen.getByText('La conexión respondió correctamente', { selector: '.chatbot-preview-result strong' })).toBeTruthy())
    expect(fetchWithAuth).toHaveBeenCalledWith(expect.stringContaining(CHATBOT_CONNECTION_PREVIEW_PATH), expect.objectContaining({ method: 'POST' }))
    const requestOptions = fetchWithAuth.mock.calls[0][1]
    expect(JSON.parse(requestOptions.body)).toMatchObject({ entorno_id: 'env-1', message: 'hola', configuration: expect.any(Object) })
    expect(screen.getByText('Detectada')).toBeTruthy()
    expect(screen.queryByText('session-secret')).toBeNull()
  })

  it('marca una conversación sin turnos como incompleta y ofrece el primer turno', () => {
    const setNewTestChatbotConfig = vi.fn()
    render(
      <I18nProvider>
        <CaseConversationalCard context={{
          newTestFormat: 'CONVERSACIONAL',
          newTestChatbotConfig: { connection: { endpoint: 'https://chat.test' }, conversation: { turns: [] } },
          setNewTestChatbotConfig,
          selectedTest: null,
          selectedDryRunEnvironment: null,
          selectedDryRunDataset: null,
          projectEnvironments: [],
          componentsList: [],
          newTestComponent: '',
          t: testT,
        }} />
      </I18nProvider>,
    )

    expect(screen.getByText('La conversación todavía está incompleta')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Agregar turno' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Agregar primer turno' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar primer turno' }))
    const updater = setNewTestChatbotConfig.mock.calls.at(-1)?.[0]
    expect(updater({ connection: { endpoint: 'https://chat.test' }, conversation: { turns: [] } }).conversation.turns).toHaveLength(1)
  })
})
