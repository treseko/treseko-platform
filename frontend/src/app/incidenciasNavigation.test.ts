import assert from 'node:assert/strict'
import test from 'node:test'
import { allSidebarItems } from './navigationModel'
import { canAccessModule } from './rbac/permissions'
import { MODULE_PERMISSIONS } from './constants'

const user = (permissions: Record<string, 'read' | 'edit'>, capabilities: Record<string, 'read' | 'edit'> = {}) => ({
  name: 'Test User',
  email: 'test@example.com',
  auth: 'local' as const,
  avatar: '',
  modules: [],
  role: 'VIEWER' as const,
  permissions,
  capabilities,
})

test('registra Centro de Incidencias como módulo navegable', () => {
  assert.equal(allSidebarItems.some(item => item.id === 'incidencias'), true)
})

test('la capability granular permite el módulo sin habilitarlo por defecto en QA', () => {
  assert.equal(canAccessModule(user({}, { 'incidencias.ver': 'read' }), 'incidencias'), true)
  assert.equal(MODULE_PERMISSIONS.TESTER.includes('incidencias'), false)
})

test('bugs.ver conserva compatibilidad para el Centro de Incidencias', () => {
  assert.equal(canAccessModule(user({}, { 'bugs.ver': 'read' }), 'incidencias'), true)
})

test('la compatibilidad de bugs.ver no concede edición del Centro de Incidencias', () => {
  assert.equal(canAccessModule(user({}, { 'bugs.ver': 'read' }), 'incidencias', 'edit'), false)
  assert.equal(canAccessModule(user({}, { 'incidencias.ver': 'read' }), 'incidencias', 'edit'), false)
  assert.equal(canAccessModule(user({}, { 'incidencias.ver': 'edit' }), 'incidencias', 'edit'), true)
})
