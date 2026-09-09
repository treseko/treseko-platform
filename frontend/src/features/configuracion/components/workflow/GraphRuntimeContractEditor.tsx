import { useEffect, useMemo, useState } from 'react';
import { fetchAiWorkflowRuntimeManifest } from '../../api/aiWorkflowApi';
import type { FetchWithAuth } from '../../api/configuracionApi';
import { effectiveNodePrompt, nodeTimeoutSeconds } from './workflowRuntimeEditorUtils';
import { useI18n } from '../../../../i18n';

type AnyRecord = Record<string, any>;

type RuntimeAdapter = {
  key: string;
  category?: string;
  atomic?: boolean;
  legacy?: boolean;
  compatible_node_types?: string[];
  capabilities?: string[];
};

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function adapterFor(node: AnyRecord): string {
  return String(
    node.config_json?.runtime_adapter
      ?? node.universal_agent?.contract?.implementation?.native_adapter
      ?? node.universalAgent?.contract?.implementation?.nativeAdapter
      ?? node.runtime_effective?.native_adapter
      ?? '',
  );
}

function compatible(adapter: RuntimeAdapter, node: AnyRecord): boolean {
  const types = adapter.compatible_node_types ?? [];
  if (types.length === 0) return true;
  const type = String(node.type ?? node.agent_key ?? '');
  return types.some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}

function updateNodeContract(node: AnyRecord, patch: AnyRecord): AnyRecord {
  const next = JSON.parse(JSON.stringify(node)) as AnyRecord;
  if (patch.native_adapter !== undefined) {
    const universalKey = next.universal_agent ? 'universal_agent' : next.universalAgent ? 'universalAgent' : 'universal_agent';
    const universal = asRecord(next[universalKey]);
    const contract = asRecord(universal.contract);
    const implementation = asRecord(contract.implementation);
    implementation.native_adapter = patch.native_adapter;
    implementation.nativeAdapter = patch.native_adapter;
    contract.implementation = implementation;
    universal.contract = contract;
    next[universalKey] = universal;
    // Universal agent versions are immutable. The graph-level override is
    // persisted in config_json and becomes part of the workflow snapshot.
    next.config_json = { ...asRecord(next.config_json), runtime_adapter: patch.native_adapter };
  }
  if (patch.prompt_template !== undefined) {
    next.prompt_template = patch.prompt_template;
    next.prompt = patch.prompt_template;
  }
  if (patch.timeout_sec !== undefined) {
    next.timeout_sec = Number(patch.timeout_sec);
    next.config_json = { ...asRecord(next.config_json), timeout_ms: Number(patch.timeout_sec) * 1000 };
  }
  if (patch.max_retries !== undefined) {
    next.retry_policy = { ...asRecord(next.retry_policy), max_attempts: Number(patch.max_retries) + 1 };
    next.max_retries = Number(patch.max_retries);
  }
  if (patch.input_mapping !== undefined) {
    next.input_mapping = patch.input_mapping;
    next.config_json = { ...asRecord(next.config_json), input_mapping: patch.input_mapping };
  }
  if (patch.output_mapping !== undefined) {
    next.output_mapping = patch.output_mapping;
    next.config_json = { ...asRecord(next.config_json), output_mapping: patch.output_mapping };
  }
  if (patch.terminal_ports !== undefined) {
    next.terminal_ports = patch.terminal_ports;
    next.config_json = { ...asRecord(next.config_json), terminal_ports: patch.terminal_ports };
  }
  if (patch.config_json !== undefined) next.config_json = patch.config_json;
  return next;
}

