import { REPORT_KINDS, REPORT_MESSAGE_MAX, type ReportKind } from "@/lib/reports/constants";

export interface ReportInput {
  productId: string;
  variantId: string | null;
  offerId: string | null;
  kind: ReportKind;
  message: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const optionalUuid = (v: unknown): string | null | undefined =>
  v == null || v === "" ? null : isUuid(v) ? v : undefined;

/**
 * Shape check of a report before it reaches the RPC (which re-checks that product / variant / offer belong
 * together). Only the five known fields are read: anything else — a `userId` above all — is ignored.
 */
export function validateReport(input: unknown): { ok: true; value: ReportInput } | { ok: false } {
  if (input == null || typeof input !== "object") return { ok: false };
  const o = input as Record<string, unknown>;
  if (!isUuid(o.productId)) return { ok: false };
  const variantId = optionalUuid(o.variantId);
  const offerId = optionalUuid(o.offerId);
  if (variantId === undefined || offerId === undefined) return { ok: false };
  if (typeof o.kind !== "string" || !REPORT_KINDS.includes(o.kind as ReportKind)) return { ok: false };
  const kind = o.kind as ReportKind;
  if (o.message != null && typeof o.message !== "string") return { ok: false };
  const trimmed = typeof o.message === "string" ? o.message.trim() : "";
  if (trimmed.length > REPORT_MESSAGE_MAX) return { ok: false };
  const message = trimmed === "" ? null : trimmed;
  if (kind === "other" && message == null) return { ok: false };
  return { ok: true, value: { productId: o.productId, variantId, offerId, kind, message } };
}
