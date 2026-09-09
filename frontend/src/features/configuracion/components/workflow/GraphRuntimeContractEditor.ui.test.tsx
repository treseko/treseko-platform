// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphRuntimeContractEditor } from './GraphRuntimeContractEditor'
import { WorkflowPropertiesPanel } from './WorkflowPropertiesPanel'
import { I18nProvider } from '../../../../i18n'

afterEach(cleanup)

const node = {
  id: 'node-1',
  type: 'Planner',
  timeout_sec: 42,
  config_json: { input_mapping: { case: 'context.case' } },
  universal_agent: {
    version_id: 'planner-version-1',
    version: '1.0.0',
    contract: {
      instructions: { user_instructions: 'Planificá una sola acción segura.' },
      implementation: { native_adapter: 'qa-action-planner/v2' },
    },
  },
}

describe('GraphRuntimeContractEditor Universal V3', () => {
  it('solo aparece dentro de un workflow Universal V3', () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({ adapters: [] }), { status: 200 }))
    const workflowNode = { ...node, name: 'Planner', agent_key: 'planner', enabled: true }
    const commonProps = {
      selectedWorkflowElement: { type: 'node' as const, id: node.id },
      selectedWorkflowNode: workflowNode,
      selectedWorkflowEdge: null,
      canEditAi: false,
      workflowPropertiesTab: 'general',
      setWorkflowPropertiesTab: vi.fn(),
      updateWorkflowNode: vi.fn(),
      updateWorkflowNodeConfig: vi.fn(),
      agentDefinitions: [],
      workflowNodes: [workflowNode],
      updateWorkflowEdge: vi.fn(),
      workflowJsonError: '',
      setWorkflowJsonError: vi.fn(),
      closeWorkflowProperties: vi.fn(),
      fetchWithAuth,
    }
    const { rerender } = render(<I18nProvider><WorkflowPropertiesPanel {...commonProps} workflowFormat="universal_v2" /></I18nProvider>)
    expect(screen.queryByTestId('workflow-runtime-contract-editor')).toBeNull()
    rerender(<I18nProvider><WorkflowPropertiesPanel {...commonProps} workflowFormat="universal_v3" /></I18nProvider>)
    expect(screen.getByTestId('workflow-runtime-contract-editor')).toBeTruthy()
  })

  it('usa el manifiesto autenticado y muestra los valores efectivos en modo lectura', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      adapters: [{ key: 'qa-action-planner/v2', atomic: true, compatible_node_types: ['Planner'] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<I18nProvider><GraphRuntimeContractEditor node={node} workflowFormat="universal_v3" fetchWithAuth={fetchWithAuth} canEdit={false} /></I18nProvider>)

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith('/api/workflow-runtime-manifest', expect.any(Object)))
    expect(screen.getByDisplayValue('Planificá una sola acción segura.')).toBeDisabled()
    expect(screen.getByTestId('workflow-node-timeout')).toHaveValue(42)
    expect(screen.queryByTestId('workflow-node-model')).toBeNull()
    expect(screen.getByTestId('workflow-native-adapter')).toBeDisabled()
  })

  it('muestra el override atomico persistido en vez del adapter legacy del contrato', async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      adapters: [{ key: 'qa-action-planner/v2', atomic: true, compatible_node_types: ['Planner'] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const migratedNode = {
      ...node,
      config_json: { ...node.config_json, runtime_adapter: 'qa-action-planner/v2' },
      universal_agent: {
        ...node.universal_agent,
        contract: {
          ...node.universal_agent.contract,
          implementation: { native_adapter: 'legacy-planner/v1' },
        },
      },
    }

    render(<I18nProvider><GraphRuntimeContractEditor node={migratedNode} workflowFormat="universal_v3" fetchWithAuth={fetchWithAuth} canEdit={false} /></I18nProvider>)

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled())
    expect(screen.getByTestId('workflow-native-adapter')).toHaveValue('qa-action-planner/v2')
  })

  it('no ofrece adapters fallback cuando el manifiesto autenticado responde 401', async () => {
    const fetchWithAuth = vi.fn().mockImplementation(async () => new Response('Unauthorized', { status: 401 }))
    render(<I18nProvider><GraphRuntimeContractEditor node={{
      ...node,
      universal_agent: {
        version_id: 'planner-version-2',
        version: '1.0.1',
        contract: { instructions: {} },
      },
    }} workflowFormat="universal_v3" fetchWithAuth={fetchWithAuth} canEdit /></I18nProvider>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.queryByRole('option', { name: 'qa-action-planner/v2' })).toBeNull()
  })

  it('actualiza los mappings controlados cuando cambia el nodo seleccionado', () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({ adapters: [] }), { status: 200 }))
    const { rerender } = render(<I18nProvider><GraphRuntimeContractEditor node={node} workflowFormat="universal_v3" fetchWithAuth={fetchWithAuth} canEdit /></I18nProvider>)
    expect(screen.getByTestId('workflow-node-input-mapping')).toHaveValue('{\n  "case": "context.case"\n}')

    rerender(<I18nProvider><GraphRuntimeContractEditor node={{ ...node, id: 'node-2', config_json: { input_mapping: { run: 'context.run' } } }} workflowFormat="universal_v3" fetchWithAuth={fetchWithAuth} canEdit /></I18nProvider>)
    expect(screen.getByTestId('workflow-node-input-mapping')).toHaveValue('{\n  "run": "context.run"\n}')
  })
})