function emitUpdate(props: AnyRecord, original: AnyRecord, updated: AnyRecord): void {
  const nodeId = original.id ?? original.node_id;
  if (typeof props.onUpdateNode === 'function') { props.onUpdateNode(nodeId, updated); return; }
  if (typeof props.updateNode === 'function') { props.updateNode(nodeId, updated); return; }
  if (typeof props.onNodeUpdate === 'function') { props.onNodeUpdate(nodeId, updated); return; }
  if (typeof props.onNodeChange === 'function') { props.onNodeChange(updated); return; }
  if (typeof props.onChange === 'function') { props.onChange(updated); return; }
  // Last-resort integration point for custom hosts. The standard Treseko panel
  // provides one of the callbacks above.
  globalThis.dispatchEvent?.(new CustomEvent('treseko:workflow-node-change', {
    detail: { nodeId: original.id ?? original.node_id, node: updated },
  }));
}

export function GraphRuntimeContractEditor(props: AnyRecord) {
  const { t } = useI18n();
  const node = props.node ?? props.selectedNode ?? props.workflowNode ?? props.activeNode;
  const fetchWithAuth = props.fetchWithAuth as FetchWithAuth | undefined;
  const canEdit = Boolean(props.canEdit);
  const [adapters, setAdapters] = useState<RuntimeAdapter[]>([]);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState('');
  const [configText, setConfigText] = useState('');
  const [inputMappingText, setInputMappingText] = useState('');
  const [outputMappingText, setOutputMappingText] = useState('');
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    if (!node) return;
    setConfigText(JSON.stringify(node.config_json ?? node.config ?? {}, null, 2));
    setInputMappingText(JSON.stringify(node.input_mapping ?? node.config_json?.input_mapping ?? {}, null, 2));
    setOutputMappingText(JSON.stringify(node.output_mapping ?? node.config_json?.output_mapping ?? {}, null, 2));
    setConfigError('');
  }, [node?.id, node?.config_json, node?.input_mapping, node?.output_mapping]);

  useEffect(() => {
    const controller = new AbortController();
    setManifestLoading(true);
    setManifestError('');
    void (async () => {
      if (!fetchWithAuth) {
        setAdapters([]);
        setManifestError(t('configuracion.workflowValidationError'));
        setManifestLoading(false);
        return;
      }
      try {
        const data = await fetchAiWorkflowRuntimeManifest((url, options) => fetchWithAuth(url, { ...options, signal: controller.signal }));
        if (!Array.isArray(data?.adapters)) throw new Error(t('configuracion.workflowPropertiesCatalogBlock'));
        setAdapters(data.adapters);
      } catch (error: any) {
        if (controller.signal.aborted) return;
        setAdapters([]);
        setManifestError(error?.message || t('configuracion.aiWorkflows'));
      } finally {
        if (!controller.signal.aborted) setManifestLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetchWithAuth, t]);

  const available = useMemo(() => {
    if (!node) return [];
    const allowed = props.workflowFormat === 'universal_v3'
      ? adapters.filter((adapter) => adapter.atomic === true)
      : adapters;
    return allowed.filter((adapter) => compatible(adapter, node));
  }, [adapters, node, props.workflowFormat]);

  if (!node) return null;

  const apply = (patch: AnyRecord) => {
    if (!canEdit) return;
    emitUpdate(props, node, updateNodeContract(node, patch));
  };
  const currentAdapter = adapterFor(node);
  const timeout = nodeTimeoutSeconds(node);
  const retryPolicy = asRecord(node.retry_policy ?? node.retryPolicy);
  const maxRetries = Number(node.max_retries ?? Math.max(0, Number(retryPolicy.max_attempts ?? 1) - 1));

  return (
    <section className="workflow-runtime-contract-editor" data-testid="workflow-runtime-contract-editor">
      <header>
        <strong>{t('configuracion.workflowPropertiesContract')}</strong>
        <small>{t('configuracion.workflowPropertiesPortsHint')}</small>
      </header>

      <label>
        {t('configuracion.workflowPropertiesNativeImplementation')}
        <select
          value={currentAdapter}
          onChange={(event) => apply({ native_adapter: event.target.value })}
          disabled={!canEdit || manifestLoading || Boolean(manifestError)}
          data-testid="workflow-native-adapter"
        >
          {!currentAdapter && <option value="">{manifestLoading ? t('configuracion.aiEngineChecking') : t('configuracion.workflowPropertiesSelect')}</option>}
          {currentAdapter && !available.some(adapter => adapter.key === currentAdapter) && <option value={currentAdapter}>{currentAdapter}</option>}
          {available.map((adapter) => (
            <option key={adapter.key} value={adapter.key}>
              {adapter.key}{adapter.atomic === false ? ' (compatibilidad)' : ''}
            </option>
          ))}
        </select>
        {manifestError && <small role="alert">{t('configuracion.workflowPropertiesCatalogBlock')}: {manifestError}</small>}
      </label>

      <label>
        {t('configuracion.workflowPropertiesPromptTemplate')}
        <textarea
          value={effectiveNodePrompt(node)}
          rows={10}
          disabled={!canEdit}
          onChange={(event) => apply({ prompt_template: event.target.value })}
          data-testid="workflow-node-prompt"
        />
      </label>

      <div className="workflow-runtime-contract-editor__row">
        <label>
          {t('configuracion.workflowPropertiesTimeout')}
          <input
            type="number"
            min={1}
            max={120}
            value={timeout}
            disabled={!canEdit}
            onChange={(event) => apply({ timeout_sec: Number(event.target.value) })}
            data-testid="workflow-node-timeout"
          />
        </label>
        <label>
          {t('configuracion.workflowPropertiesRetries')}
          <input
            type="number"
            min={0}
            max={10}
            value={maxRetries}
            disabled={!canEdit}
            onChange={(event) => apply({ max_retries: Number(event.target.value) })}
          />
        </label>
      </div>

      <label>
        {t('configuracion.workflowPropertiesConfigJson')}
        <textarea
          value={configText}
          rows={8}
          disabled={!canEdit}
          onChange={(event) => {
            const value = event.target.value;
            setConfigText(value);
            try {
              const parsed = JSON.parse(value);
              setConfigError('');
              apply({ config_json: parsed });
            } catch {
              setConfigError(t('configuracion.workflowPropertiesConfigJsonInvalid'));
            }
          }}
          aria-invalid={Boolean(configError)}
          data-testid="workflow-node-config-json"
        />
        {configError && <small role="alert">{configError}</small>}
      </label>

      <label>
        {t('configuracion.workflowPropertiesInputMappingJson')}
        <textarea
          rows={5}
          value={inputMappingText}
          disabled={!canEdit}
          onChange={(event) => setInputMappingText(event.target.value)}
          onBlur={(event) => {
            try { apply({ input_mapping: JSON.parse(event.target.value || '{}') }); setConfigError(''); }
            catch { setConfigError(t('configuracion.workflowPropertiesInputMappingJsonInvalid')); }
          }}
          data-testid="workflow-node-input-mapping"
        />
      </label>

      <label>
        {t('configuracion.workflowPropertiesOutputMappingJson')}
        <textarea
          rows={5}
          value={outputMappingText}
          disabled={!canEdit}
          onChange={(event) => setOutputMappingText(event.target.value)}
          onBlur={(event) => {
            try { apply({ output_mapping: JSON.parse(event.target.value || '{}') }); setConfigError(''); }
            catch { setConfigError(t('configuracion.workflowPropertiesOutputMappingJsonInvalid')); }
          }}
          data-testid="workflow-node-output-mapping"
        />
      </label>

      <label>
        {t('configuracion.workflowPropertiesOutputPort')}
        <input
          type="text"
          value={(node.terminal_ports ?? node.config_json?.terminal_ports ?? []).join(', ')}
          disabled={!canEdit}
          placeholder="reported, failed"
          onChange={(event) => apply({ terminal_ports: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
          data-testid="workflow-node-terminal-ports"
        />
      </label>

      <p className="workflow-runtime-contract-editor__notice">
        {t('configuracion.workflowPropertiesSecurityHint')}
      </p>
    </section>
  );
}
