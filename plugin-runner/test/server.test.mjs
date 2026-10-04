import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let child
let baseUrl

async function reservePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const { port } = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

before(async () => {
  const port = await reservePort()
  baseUrl = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [path.join(root, 'src', 'server.mjs')], {
    env: { ...process.env, PLUGIN_RUNNER_PORT: String(port) },
    stdio: 'ignore',
  })
  child.once('error', (error) => { throw error })
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Plugin runner exited with ${child.exitCode}`)
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Plugin runner did not become healthy')
})

after(async () => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
})

test('health endpoint reports the declarative-only runtime', async () => {
  const response = await fetch(`${baseUrl}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'ok', service: 'plugin-runner', version: '', runtime: 'declarative-only',
  })
})

test('accepts the supported JUnit import entrypoint', async () => {
  const response = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invocation_id: 'qa-plugin-runner-104',
      kind: 'declarative',
      entrypoint: 'junit_xml.import_results',
    }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'accepted',
    invocation_id: 'qa-plugin-runner-104',
    result: { handler: 'junit_xml.import_results' },
  })
})

test('rejects arbitrary or unsupported plugin entrypoints', async () => {
  const response = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invocation_id: 'qa-plugin-runner-denied',
      kind: 'wasm',
      entrypoint: 'arbitrary.execute',
    }),
  })
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { detail: 'Plugin entrypoint is not allowed' })
})
