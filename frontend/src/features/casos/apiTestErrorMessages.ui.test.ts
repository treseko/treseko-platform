import { describe, expect, it } from 'vitest'
import { apiExecutionMessage, readApiTestError } from './apiTestErrorMessages'
import en from '../../i18n/catalogs/en/casos'
import { interpolate } from '../../i18n/index'

const translatorFor = (catalog: typeof en) => (key: string, params?: Record<string, string | number>) => {
  const messageKey = key.replace(/^casos\./, '') as keyof typeof catalog
  return interpolate(String(catalog[messageKey] ?? key), params)
}

describe('API test error messages', () => {
  it('translates a missing endpoint into an actionable message', async () => {
    const message = await readApiTestError(new Response('Not Found', { status: 404 }))
    expect(message).toContain('No se encontró la prueba API')
  })

  it('translates unresolved variables without exposing technical details', async () => {
    const message = await readApiTestError(new Response(JSON.stringify({ detail: 'Variables API no resueltas: api.access_token' }), { status: 422 }))
    expect(message).toContain('Faltan variables necesarias')
    expect(message).not.toContain('api.access_token')
  })

  it('distinguishes an upstream authentication response from a runner error', () => {
    expect(apiExecutionMessage({ status: 'FAILED', steps: [{ response: { status: 401 }, assertions: [] }] }))
      .toContain('rechazó la autenticación')
  })

  it('explains assertion failures in plain language', () => {
    expect(apiExecutionMessage({ status: 'FAILED', steps: [{ response: { status: 200 }, assertions: [{ status: 'FAILED' }] }] }))
      .toContain('no cumple')
  })

  it('uses the optional translator while keeping bilingual classification and details private', async () => {
    const message = await readApiTestError(
      new Response(JSON.stringify({ detail: 'Faltan variables: api.access_token at https://private.example.test' }), { status: 422 }),
      translatorFor(en),
    )

    expect(message).toBe(en.apiErrorMissingVariables)
    expect(message).not.toContain('api.access_token')
    expect(message).not.toContain('private.example.test')
  })

  it('localizes upstream and unknown fallback messages without changing the result contract', async () => {
    expect(apiExecutionMessage(
      { status: 'FAILED', steps: [{ response: { status: 401 }, assertions: [] }] },
      translatorFor(en),
    )).toBe(en.apiErrorUpstreamUnauthorized)

    const fallback = await readApiTestError(
      new Response('opaque token=secret id=case-42 https://private.example.test', { status: 418 }),
      undefined,
      translatorFor(en),
    )
    expect(fallback).toBe(en.apiErrorExecutionFallback)
    expect(fallback).not.toContain('secret')
    expect(fallback).not.toContain('case-42')
    expect(fallback).not.toContain('private.example.test')
  })

  it('keeps the legacy fallback argument compatible and fails safely if translation fails', async () => {
    await expect(readApiTestError(new Response('unknown', { status: 418 }), 'Legacy friendly fallback'))
      .resolves.toBe('Legacy friendly fallback')

    await expect(readApiTestError(
      new Response('unknown', { status: 418 }),
      undefined,
      () => { throw new Error('translator unavailable') },
    )).resolves.toBe('No se pudo ejecutar la prueba API.')
  })

  it('classifies English variable, security and DNS details without exposing them', async () => {
    const translate = translatorFor(en)
    await expect(readApiTestError(new Response('Missing variables: {{access_token}}', { status: 422 }), translate))
      .resolves.toBe(en.apiErrorMissingVariables)
    await expect(readApiTestError(new Response('Request blocked by allowlist', { status: 422 }), translate))
      .resolves.toBe(en.apiErrorSecurityBlocked)
    await expect(readApiTestError(new Response('Could not resolve host private.internal', { status: 422 }), translate))
      .resolves.toBe(en.apiErrorDnsResolutionFailed)
  })

  it('rejects a sensitive legacy fallback', async () => {
    await expect(readApiTestError(new Response('unknown', { status: 418 }), 'Request failed token=secret https://private.example.test'))
      .resolves.toBe('No se pudo ejecutar la prueba API.')
    await expect(readApiTestError(new Response('unknown', { status: 418 }), 'access_token=secret'))
      .resolves.toBe('No se pudo ejecutar la prueba API.')
    await expect(readApiTestError(new Response('unknown', { status: 418 }), 'request id case-42'))
      .resolves.toBe('No se pudo ejecutar la prueba API.')
    await expect(readApiTestError(new Response('unknown', { status: 418 }), 'token/ID case-42'))
      .resolves.toBe('No se pudo ejecutar la prueba API.')
    for (const fallback of ['request_id=case-42', 'traceId=trace-42', 'correlation_id=corr-42', 'session_id=session-42', 'run_id=run-42', 'user_id=user-42', 'Authorization Bearer secret', 'Bearer secret']) {
      await expect(readApiTestError(new Response('unknown', { status: 418 }), fallback))
        .resolves.toBe('No se pudo ejecutar la prueba API.')
    }
  })
})
