import assert from 'node:assert/strict'
import test from 'node:test'
import { restartPreparedSystemUpdate } from './configuracionApi'

type Timer = { callback: () => void, delay: number }

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function installFakeTimers() {
  const timers: Timer[] = []
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).window = {
    setTimeout(callback: () => void, delay: number) {
      timers.push({ callback, delay })
      return timers.length
    },
  }
  return {
    timers,
    restore() {
      if (previousWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = previousWindow
    },
  }
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers })
}

test('restart prepared update retries 429 twice with 2s and 4s timers', async () => {
  const fakeTimers = installFakeTimers()
  const responses = [
    jsonResponse(429, { detail: 'busy' }),
    jsonResponse(429, { detail: 'still busy' }),
    jsonResponse(200, { status: 'restarting', task_id: 'task-1' }),
  ]
  const requests: Array<{ url: string, method: string }> = []
  const fetchWithAuth = async (url: string, options?: RequestInit) => {
    requests.push({ url, method: options?.method ?? 'GET' })
    return responses.shift() as Response
  }

  try {
    const resultPromise = restartPreparedSystemUpdate(fetchWithAuth, 'task/1')
    await flushMicrotasks()
    assert.equal(requests.length, 1)
    assert.deepEqual(fakeTimers.timers.map(timer => timer.delay), [2000])

    fakeTimers.timers.shift()?.callback()
    await flushMicrotasks()
    assert.equal(requests.length, 2)
    assert.deepEqual(fakeTimers.timers.map(timer => timer.delay), [4000])

    fakeTimers.timers.shift()?.callback()
    const result = await resultPromise
    assert.deepEqual(result, { status: 'restarting', task_id: 'task-1' })
    assert.equal(requests.length, 3)
    assert.ok(requests.every(request => request.method === 'POST'))
    assert.ok(requests.every(request => request.url.endsWith('/system/updates/restart/task%2F1')))
  } finally {
    fakeTimers.restore()
  }
})

test('restart prepared update rejects a third 429 without a fourth attempt', async () => {
  const fakeTimers = installFakeTimers()
  const responses = [
    jsonResponse(429, { detail: 'busy' }),
    jsonResponse(429, { detail: 'still busy' }),
    jsonResponse(429, { detail: 'retry later' }),
  ]
  let calls = 0
  const fetchWithAuth = async () => {
    calls += 1
    return responses.shift() as Response
  }

  try {
    const resultPromise = restartPreparedSystemUpdate(fetchWithAuth, 'task-2')
    await flushMicrotasks()
    fakeTimers.timers.shift()?.callback()
    await flushMicrotasks()
    fakeTimers.timers.shift()?.callback()
    await assert.rejects(resultPromise, /temporalmente limitado/i)
    assert.equal(calls, 3)
    assert.deepEqual(fakeTimers.timers, [])
  } finally {
    fakeTimers.restore()
  }
})

test('restart prepared update does not retry non-429 errors', async () => {
  const fakeTimers = installFakeTimers()
  let calls = 0
  const fetchWithAuth = async () => {
    calls += 1
    return jsonResponse(409, { detail: 'not prepared' })
  }

  try {
    await assert.rejects(
      restartPreparedSystemUpdate(fetchWithAuth, 'task-3'),
      /not prepared/i,
    )
    assert.equal(calls, 1)
    assert.deepEqual(fakeTimers.timers, [])
  } finally {
    fakeTimers.restore()
  }
})

test('restart prepared update respects Retry-After and does not expose nginx HTML', async () => {
  const fakeTimers = installFakeTimers()
  const responses = [
    textResponse(429, '<html><body>nginx429</body></html>', { 'Retry-After': '1' }),
    jsonResponse(200, { status: 'restarting', task_id: 'task-4' }),
  ]

  try {
    const resultPromise = restartPreparedSystemUpdate(async () => responses.shift() as Response, 'task-4')
    await flushMicrotasks()
    assert.deepEqual(fakeTimers.timers.map(timer => timer.delay), [1000])
    fakeTimers.timers.shift()?.callback()
    assert.deepEqual(await resultPromise, { status: 'restarting', task_id: 'task-4' })
  } finally {
    fakeTimers.restore()
  }
})
