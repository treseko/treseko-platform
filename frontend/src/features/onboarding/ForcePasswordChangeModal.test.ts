import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPasswordChangeResult } from './passwordChangeResult'

test('el cambio de contraseña renueva el token antes de actualizar la sesión visible', () => {
  const calls: string[] = []
  const response = {
    access_token: 'new-session-token',
    profile_settings: {
      security: {
        force_password_change: false
      }
    }
  }

  applyPasswordChangeResult(
    response,
    token => calls.push(`token:${token}`),
    preferences => calls.push(`preferences:${preferences.profile_settings.security.force_password_change}`)
  )

  assert.deepEqual(calls, [
    'token:new-session-token',
    'preferences:false'
  ])
})

test('el cambio de contraseña falla de forma explícita si el backend omite el token renovado', () => {
  assert.throws(
    () => applyPasswordChangeResult({}, () => undefined, () => undefined),
    /no se pudo renovar la sesión/i
  )
})
