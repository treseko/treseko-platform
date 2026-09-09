import type { JsonObject, JsonValue, WorkflowStatePatch } from './contracts.ts';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_INPUT_ROOTS = new Set(['input', 'execution', 'context', 'state', 'result', 'node']);
const ALLOWED_STATE_ROOTS = new Set(['context', 'browser', 'plan', 'security', 'action', 'validation', 'recovery', 'audit', 'report', 'control']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitPath(path: string): string[] {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => FORBIDDEN.has(part))) {
    throw new Error(`Unsafe or empty mapping path: ${path}`);
  }
  return parts;
}

export function readMappedValue(root: unknown, path: string): unknown {
  const parts = splitPath(path);
  if (!ALLOWED_INPUT_ROOTS.has(parts[0])) throw new Error(`Mapping root is not allowed: ${parts[0]}`);
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export interface MappingReference {
  readonly from: string;
  readonly default?: JsonValue;
  readonly required?: boolean;
}

function isMappingReference(value: unknown): value is MappingReference {
  return isRecord(value) && typeof value.from === 'string';
}

export function applyInputMapping(
  mapping: Readonly<Record<string, unknown>>,
  source: Readonly<Record<string, unknown>>,
): JsonObject {
  const output: JsonObject = {};
  for (const [target, specification] of Object.entries(mapping)) {
    if (FORBIDDEN.has(target)) throw new Error(`Unsafe input target: ${target}`);
    let value: unknown;
    let required = false;
    if (typeof specification === 'string') {
      value = readMappedValue(source, specification);
    } else if (isMappingReference(specification)) {
      value = readMappedValue(source, specification.from);
      if (value === undefined) value = specification.default;
      required = specification.required === true;
    } else {
      value = specification;
    }
    if (value === undefined && required) throw new Error(`Required mapped input is missing: ${target}`);
    if (value !== undefined) output[target] = value as JsonValue;
  }
  return output;
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function ensureStatePath(path: string): string[] {
  const parts = splitPath(path);
  if (!ALLOWED_STATE_ROOTS.has(parts[0])) throw new Error(`State patch root is not allowed: ${parts[0]}`);
  return parts;
}

export function applyStatePatches(initial: JsonObject, patches: readonly WorkflowStatePatch[]): JsonObject {
  const state = cloneJson(initial);
  for (const patch of patches) {
    const parts = ensureStatePath(patch.path);
    let parent: Record<string, JsonValue> = state;
    for (const part of parts.slice(0, -1)) {
      const existing = parent[part];
      if (existing === undefined) parent[part] = {};
      if (!isRecord(parent[part])) throw new Error(`Cannot patch through non-object path: ${patch.path}`);
      parent = parent[part] as Record<string, JsonValue>;
    }
    const key = parts[parts.length - 1];
    switch (patch.op) {
      case 'set': parent[key] = cloneJson(patch.value ?? null); break;
      case 'remove': delete parent[key]; break;
      case 'append': {
        const current = parent[key];
        if (current === undefined) parent[key] = [];
        if (!Array.isArray(parent[key])) throw new Error(`append target is not an array: ${patch.path}`);
        (parent[key] as JsonValue[]).push(cloneJson(patch.value ?? null));
        break;
      }
      case 'increment': {
        const current = parent[key] ?? 0;
        const amount = patch.value ?? 1;
        if (typeof current !== 'number' || typeof amount !== 'number') {
          throw new Error(`increment requires numeric values: ${patch.path}`);
        }
        parent[key] = current + amount;
        break;
      }
    }
  }
  return state;
}
