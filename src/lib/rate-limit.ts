import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type LookupOutcome = "resolved" | "ingested" | "rejected" | "error";

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: "ip_hourly" | "user_hourly" | "global_daily";
  retryAfterSeconds?: number;
}

const DEV_SALT = "kairo_lookup_dev_salt";

export function hashIp(ip: string): string {
  const salt = process.env.LOOKUP_IP_SALT;
  // With a public default salt in the repo, IP hashes are reversible by brute force
  // (the IPv4 space is only 2^32). Production must have its own salt.
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("Missing LOOKUP_IP_SALT");
  }
  return crypto.createHash("sha256").update(`${ip}_${salt || DEV_SALT}`).digest("hex");
}

/** False when production runs without its own LOOKUP_IP_SALT (a configuration error). */
export function ipSaltConfigured(): boolean {
  return Boolean(process.env.LOOKUP_IP_SALT) || process.env.NODE_ENV !== "production";
}

/**
 * Salted hash for rate-limit keys only (never stored as data). Unlike hashIp() it never throws: a
 * missing salt must not switch a limiter off. Callers report !ipSaltConfigured() themselves.
 */
export function rateKeyHash(value: string): string {
  return crypto.createHash("sha256").update(`${value}_${process.env.LOOKUP_IP_SALT || DEV_SALT}`).digest("hex");
}

/**
 * The network an address belongs to: IPv4 /24, IPv6 /64 (one home or mobile connection owns a whole
 * /64, so rotating addresses inside it is free). IPv4-mapped IPv6 counts as IPv4. Anything unparsable
 * is returned as is (e.g. "unknown"). Pure.
 */
export function networkPrefix(ip: string): string {
  let s = ip.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  s = s.split("%")[0]; // zone id
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(s);
  if (v4) {
    const o = v4.slice(1, 5).map(Number);
    return o.every((n) => n <= 255) ? `${o.slice(0, 3).join(".")}.0/24` : s;
  }
  const groups = expandIpv6(s);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : s;
}

/** The 8 groups of an IPv6 address (lower-case, no leading zeros), or null. */
function expandIpv6(input: string): string[] | null {
  if (!input.includes(":")) return null;
  let s = input;
  let tail: string[] = [];
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const o = dotted.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    tail = [((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16)];
    s = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h === "" ? [] : h.split(":"));
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const given = head.length + rest.length + tail.length;
  if (halves.length === 1 ? given !== 8 : given > 7) return null;
  const all = [...head, ...Array<string>(8 - given).fill("0"), ...rest, ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16).toString(16));
}

/**
 * Salted hash of the client's network (networkPrefix): the extension's peer identity — addresses
 * rotated inside one /64 (or one /24) are one peer, not many. Throws like hashIp() without a salt.
 */
export function hashNetwork(ip: string): string {
  return hashIp(`net:${networkPrefix(ip)}`);
}

/**
 * Client IP, used as the rate-limit key.
 *
 * DEPLOYMENT ASSUMPTION: the platform in front (Vercel) OVERWRITES x-real-ip /
 * x-forwarded-for, so clients cannot spoof them. When self-hosting behind another proxy,
 * configure it to overwrite both headers, otherwise every request picks its own
 * "IP" and the per-IP quota is void.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

function retryAfter(reason: RateLimitVerdict["reason"]): number {
  // Sliding 1-hour / 1-day window: we don't know exactly when a slot frees up, so return
  // the upper bound to keep clients from retrying in a burst.
  return reason === "global_daily" ? 86_400 : 3_600;
}

/**
 * Start a lookup: check the anti-scraping quota (120/hour/IP) and write a
 * 'pending' row — atomically, in the DB. On DB error THROW, never let it through: a
 * rate limit that silently turns off opens the door to catalog scraping.
 */
export async function beginLookup(params: {
  ipHash: string;
  userId: string | null;
}): Promise<RateLimitVerdict & { requestId: number | null }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("lookup_begin", {
    p_ip_hash: params.ipHash,
    // The generated type doesn't know the uuid parameter accepts null.
    p_user_id: params.userId as string,
  });
  if (error) throw new Error(`lookup_begin failed: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error("lookup_begin returned no result");
  if (!row.allowed) {
    const reason = row.reason as RateLimitVerdict["reason"];
    return { allowed: false, reason, retryAfterSeconds: retryAfter(reason), requestId: null };
  }
  return { allowed: true, requestId: row.request_id };
}

/**
 * Upgrade a lookup to a new ingest: check the ingest quota (guest 10/hour/IP,
 * user 60/hour, system-wide LOOKUP_DAILY_INGEST_CAP/day). Only call when the URL
 * is NOT yet in the catalog.
 */
export async function beginIngest(requestId: number): Promise<RateLimitVerdict> {
  const supabase = createAdminClient();
  const cap = parseInt(process.env.LOOKUP_DAILY_INGEST_CAP || "2000", 10);
  const { data, error } = await supabase.rpc("lookup_begin_ingest", {
    p_request_id: requestId,
    p_global_cap: Number.isFinite(cap) ? cap : 2000,
  });
  if (error) throw new Error(`lookup_begin_ingest failed: ${error.message}`);

  const row = data?.[0];
  if (!row) throw new Error("lookup_begin_ingest returned no result");
  if (!row.allowed) {
    const reason = row.reason as RateLimitVerdict["reason"];
    return { allowed: false, reason, retryAfterSeconds: retryAfter(reason) };
  }
  return { allowed: true };
}

/** Record the final outcome of a lookup. Errors are only logged — the user already has the result. */
export async function finishLookup(requestId: number, outcome: LookupOutcome): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("lookup_requests")
    .update({ outcome })
    .eq("id", requestId);
  if (error) console.error("Could not record lookup_requests outcome:", error.message);
}
