import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORKFLOW_PORTABLE_EXPORT_LABEL,
  WORKFLOW_PORTABLE_IMPORT_LABEL,
  canExportPortableWorkflow,
} from './workflowBuilderUtils'
import type { AiWorkflow } from '../../types/configuracion'
import { activeWorkflowsForPurpose, chooseWorkflowForEditor } from '../../workflowSelection'
import { canEditWorkflowDraft, resolveWorkflowActionPermissions } from '../../workflowPermissions'
import { controlInputPorts, controlOutputPorts, effectiveNodePrompt, nodeTimeoutSeconds } from './workflowRuntimeEditorUtils'

test('ofrece únicamente importación y exportación portable', () => {
  assert.equal(WORKFLOW_PORTABLE_EXPORT_LABEL, 'Exportar workflow portable')
  assert.equal(WORKFLOW_PORTABLE_IMPORT_LABEL, 'Importar workflow portable')
  assert.doesNotMatch(`${WORKFLOW_PORTABLE_EXPORT_LABEL} ${WORKFLOW_PORTABLE_IMPORT_LABEL}`, /JSON|paquete universal/)
})

test('deshabilita la exportación portable para formatos no universales', () => {
  assert.equal(canExportPortableWorkflow({ workflow_format: 'universal_v2' } as any), true)
  assert.equal(canExportPortableWorkflow({ workflow_format: 'universal_v3' } as any), true)
  assert.equal(canExportPortableWorkflow({ workflow_format: 'legacy_v1' } as any), false)
  assert.equal(canExportPortableWorkflow(null), false)
})

const active = { id: 'active', status: 'ACTIVE', workflow_purpose: 'test_execution' } as AiWorkflow
const draftV3 = { id: 'draft-v3', status: 'DRAFT', workflow_format: 'universal_v3', workflow_purpose: 'test_execution' } as AiWorkflow

test('restaura el borrador elegido sin agregarlo al selector operativo ACTIVE', () => {
  const workflows = [active, draftV3]
  assert.equal(chooseWorkflowForEditor(workflows, 'draft-v3', 'active')?.id, 'draft-v3')
  assert.deepEqual(activeWorkflowsForPurpose(workflows, 'test_execution').map(workflow => workflow.id), ['active'])
  assert.equal(chooseWorkflowForEditor([active], 'missing-draft', 'active')?.id, 'active')
})

test('resuelve acciones con los mismos capabilities granulares del backend', () => {
  const granted = new Set(['motor_ia.workflow_view', 'motor_ia.workflow_drafts', 'motor_ia.workflow_execute'])
  const permissions = resolveWorkflowActionPermissions(capability => granted.has(capability))
  assert.deepEqual(permissions, { view: true, drafts: true, publish: false, activate: false, archive: false, execute: true })
  assert.equal(canEditWorkflowDraft('DRAFT', permissions), true)
  assert.equal(canEditWorkflowDraft('ACTIVE', permissions), false)
})

test('calcula prompt, timeout y puertos efectivos desde contrato y overrides', () => {
  const node = {
    timeout_sec: 47,
    input_ports: ['custom-input'],
    output_ports: [{ id: 'custom-output' }],
    config_json: { input_ports: ['config-input'], output_ports: ['config-output'] },
    universal_agent: { contract: { instructions: { user_instructions: 'Prompt contractual real' }, ports: { control_inputs: ['input'], control_outputs: ['success'] } } },
  }
  assert.equal(effectiveNodePrompt(node), 'Prompt contractual real')
  assert.equal(effectiveNodePrompt({ ...node, prompt_template: 'Override del nodo' }), 'Override del nodo')
  assert.equal(nodeTimeoutSeconds(node), 47)
  assert.deepEqual(controlInputPorts(node), ['input', 'custom-input', 'config-input'])
  assert.deepEqual(controlOutputPorts(node), ['success', 'custom-output', 'config-output'])
  assert.deepEqual(controlInputPorts(node, true), ['input'])
  assert.deepEqual(controlOutputPorts(node, true), ['success'])
})
