import { isIP } from 'node:net';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

export type HostResolver = (hostname: string) => Promise<string[]>;

export interface SecureFetchServices {
  resolveHost?: HostResolver;
  fetchImpl?: typeof fetch;
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

function ipv6ToBigInt(address: string): bigint | undefined {
  const mapped = address.toLowerCase();
  const dotted = mapped.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  const normalized = dotted
    ? `${mapped.slice(0, mapped.lastIndexOf(':'))}:${((Number(dotted[1]) << 8) | Number(dotted[2])).toString(16)}:${((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16)}`
    : mapped;
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function inCidr(address: bigint, network: bigint, bits: number): boolean {
  const shift = 128n - BigInt(bits);
  return (address >> shift) === (network >> shift);
}

function v6(network: string, bits: number): [bigint, number] {
  return [ipv6ToBigInt(network)!, bits];
}

const FORBIDDEN_V6 = [
  v6('::', 128), v6('::1', 128), v6('::', 96), // unspecified, loopback, IPv4-compatible
  v6('::ffff:0:0', 96), v6('100::', 64), v6('2001::', 32),
  v6('2001:2::', 48), v6('2001:3::', 48), v6('2001:10::', 28),
  v6('2001:20::', 28), v6('2001:db8::', 32), v6('fc00::', 7),
  v6('fe80::', 10), v6('ff00::', 8), v6('2002:c000:204::', 48),
];

export function isForbiddenAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const dottedMapped = host.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped) return isForbiddenAddress(dottedMapped[1]);
  if (isIP(host) === 4) {
    const value = ipv4ToNumber(host);
    const ranges: [number, number][] = [
      [0x00000000, 0xff000000], [0x0a000000, 0xff000000], [0x64400000, 0xffc00000],
      [0x7f000000, 0xff000000], [0xa9fe0000, 0xffff0000], [0xac100000, 0xfff00000],
      [0xc0000000, 0xffffff00], [0xc0000200, 0xffffff00], [0xc0586300, 0xffffff00],
      [0xc0a80000, 0xffff0000], [0xc6120000, 0xfffe0000], [0xc6336400, 0xffffff00],
      [0xc01fc400, 0xffffff00], [0xc034c100, 0xffffff00],
      [0xcb007100, 0xffffff00], [0xe0000000, 0xf0000000], [0xf0000000, 0xf0000000],
    ];
    return ranges.some(([network, mask]) => ((value & mask) >>> 0) === (network >>> 0));
  }
  if (isIP(host) === 6) {
    const mappedDotted = host.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isForbiddenAddress(mappedDotted[1]);
    const address = ipv6ToBigInt(host);
    if (address === undefined) return true;
    if ((address >> 32n) === 0xffffn) {
      const value = Number(address & 0xffffffffn);
      return isForbiddenAddress([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
    }
    return FORBIDDEN_V6.some(([network, bits]) => inCidr(address, network, bits));
  }
  return host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost');
}

export async function resolveSafeAddress(url: URL, resolver?: HostResolver): Promise<string | undefined> {
  if (isForbiddenAddress(url.hostname)) return undefined;
  if (isIP(url.hostname)) return url.hostname;
  try {
    const lookup = resolver || (async (hostname: string) => (await dns.lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address));
    const addresses = await lookup(url.hostname);
    return addresses.length > 0 && addresses.every((address) => isIP(address) !== 0 && !isForbiddenAddress(address)) ? addresses[0] : undefined;
  } catch { return undefined; }
}

export function createPinnedFetch(fetchImpl: typeof fetch, pinnedUrl: URL, authority: string, options: { allowInsecureHttp?: boolean; pinNetwork?: boolean } = {}): typeof fetch {
  const expected = pinnedUrl.toString();
  return async (input, init) => {
    const supplied = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const protocolAllowed = supplied.protocol === 'https:' || (options.allowInsecureHttp === true && supplied.protocol === 'http:');
    if (supplied.toString() !== expected || !protocolAllowed || isForbiddenAddress(supplied.hostname)) throw new Error('MCP_UNSAFE_DESTINATION');
    const safeInit = { ...(init || {}), redirect: 'error' as RequestRedirect, headers: { ...(init?.headers || {}), host: authority } };
    const response = options.pinNetwork
      ? await requestPinned(pinnedUrl, authority, safeInit)
      : await fetchImpl(expected, safeInit);
    if (response.url && new URL(response.url).toString() !== expected) throw new Error('MCP_UNSAFE_REDIRECT');
    return response;
  };
}

function requestPinned(url: URL, authority: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const headers = new Headers(init.headers);
    headers.set('host', authority);
    const signal = init.signal;
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method || 'GET',
      headers: Object.fromEntries(headers.entries()),
      ...(url.protocol === 'https:' ? { servername: new URL(authority.includes(':') ? `https://${authority}` : `https://${authority}`).hostname } : {}),
      lookup: (_hostname, _options, callback) => callback(null, url.hostname, isIP(url.hostname) as 4 | 6),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        signal?.removeEventListener('abort', abortRequest);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers as Record<string, string> }));
      });
    });
    const abortRequest = () => {
      request.destroy(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abortRequest, { once: true });
    request.once('error', (error) => {
      signal?.removeEventListener('abort', abortRequest);
      reject(error);
    });
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body === 'string' || init.body instanceof Uint8Array) request.write(init.body);
      else reject(new Error('MCP_UNSUPPORTED_REQUEST_BODY'));
    }
    request.end();
  });
}
