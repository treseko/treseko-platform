/**
 * Older Treseko Flow builds emitted an environment-first baseUrl with the
 * recorded origin only as a fallback. Keep the origin embedded in that
 * generated declaration authoritative when importing a Flow script.
 */
export function preferRecordedBaseUrl(script: string): string {
  return String(script || '').replace(
    /(\b(?:const|let|var)\s+baseUrl\s*=\s*)variables\.base_url\s*\|\|\s*variables\.BASE_URL\s*\|\|\s*(["'])(https?:\/\/[^"'\\\s]+)\2/g,
    (_match, declaration: string, _quote: string, recordedUrl: string) => {
      try {
        return `${declaration}${JSON.stringify(new URL(recordedUrl).origin)}`;
      } catch {
        return _match;
      }
    },
  );
}
