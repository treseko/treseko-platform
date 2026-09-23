import assert from 'node:assert/strict'
import test from 'node:test'
import { mapBackendCasoToTest } from './caseUtils'
import { compareTestsBySuiteOrder } from '../../testOrdering'

 test('el mapper real conserva orden persistente para árbol y revisiones', () => {
  const mapped = mapBackendCasoToTest({
    id: 'case-1',
    proyecto_id: 'project-1',
    master_id: 'master-1',
    suite_id: 'suite-1',
    orden: 7,
    titulo: 'Case',
  })

  assert.equal(mapped.orden, 7)
  assert.equal(mapped.order, 7)
  assert.equal(mapped.position, 7)
  assert.equal(compareTestsBySuiteOrder(mapped, { ...mapped, id: 'case-2', orden: 8 }) < 0, true)
})
