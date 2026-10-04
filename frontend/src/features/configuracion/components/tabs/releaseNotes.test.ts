import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLatestReleaseNotes } from './releaseNotes'
import { systemMonitorDetailLabel, systemStatusLabel, updateStageLabel, updateStatusLabel } from '../../updatePresentation'

test('muestra solo la versión solicitada y conserva sus categorías', () => {
  const groups = parseLatestReleaseNotes(`# Treseko 1.0.5

## Mejoras
- Interfaz más clara.

## Seguridad
- Actualización segura.

# Treseko 1.0.4
## Correcciones
- No debe aparecer.`, '1.0.5')

  assert.deepEqual(groups, [
    { title: 'Mejoras', items: ['Interfaz más clara.'] },
    { title: 'Seguridad', items: ['Actualización segura.'] },
  ])
})

test('no muestra un changelog completo si no existe la sección de la versión', () => {
  assert.deepEqual(parseLatestReleaseNotes('# Treseko 1.0.4\n\n- Cambio anterior.', '1.0.5'), [])
})

test('localiza estados del sistema, etapas de actualización y errores conocidos del motor IA', () => {
  const translations: Record<string, string> = {
    'configuracion.systemStatusOnline': 'En línea',
    'configuracion.systemStatusDegraded': 'Degradado',
    'configuracion.updateStateFailed': 'Fallida',
    'configuracion.updateStageInterrupted': 'Interrumpida',
    'configuracion.systemMonitorAiConnectionFailed': 'No se pudo conectar con el proveedor de IA configurado.',
  }
  const t = (key: string) => translations[key] || key

  assert.equal(systemStatusLabel('ONLINE', t), 'En línea')
  assert.equal(systemStatusLabel('degraded', t), 'Degradado')
  assert.equal(updateStatusLabel('failed', t), 'Fallida')
  assert.equal(updateStageLabel('interrupted', t), 'Interrumpida')
  assert.equal(systemMonitorDetailLabel('No se pudo conectar con el LLM: All connection attempts failed', t), 'No se pudo conectar con el proveedor de IA configurado.')
  assert.equal(updateStageLabel('future_stage', t), 'future_stage')
})
