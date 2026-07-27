import { describe, expect, it } from 'vitest'

import { isOpenBugState, readInternalReportTokenFromLocation, readStoredAuthentication } from './appEntryPresentation'

describe('app entry presentation', () => {
  it.each(['RESUELTO', 'cerrado', 'DUPLICADO', 'NO_REPRODUCIBLE', 'no_corresponde'])(
    'identifica %s como bug cerrado',
    (status) => expect(isOpenBugState(status)).toBe(false),
  )

  it.each([undefined, null, '', 'ABIERTO', 'TRIAGE', 'BLOQUEADO'])(
    'identifica %s como bug abierto',
    (status) => expect(isOpenBugState(status)).toBe(true),
  )

  it('prioriza el token de query y conserva caracteres codificados', () => {
    expect(readInternalReportTokenFromLocation({ search: '?internal_report=a%2Fb', pathname: '/' })).toBe('a/b')
  })

  it('lee el token desde la ruta interna y rechaza rutas no compatibles', () => {
    expect(readInternalReportTokenFromLocation({ search: '', pathname: '/informes-internos/p/b/r/token%20seguro' })).toBe('token seguro')
    expect(readInternalReportTokenFromLocation({ search: '', pathname: '/informes-internos/p/b' })).toBe('')
    expect(readInternalReportTokenFromLocation({ search: '', pathname: '/otra-ruta/token' })).toBe('')
  })

  it('restaura únicamente una sesión activa con token vigente', () => {
    const values = new Map([['qa_session_active', 'true'], ['qa_access_token', 'token'], ['qa_session_expires_at', '2030-01-01T00:00:00.000Z']])
    const storage = { getItem: (key: string) => values.get(key) || null, removeItem: (key: string) => values.delete(key) }
    expect(readStoredAuthentication(storage, Date.parse('2029-01-01T00:00:00.000Z'))).toBe(true)
    values.delete('qa_access_token')
    expect(readStoredAuthentication(storage)).toBe(false)
  })

  it('limpia todos los datos de una sesión vencida', () => {
    const values = new Map([['qa_session_active', 'true'], ['qa_access_token', 'token'], ['qa_session_user', 'user'], ['qa_session_expires_at', '2020-01-01T00:00:00.000Z']])
    const removed: string[] = []
    const storage = { getItem: (key: string) => values.get(key) || null, removeItem: (key: string) => { removed.push(key); values.delete(key) } }
    expect(readStoredAuthentication(storage, Date.parse('2021-01-01T00:00:00.000Z'))).toBe(false)
    expect(removed).toEqual(['qa_session_active', 'qa_session_user', 'qa_access_token', 'qa_session_expires_at'])
  })
})
