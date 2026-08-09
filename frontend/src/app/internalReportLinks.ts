/**
 * Rewrites bug deep links embedded in an internal report to the origin where
 * the Treseko frontend is currently open.
 *
 * Reports can be persisted and may have been generated with an old local Vite
 * port (for example 5173) or an old IP address. The report must remain
 * portable, so same-app links are stored as relative paths instead of
 * trusting the origin stored in HTML.
 */
export function normalizeInternalReportBugLinks(html: string, origin?: string): string {
  if (typeof DOMParser === "undefined") return html;

  const currentOrigin = origin || (typeof window !== "undefined" ? window.location.origin : "");
  if (!currentOrigin) return html;
  const currentUrl = new URL(currentOrigin);
  const isLoopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) return;

    try {
      const url = new URL(href, currentOrigin);
      if (url.searchParams.get("tab") !== "bugs" || !url.searchParams.get("bug_id")) return;
      const sameApplicationHost = url.hostname === currentUrl.hostname
        || (isLoopback(url.hostname) && isLoopback(currentUrl.hostname));
      const markedInternalReportLink = anchor.classList.contains("report-action-link");
      if (url.origin !== currentUrl.origin && !sameApplicationHost && !markedInternalReportLink) return;

      const path = url.pathname || "/";
      // Keep the link relative so it follows the current host, IP and port.
      anchor.setAttribute("href", `${path}${url.search}${url.hash}`);
    } catch {
      // Keep malformed/external content untouched; the report must still render.
    }
  });

  return document.documentElement.outerHTML;
}
