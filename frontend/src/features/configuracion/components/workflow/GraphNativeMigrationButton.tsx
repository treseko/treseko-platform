type AnyRecord = Record<string, any>;
import { useI18n } from '../../../../i18n';

const GRAPH_NATIVE_ADAPTER_BY_TYPE: Readonly<Record<string, string>> = Object.freeze({
  ContextResolver: 'qa-context-resolver/v2',
  PreExecutionAnalyst: 'qa-pre-execution-analyst/v2',
  Observer: 'qa-browser-observer/v2',
  Planner: 'qa-action-planner/v2',
  SecurityGuard: 'qa-security-guard/v2',
  Executor: 'qa-browser-action-executor/v2',
  Validator: 'qa-step-validator/v2',
  Recovery: 'qa-recovery-strategist/v2',
  Auditor: 'qa-final-auditor/v2',
  Reporter: 'qa-execution-reporter/v2',
});

function migrateNode(node: AnyRecord): AnyRecord {
  const adapter = GRAPH_NATIVE_ADAPTER_BY_TYPE[String(node.type ?? node.agent_key ?? '')];
  if (!adapter) return node;
  const next = JSON.parse(JSON.stringify(node)) as AnyRecord;
  const universalKey = next.universal_agent ? 'universal_agent' : next.universalAgent ? 'universalAgent' : 'universal_agent';
  const universal = { ...(next[universalKey] ?? {}) };
  const contract = { ...(universal.contract ?? {}) };
  contract.implementation = {
    ...(contract.implementation ?? {}),
    native_adapter: adapter,
    nativeAdapter: adapter,
    version: '2',
  };
  universal.contract = contract;
  next[universalKey] = universal;
  return next;
}

function migrateValue(value: any): any {
  if (Array.isArray(value)) return value.map(migrateValue);
  if (!value || typeof value !== 'object') return value;
  let current = value;
  if (typeof value.type === 'string' && GRAPH_NATIVE_ADAPTER_BY_TYPE[value.type]) {
    current = migrateNode(value);
  } else {
    current = { ...value };
  }
  for (const [key, nested] of Object.entries(current)) {
    if (key === 'universal_agent' || key === 'universalAgent') continue;
    current[key] = migrateValue(nested);
  }
  return current;
}

function publishChange(props: AnyRecord, original: any, migrated: any): boolean {
  const callbacks = [
    props.onWorkflowChange,
    props.onChange,
    props.onUpdateWorkflow,
    props.updateWorkflow,
    props.onDefinitionChange,
  ];
  const callback = callbacks.find((value) => typeof value === 'function');
  if (callback) {
    if (callback.length >= 2) callback(original?.id ?? original?.workflow_id, migrated);
    else callback(migrated);
    return true;
  }
  const nodesCallback = props.onNodesChange ?? props.setNodes;
  const nodes = migrated?.nodes ?? migrated?.definition_json?.nodes ?? migrated?.graph?.nodes;
  if (typeof nodesCallback === 'function' && Array.isArray(nodes)) {
    nodesCallback(nodes);
    const metadataCallback = props.onRuntimeModeChange;
    if (typeof metadataCallback === 'function') metadataCallback('graph_native');
    return true;
  }
  return false;
}

export function GraphNativeMigrationButton(props: AnyRecord) {
  const { t } = useI18n();
  const workflow = props.workflow ?? props.definition ?? props.workflowDefinition ?? props.value;
  const hasWorkflow = Boolean(workflow) || Array.isArray(props.nodes);
  if (!hasWorkflow) return null;

  const migrate = () => {
    const source = workflow ?? { nodes: props.nodes, edges: props.edges };
    if (!globalThis.confirm?.(t('configuracion.workflowUniversalCreated'))) return;
    const migrated = migrateValue(source);
    if (migrated && typeof migrated === 'object') {
      migrated.runtime_mode = 'graph_native';
      migrated.decision_policy_json = {
        ...(migrated.decision_policy_json ?? {}),
        runtime_mode: 'graph_native',
        source_of_truth: 'persisted_graph',
        legacy_step_runner_allowed: false,
      };
      migrated.metadata = {
        ...(migrated.metadata ?? {}),
        runtime_mode: 'graph_native',
        source_of_truth: 'persisted_graph',
        legacy_step_runner_allowed: false,
      };
    }
    const handled = publishChange(props, source, migrated);
    if (!handled) {
      globalThis.dispatchEvent?.(new CustomEvent('treseko:workflow-definition-change', {
        detail: { workflow: migrated },
      }));
    }
  };

  return (
    <button
      type="button"
      onClick={migrate}
      className="workflow-builder__graph-native-button"
      data-testid="workflow-migrate-graph-native"
      title={t('configuracion.workflowUniversalTitle')}
    >
      {t('configuracion.workflowUniversalTitle')}
    </button>
  );
}
