/**
 * Stop any destructive script from accidentally running against a real environment.
 *
 * seed-dev wipes the catalog before running. Running it while .env.local
 * points at the production project would lose all data — and there is no backup.
 * So it is blocked in code, rather than relying on whoever runs it to remember to check.
 */

const LOCAL_HOST_PATTERNS = [
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/host\.docker\.internal(:\d+)?$/,
];

export interface LocalEnv {
  url: string;
  serviceKey: string;
}

/**
 * Returns URL + service key, or exits the process if this is not a local environment.
 * Set ALLOW_DESTRUCTIVE_REMOTE=1 to bypass — only when you truly mean it.
 */
export function requireLocalSupabase(scriptName: string): LocalEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      `[${scriptName}] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.`,
    );
    process.exit(1);
  }

  const origin = url.replace(/\/+$/, "");
  const isLocal = LOCAL_HOST_PATTERNS.some((re) => re.test(origin));

  if (!isLocal && process.env.ALLOW_DESTRUCTIVE_REMOTE !== "1") {
    console.error(
      `\n[${scriptName}] REFUSING TO RUN.\n\n` +
        `  This script WIPES the catalog before running.\n` +
        `  NEXT_PUBLIC_SUPABASE_URL points at: ${origin}\n` +
        `  This is not a local Supabase.\n\n` +
        `  If you really mean it, set ALLOW_DESTRUCTIVE_REMOTE=1.\n`,
    );
    process.exit(1);
  }

  return { url: origin, serviceKey };
}
