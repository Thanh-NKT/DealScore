/**
 * First-party analytics events (1.11). Pure.
 *
 * Privacy by construction: every event has an allow-list of properties, each a number, boolean,
 * UUID or a value from a fixed enum. Anything else is dropped — no emails, search text or URLs can
 * reach the table. Keep EVENT_NAMES in sync with the check constraint (latest: migration 0011).
 */

export const EVENT_NAMES = [
  "signup_completed",
  "login_succeeded",
  "lookup_submitted",
  "search_performed",
  "product_viewed",
  "watch_created",
  "watch_deleted",
  "push_enabled",
  "deal_shared",
  "share_opened",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
export type EventProps = Record<string, string | number | boolean>;

type PropType = "number" | "boolean" | "uuid" | readonly string[];

const RECOMMENDATIONS = ["buy", "wait", "avoid", "insufficient_data"] as const;

const SCHEMA: Record<EventName, Record<string, PropType>> = {
  signup_completed: {},
  login_succeeded: {},
  lookup_submitted: { outcome: ["resolved", "ingested", "rejected", "error", "invalid"] },
  search_performed: {
    has_query: "boolean",
    has_filters: "boolean",
    result_count: "number",
    page: "number",
    sort: ["relevance", "deal_score", "price_asc", "price_desc", "updated"],
  },
  product_viewed: { product_id: "uuid", variant_id: "uuid", recommendation: RECOMMENDATIONS, is_draft: "boolean" },
  watch_created: { variant_id: "uuid", condition_count: "number" },
  watch_deleted: {},
  push_enabled: {},
  deal_shared: { product_id: "uuid", method: ["native", "copy"] },
  share_opened: { product_id: "uuid" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEventName(name: string): name is EventName {
  return (EVENT_NAMES as readonly string[]).includes(name);
}

function valid(type: PropType, v: unknown): v is string | number | boolean {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "boolean") return typeof v === "boolean";
  if (type === "uuid") return typeof v === "string" && UUID_RE.test(v);
  return typeof v === "string" && type.includes(v);
}

export function sanitizeProps(name: EventName, props: Record<string, unknown> = {}): EventProps {
  const schema = SCHEMA[name];
  const out: EventProps = {};
  for (const [key, type] of Object.entries(schema)) {
    const v = props[key];
    if (valid(type, v)) out[key] = v;
  }
  return out;
}
