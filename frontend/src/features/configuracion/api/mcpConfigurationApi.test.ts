import assert from 'node:assert/strict'
import test from 'node:test'
import { createMcpCredential, fetchMcpConfiguration, listMcpCredentials, revokeMcpCredential } from './configuracionApi'

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('MCP API client uses browser configuration and explicit credential endpoints', async () => {
  const requests: Array<{ url: string; method: string; body?: string }> = []
  const fetchWithAuth = async (url: string, options?: RequestInit) => {
    requests.push({ url, method: options?.method || 'GET', body: options?.body as string })
    return response({ tools: [], protocol_version: '2025-03-26' })
  }

  await fetchMcpConfiguration(fetchWithAuth)
  await listMcpCredentials(fetchWithAuth)
  await createMcpCredential(fetchWithAuth, { nombre: 'CI', scopes: ['mcp.projects.read'] })
  await revokeMcpCredential(fetchWithAuth, 'credential-1')

  assert.deepEqual(requests.map(request => [request.method, request.url]), [
    ['GET', '/api/mcp/configuration'],
    ['GET', '/api/users/me/mcp-credentials/'],
    ['POST', '/api/users/me/mcp-credentials/'],
    ['DELETE', '/api/users/me/mcp-credentials/credential-1/'],
  ])
  assert.equal(requests[2].body, JSON.stringify({ nombre: 'CI', scopes: ['mcp.projects.read'] }))
})
