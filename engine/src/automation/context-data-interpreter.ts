export type ResolvedInput = {
  role: string;
  value: string;
  source: string;
  targetHints: string[];
  confidence: number;
  masked?: boolean;
};

export type ResolvedAssertion = {
  type: string;
  expected: string;
  source: string;
  confidence: number;
};

export type ResolvedStepContext = {
  rawData: string;
  normalizedData: string;
  inputs: ResolvedInput[];
  assertions: ResolvedAssertion[];
  ambiguities: string[];
  unresolved: string[];
};

const ROLE_ALIASES: Record<string, string[]> = {
  username: ['username', 'user', 'usuario', 'usuaria', 'login', 'nombre de usuario'],
  email: ['email', 'e-mail', 'correo', 'correo electronico', 'mail'],
  password: ['password', 'pass', 'clave', 'contrasena', 'contraseña'],
  search: ['search', 'buscar', 'busqueda', 'término', 'termino', 'query'],
  url: ['url', 'uri', 'direccion', 'dirección', 'base_url', 'base url'],
};

const normalizeKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const canonicalRole = (key: string) => {
  const normalized = normalizeKey(key);
  return Object.entries(ROLE_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || normalized;
};

const isSecretRole = (role: string) => role === 'password' || role === 'token' || role === 'secret';

const parsePairs = (data: string) => {
  const pairs: Array<{ key: string; value: string }> = [];
  const matcher = /([\p{L}][\p{L}\d _-]{1,40})\s*[:=]\s*([^,;|\n]+?)(?=\s+[\p{L}][\p{L}\d _-]{1,40}\s*[:=]|[,;|\n]|$)/giu;
  for (const match of data.matchAll(matcher)) {
    const key = String(match[1] || '').trim();
    const value = String(match[2] || '').trim();
    if (key && value) pairs.push({ key, value });
  }
  return pairs;
};

const parseJson = (data: string) => {
  try {
    const value = JSON.parse(data);
    if (!value || Array.isArray(value) || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, raw]) => {
      const value = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '';
      return value ? [{ key, value }] : [];
    });
  } catch {
    return [];
  }
};

const redact = (value: string, role: string) => isSecretRole(role) ? '********' : value;

export function interpretStepData(
  data: unknown,
  context: Record<string, any> = {},
  source = 'step.data',
): ResolvedStepContext {
  const rawData = String(data ?? '').trim();
  const pairs = parseJson(rawData).concat(parsePairs(rawData));
  const inputs: ResolvedInput[] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const role = canonicalRole(pair.key);
    const identity = `${role}:${pair.value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    inputs.push({ role, value: pair.value, source, targetHints: ROLE_ALIASES[role] || [role], confidence: 100, masked: isSecretRole(role) });
  }

  const contextValues = [
    ['case.data', context.datos_caso],
    ['dataset', context.dataset],
    ['environment', context.environment],
    ['variables', context.variables],
  ];
  for (const [contextSource, value] of contextValues) {
    if (!value || typeof value !== 'object') continue;
    const entries = Object.entries(value);
    for (const [key, raw] of entries) {
      if (raw === null || raw === undefined || typeof raw === 'object') continue;
      const role = canonicalRole(key);
      if (inputs.some((item) => item.role === role)) continue;
      const text = String(raw).trim();
      if (!text) continue;
      inputs.push({ role, value: text, source: contextSource, targetHints: ROLE_ALIASES[role] || [role], confidence: 90, masked: isSecretRole(role) });
    }
  }

  const normalizedData = inputs.map((item) => `${item.role}=${item.value}`).join('; ');
  const ambiguities: string[] = [];
  if (rawData && !pairs.length && !inputs.length) ambiguities.push('No se pudo identificar una clave y un valor en los datos del paso.');

  return { rawData, normalizedData, inputs, assertions: [], ambiguities, unresolved: [] };
}

export function valueForRole(resolved: ResolvedStepContext, roles: string[]) {
  const wanted = new Set(roles.map(canonicalRole));
  return resolved.inputs.find((item) => wanted.has(item.role))?.value;
}

export function displayResolvedInput(input: ResolvedInput) {
  return `${input.role}: ${redact(input.value, input.role)}`;
}
