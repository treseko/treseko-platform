import type { JsonValue, WorkflowNodeResult } from './contracts.ts';

export interface EdgeEvaluationContext {
  readonly result: WorkflowNodeResult;
  readonly state: Readonly<Record<string, unknown>>;
  readonly retry_count: number;
  readonly pass_count: number;
  readonly confidence?: number;
}

export type ConditionExpression =
  | { readonly op: 'always' }
  | { readonly op: 'all'; readonly conditions: readonly ConditionExpression[] }
  | { readonly op: 'any'; readonly conditions: readonly ConditionExpression[] }
  | { readonly op: 'not'; readonly condition: ConditionExpression }
  | { readonly op: 'status_is'; readonly value: string }
  | { readonly op: 'output_port_is'; readonly value: string }
  | { readonly op: 'reason_code_is'; readonly value: string }
  | { readonly op: 'confidence_gte'; readonly value: number }
  | { readonly op: 'retry_count_lt'; readonly value: number }
  | { readonly op: 'pass_count_lt'; readonly value: number }
  | { readonly op: 'value_equals'; readonly path: string; readonly value: JsonValue };

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) return undefined;
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

export function normalizeCondition(raw: unknown): ConditionExpression {
  if (raw === undefined || raw === null) return { op: 'always' };
  if (!isRecord(raw)) throw new Error('Condition must be an object');

  if (typeof raw.op === 'string') {
    switch (raw.op) {
      case 'always': return { op: 'always' };
      case 'all':
        if (!Array.isArray(raw.conditions)) throw new Error('all.conditions must be an array');
        return { op: 'all', conditions: raw.conditions.map(normalizeCondition) };
      case 'any':
        if (!Array.isArray(raw.conditions)) throw new Error('any.conditions must be an array');
        return { op: 'any', conditions: raw.conditions.map(normalizeCondition) };
      case 'not': return { op: 'not', condition: normalizeCondition(raw.condition) };
      case 'status_is': return { op: 'status_is', value: asString(raw.value, 'status_is.value') };
      case 'output_port_is': return { op: 'output_port_is', value: asString(raw.value, 'output_port_is.value') };
      case 'reason_code_is': return { op: 'reason_code_is', value: asString(raw.value, 'reason_code_is.value') };
      case 'confidence_gte': return { op: 'confidence_gte', value: asNumber(raw.value, 'confidence_gte.value') };
      case 'retry_count_lt': return { op: 'retry_count_lt', value: asNumber(raw.value, 'retry_count_lt.value') };
      case 'pass_count_lt': return { op: 'pass_count_lt', value: asNumber(raw.value, 'pass_count_lt.value') };
      case 'value_equals':
        return {
          op: 'value_equals',
          path: asString(raw.path, 'value_equals.path'),
          value: raw.value as JsonValue,
        };
      default: throw new Error(`Unsupported condition operator: ${raw.op}`);
    }
  }

  // Compatibility normalization for the condition_json shape already persisted by Treseko.
  const conditions: ConditionExpression[] = [];
  const status = raw.status_is ?? raw.status;
  const outputPort = raw.output_port_is ?? raw.output_port;
  const reasonCode = raw.reason_code_is ?? raw.reason_code ?? raw.reason;
  const confidence = raw.confidence_gte ?? raw.min_confidence;
  const retryCount = raw.retry_count_lt ?? raw.max_retry_count;
  const passCount = raw.pass_count_lt ?? raw.max_passes;
  if (status !== undefined) conditions.push({ op: 'status_is', value: asString(status, 'status') });
  if (outputPort !== undefined) conditions.push({ op: 'output_port_is', value: asString(outputPort, 'output_port') });
  if (reasonCode !== undefined) conditions.push({ op: 'reason_code_is', value: asString(reasonCode, 'reason_code') });
  if (confidence !== undefined) conditions.push({ op: 'confidence_gte', value: asNumber(confidence, 'confidence') });
  if (retryCount !== undefined) conditions.push({ op: 'retry_count_lt', value: asNumber(retryCount, 'retry_count') });
  if (passCount !== undefined) conditions.push({ op: 'pass_count_lt', value: asNumber(passCount, 'pass_count') });
  if (raw.all !== undefined) {
    if (!Array.isArray(raw.all)) throw new Error('all must be an array');
    conditions.push({ op: 'all', conditions: raw.all.map(normalizeCondition) });
  }
  if (raw.any !== undefined) {
    if (!Array.isArray(raw.any)) throw new Error('any must be an array');
    conditions.push({ op: 'any', conditions: raw.any.map(normalizeCondition) });
  }
  if (raw.not !== undefined) conditions.push({ op: 'not', condition: normalizeCondition(raw.not) });
  if (conditions.length === 0) return { op: 'always' };
  if (conditions.length === 1) return conditions[0];
  return { op: 'all', conditions };
}

export function evaluateCondition(condition: ConditionExpression, context: EdgeEvaluationContext): boolean {
  switch (condition.op) {
    case 'always': return true;
    case 'all': return condition.conditions.every((item) => evaluateCondition(item, context));
    case 'any': return condition.conditions.some((item) => evaluateCondition(item, context));
    case 'not': return !evaluateCondition(condition.condition, context);
    case 'status_is': return context.result.status === condition.value;
    case 'output_port_is': return context.result.output_port === condition.value;
    case 'reason_code_is': return context.result.reason_code === condition.value;
    case 'confidence_gte': return (context.confidence ?? Number.NEGATIVE_INFINITY) >= condition.value;
    case 'retry_count_lt': return context.retry_count < condition.value;
    case 'pass_count_lt': return context.pass_count < condition.value;
    case 'value_equals': {
      const root = { result: context.result, state: context.state };
      return Object.is(readPath(root, condition.path), condition.value);
    }
  }
}

export interface SelectableEdge {
  readonly id: string;
  readonly priority: number;
  readonly condition: ConditionExpression;
}

export function selectDeterministicEdge<T extends SelectableEdge>(
  edges: readonly T[],
  context: EdgeEvaluationContext,
): T | undefined {
  const matches = edges.filter((edge) => evaluateCondition(edge.condition, context));
  if (matches.length === 0) return undefined;
  // Treseko historically evaluates the lowest numeric priority first.
  const ordered = [...matches].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const first = ordered[0];
  const tied = ordered.filter((edge) => edge.priority === first.priority);
  if (tied.length > 1) {
    throw new Error(`AMBIGUOUS_EDGE_MATCH: ${tied.map((edge) => edge.id).join(', ')}`);
  }
  return first;
}
