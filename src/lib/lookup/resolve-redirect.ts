/**
 * Follow redirects for marketplace short URLs with strict SSRF checks.
 *
 * The user supplies a URL and the server fetches it. Every hop must pass:
 * https, default port, host EXACTLY in some adapter's hosts ∪ shortHosts
 * (src/lib/marketplaces). Never return the response body to the client.
 */
import { MARKETPLACES, parseProductUrl } from "@/lib/marketplaces";

const MAX_HOPS = 3;
const HOP_TIMEOUT_MS = 3000;
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(MARKETPLACES.flatMap((m) => [...m.hosts, ...m.shortHosts]));

function isHostAllowed(url: URL): boolean {
  // An empty url.port = the scheme's default port (443). Any other port suggests
  // we're being steered toward an internal service.
  return url.port === "" && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

export async function resolveProductRedirect(
  initialUrl: string,
): Promise<
  | { ok: true; finalUrl: string }
  | {
      ok: false;
      reason:
        | "host_not_allowed"
        | "too_many_hops"
        | "timeout"
        | "insecure"
        | "error";
    }
> {
  let currentUrl = initialUrl;

  // hop = number of requests sent. Check the current URL BEFORE each request, and
  // also check the final target URL after request number MAX_HOPS.
  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: "error" };
    }

    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "insecure" };
    }
    if (!isHostAllowed(parsed)) {
      return { ok: false, reason: "host_not_allowed" };
    }

    // Reached a readable product URL — stop, no extra requests.
    if (parseProductUrl(currentUrl).ok) {
      return { ok: true, finalUrl: currentUrl };
    }

    if (hop >= MAX_HOPS) {
      return { ok: false, reason: "too_many_hops" };
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "error" };
    }

    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) {
      // No more redirects: the current URL is the target.
      return { ok: true, finalUrl: currentUrl };
    }

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      return { ok: false, reason: "error" };
    }
  }
}
