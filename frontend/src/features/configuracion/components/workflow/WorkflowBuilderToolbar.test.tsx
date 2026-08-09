import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORKFLOW_PORTABLE_EXPORT_LABEL,
  WORKFLOW_PORTABLE_IMPORT_LABEL,
  canExportPortableWorkflow,
} from './workflowBuilderUtils'

test('ofrece únicamente importación y exportación portable', () => {
  assert.equal(WORKFLOW_PORTABLE_EXPORT_LABEL, 'Exportar workflow portable')
  assert.equal(WORKFLOW_PORTABLE_IMPORT_LABEL, 'Importar workflow portable')
  assert.doesNotMatch(`${WORKFLOW_PORTABLE_EXPORT_LABEL} ${WORKFLOW_PORTABLE_IMPORT_LABEL}`, /JSON|paquete universal/)
})

test('deshabilita la exportación portable para formatos no universales', () => {
  assert.equal(canExportPortableWorkflow({ workflow_format: 'universal_v2' } as any), true)
  assert.equal(canExportPortableWorkflow({ workflow_format: 'legacy_v1' } as any), false)
  assert.equal(canExportPortableWorkflow(null), false)
})
