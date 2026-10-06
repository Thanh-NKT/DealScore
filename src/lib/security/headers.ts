/**
 * Security headers. Pure (no Next imports) so next.config.ts, src/proxy.ts and tests share it.
 *
 * - Static headers (HSTS, X-Frame-Options, …) go on every response via next.config.ts `headers()`.
 * - The CSP carries a per-request nonce, so it is built in src/proxy.ts. Next reads the nonce from
 *   the request's CSP header and puts it on its own scripts. Every page is dynamically rendered
 *   already (the session is read in the layout tree), so the nonce costs no static optimization.
 *   The CSP is set ONLY in the proxy: a second CSP header would be enforced on top of it.
 */

/** Runs before paint to apply the saved theme (no flash). Allowed by its hash, not by the nonce. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("dealscore-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

/** base64 sha256 of THEME_INIT_SCRIPT. tests/lib/security/headers.test.ts keeps it in sync. */
export const THEME_INIT_SCRIPT_HASH = "sha256-pG1HtRBCfKF7/qQXrpmfOeVcrGBVJqiBXptND4wMdQw=";

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    // Nothing on the site uses these. Notifications / push are not governed by this header.
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "serial=()",
      "bluetooth=()",
      "hid=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "display-capture=()",
      "browsing-topics=()",
      "interest-cohort=()",
    ].join(", "),
  },
];

function origin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(opts: {
  nonce: string;
  dev: boolean;
  supabaseUrl?: string;
  sentryDsn?: string;
  /** Only over https (local `pnpm start` runs on http). */
  upgradeInsecure: boolean;
}): string {
  const supabase = origin(opts.supabaseUrl);
  const sentry = origin(opts.sentryDsn);
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : null;

  const directives: Record<string, (string | null | false)[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic': scripts loaded by a nonce'd script are trusted; host lists are ignored.
    "script-src": [
      "'self'",
      `'nonce-${opts.nonce}'`,
      `'${THEME_INIT_SCRIPT_HASH}'`,
      "'strict-dynamic'",
      opts.dev && "'unsafe-eval'",
    ],
    // Inline style attributes (React `style={…}`) cannot carry a nonce. A nonce here would also
    // disable 'unsafe-inline', so styles stay on 'unsafe-inline'.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Product images come from marketplace CDNs (Shopee, TikTok, Lazada, …).
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabase, supabaseWs, sentry],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Google sign-in posts to a server action that redirects to Supabase Auth, then to Google.
    "form-action": ["'self'", supabase, "https://accounts.google.com"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) =>
    [name, ...values.filter((v): v is string => typeof v === "string")].join(" "),
  );
  if (opts.upgradeInsecure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
