import assert from 'node:assert/strict'
import test from 'node:test'
import { applyConnectionPreset, chatbotProfilePresets, mergeChatbotConfig, migrateOpeningMessageToTurn, normalizeChatbotConfig, normalizeEnvironmentChatbotConfig, normalizeReusableProfiles, resolveChatbotProfile } from './chatbotConfig'

test('ofrece cinco perfiles de sistema cuando el ambiente todavía no tiene catálogo', () => {
  const environment = normalizeEnvironmentChatbotConfig({ connection: { endpoint: 'http://chat.test/api' } })

  assert.equal(chatbotProfilePresets.length, 5)
  assert.equal(environment.profiles.length, 5)
  assert.equal(environment.default_profile, 'usuario_mayor')
})

test('normaliza perfiles reutilizables y resuelve el perfil predeterminado', () => {
  const environment = normalizeEnvironmentChatbotConfig({
    profiles: [{ id: 'usuario_mayor', name: 'Usuario mayor', profile: { age: 65, tone: 'confused' } }],
    default_profile: 'usuario_mayor',
    profile_bindings: { age: 'edad' },
  })
  const merged = mergeChatbotConfig(environment, {})
  const resolved = resolveChatbotProfile(merged, { variables: { edad: '66' } }, null, null)

  assert.equal(normalizeReusableProfiles(environment.profiles).length, 1)
  assert.equal(resolved.profile.age, 66)
  assert.equal(resolved.profile.tone, 'confused')
  assert.deepEqual(resolved.missing, [])
})

test('acepta perfiles definidos como mapa por id', () => {
  const profiles = normalizeReusableProfiles({ experto: { writing_level: 'high' } })

  assert.deepEqual(profiles[0], {
    id: 'experto',
    name: 'experto',
    description: '',
    profile: { writing_level: 'high' },
  })
})

test('normaliza la observabilidad de herramientas y conserva compatibilidad legacy', () => {
  const config = normalizeChatbotConfig({
    endpoint: 'http://localhost/chat',
    opening_message: 'hola',
    tools: [
      { name: 'get_cart', require_observable: true },
      { name: 'search_catalog' },
      { name: 'future_trace', observation: { mode: 'external_trace' } },
    ],
  })

  assert.equal(config.tools[0].observation.mode, 'response_payload')
  assert.equal(config.tools[0].observation.required, true)
  assert.equal(config.tools[1].observation.mode, 'black_box')
  assert.equal(config.tools[2].observation.mode, 'external_trace')
})

test('muestra como respuesta esperada las variantes legacy del contrato', () => {
  const config = normalizeChatbotConfig({
    conversation: {
      turns: [
        { input: { text: 'uno' }, expected_response: 'respuesta uno' },
        { input: { text: 'dos' }, semantic: 'respuesta dos' },
      ],
    },
  })

  assert.equal(config.conversation.turns[0].expected.semantic, 'respuesta uno')
  assert.equal(config.conversation.turns[1].expected.semantic, 'respuesta dos')
})

test('migra el mensaje inicial legacy al primer turno sin duplicarlo', () => {
  const config = migrateOpeningMessageToTurn({
    conversation: {
      opening_message: { mode: 'fixed', text: 'objetivo' },
      turns: [{ order: 1, input: { mode: 'fixed', text: 'estado' } }],
    },
  })

  assert.equal(config.conversation.opening_message.text, '')
  assert.deepEqual(config.conversation.turns.map((turn: any) => turn.input.text), ['estado'])
  assert.deepEqual(migrateOpeningMessageToTurn(config).conversation.turns.map((turn: any) => turn.input.text), ['estado'])
})

test('los presets conservan autorización pero aplican su contrato de transporte', () => {
  const source = {
    connection: {
      adapter: 'generic_http',
      headers: { Authorization: 'Bearer test-token', 'content-type': 'application/xml' },
      response_mapping: { session_id_path: '$.legacy_session' },
    },
  }

  const text = applyConnectionPreset(source, 'text_http')
  const openAi = applyConnectionPreset(source, 'openai_compatible')

  assert.equal(text.connection.headers.Authorization, 'Bearer test-token')
  assert.equal(text.connection.headers['Content-Type'], 'application/json')
  assert.equal(text.connection.headers['content-type'], undefined)
  assert.equal(text.connection.response_mapping.response_format, 'text')
  assert.equal(openAi.connection.response_mapping.message_path, '$.choices[0].message.content')
  assert.equal(openAi.connection.response_mapping.session_id_path, '')
})
