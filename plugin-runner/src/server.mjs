import http from 'node:http'
import { readFileSync } from 'node:fs'

const port = Number(process.env.PLUGIN_RUNNER_PORT || 3020)
const maxBodyBytes = 256 * 1024
let releaseVersion = ''
try { releaseVersion = readFileSync('/TRESEKO_RELEASE_VERSION', 'utf8').trim() } catch {}

function send(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(payload))
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') return send(response, 200, { status: 'ok', service: 'plugin-runner', version: releaseVersion, runtime: 'declarative-only' })
  if (request.method !== 'POST' || request.url !== '/invoke') return send(response, 404, { detail: 'Not found' })
  let size = 0
  const chunks = []
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > maxBodyBytes) request.destroy()
    else chunks.push(chunk)
  })
  request.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (payload?.kind !== 'declarative' || payload?.entrypoint !== 'junit_xml.import_results') return send(response, 403, { detail: 'Plugin entrypoint is not allowed' })
      // This runner intentionally receives only a brokered, schema-validated request.
      // No plugin source, file path, environment values, network target or secret is accepted.
      return send(response, 200, { status: 'accepted', invocation_id: payload.invocation_id, result: { handler: 'junit_xml.import_results' } })
    } catch {
      return send(response, 400, { detail: 'Invalid request' })
    }
  })
})

server.listen(port, '0.0.0.0')

// Node's close stops accepting new sockets and lets in-flight invocations end.
// DockerComponentRuntime uses the Compose stop timeout before replacing image.
process.once('SIGTERM', () => server.close(() => process.exit(0)))
