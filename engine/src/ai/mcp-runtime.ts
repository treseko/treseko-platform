import { readBoundedBody } from './mcp-tool-agent.ts';
import type { McpRuntimeServices } from './mcp-tool-agent.ts';
import fs from 'node:fs';
import { isForbiddenAddress, resolveSafeAddress, createPinnedFetch } from './mcp-secure-transport.ts';

const DEFAULT_TIMEOUT_MS = 5_000;
function trustedPrivateResolver(url: URL): boolean {
  return String(process.env.MCP_RUNTIME_RESOLVER_TRUSTED_PRIVATE_ORIGINS || '').split(',').map(value => value.trim()).includes(url.origin);
}

function allowInsecureResolverTransport(): boolean {
  return String(process.env.MCP_RUNTIME_RESOLVER_ALLOW_INSECURE_HTTP || '').trim().toLowerCase() === 'true';
}

function internalToken(): string {
  const direct = String(process.env.AI_ENGINE_INTERNAL_TOKEN || '').trim();
  if (direct) return direct;
  const tokenFile = String(process.env.AI_ENGINE_INTERNAL_TOKEN_FILE || '').trim();
  if (!tokenFile) return '';
  try { return fs.readFileSync(tokenFile, 'utf8').trim(); } catch { return ''; }
}

function configuredResolver(): URL | undefined {
  try {
    const url = new URL(String(process.env.MCP_RUNTIME_RESOLVER_URL || '').trim());
    const origins = String(process.env.MCP_RUNTIME_RESOLVER_ALLOWED_ORIGINS || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    const allowInsecureHttp = allowInsecureResolverTransport();
    if ((url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) || url.username || url.password || (isForbiddenAddress(url.hostname) && !trustedPrivateResolver(url))) return undefined;
    if (!origins.includes(url.origin)) return undefined;
    const configured = origins.map((value) => new URL(value));
    if (configured.some((origin) => (origin.protocol !== 'https:' && !(allowInsecureHttp && origin.protocol === 'http:')) || origin.username || origin.password || (isForbiddenAddress(origin.hostname) && !trustedPrivateResolver(origin)))) return undefined;
    if (url.search || url.hash) return undefined;
    return url;
  } catch { return undefined; }
}

/** Build the engine-side vault boundary. Secrets never enter workflow state. */
export function createMcpRuntimeServices(overrides: Pick<McpRuntimeServices, 'resolveHost' | 'fetchImpl'> = {}): McpRuntimeServices | undefined {
  const resolverUrl = configuredResolver();
  const token = internalToken();
  if (!resolverUrl || !token) return undefined;

  return {
    resolveCredential: async (reference: string) => {
      if (!/^vault:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(reference)) return undefined;
      const resolvedAddress = await resolveSafeAddress(resolverUrl, overrides.resolveHost, trustedPrivateResolver(resolverUrl));
      if (!resolvedAddress) return undefined;
      const pinnedUrl = new URL(resolverUrl.toString());
      pinnedUrl.hostname = resolvedAddress;
      const resolverFetch = createPinnedFetch(overrides.fetchImpl || fetch, pinnedUrl, resolverUrl.host, { allowInsecureHttp: allowInsecureResolverTransport(), trustedPrivate: trustedPrivateResolver(resolverUrl), pinNetwork: !overrides.fetchImpl });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await resolverFetch(pinnedUrl, {
          method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-engine-internal-token': token },
          body: JSON.stringify({ reference }), signal: controller.signal,
        });
        if (response.url && new URL(response.url).origin !== pinnedUrl.origin) return undefined;
        if (!response.ok) return undefined;
        const body = JSON.parse(await readBoundedBody(response)) as { secret?: unknown };
        return typeof body.secret === 'string' ? body.secret : undefined;
      } catch { return undefined; } finally { clearTimeout(timer); }
    },
    trace: () => undefined,
  };
}
