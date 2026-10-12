import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/pricing/deal-score";
import { formatVnd } from "@/lib/format";
import { escapeHtml } from "@/lib/email/escape";
import { marketplaceName } from "@/lib/marketplaces";

export interface AlertEmailItem {
  productName: string;
  variantKey: string;
  imageUrl: string | null;
  price: number;
  /** Price after the best voucher combination; shown only when lower than `price`. */
  effectivePrice?: number | null;
  baselinePrice: number | null;
  dealScore: number | null;
  recommendation: Recommendation | null;
  triggerTexts: string[];
  scoreReasons: string[]; // at most 2
  /**
   * Every trigger is price_hike ("chưa nên mua lúc này"): no baseline / saving line, and the CTA is
   * "Xem giá trên DealScore" to the product page (buyUrl), never a marketplace button.
   */
  priceHikeOnly?: boolean;
  /**
   * The marketplace buyUrl's /go link leads to ("tiktok" → "Mua trên TikTok Shop"). null: buyUrl is the
   * DealScore product page (no offer to send the buyer to), so the CTA is "Xem giá trên DealScore".
   * Omitted: Shopee, the only marketplace when this email was first designed.
   */
  marketplace?: string | null;
  buyUrl: string;
  manageUrl: string;
  pauseUrl: string;
}

/**
 * Email palette: the web app's "Sân trung lập" tokens (src/app/globals.css), inlined — mail clients have no
 * CSS variables. A CTA to a marketplace wears that marketplace's colour; a CTA to DealScore is iris.
 */
const C = { ink: "#14121E", ink3: "#66647C", line: "#E4E4EB", primary: "#4F35E3" };
const CTA_BG: Record<string, string> = { shopee: "#DA391A", tiktok: "#010101" };
const VERDICT_COLOR: Record<Recommendation, string> = {
  buy: "#047A4E",
  wait: "#A05A00",
  avoid: "#C9271D",
  insufficient_data: C.ink3,
};
const BODY_OPEN = `<!doctype html><html lang="vi"><body style="font-family:'Be Vietnam Pro',-apple-system,Segoe UI,Roboto,sans-serif;color:${C.ink};line-height:1.5;max-width:600px">`;
const WORDMARK = `<p style="margin:0 0 16px;font-size:20px;font-weight:800;letter-spacing:-0.02em">Deal<span style="color:${C.primary}">Score</span></p>`;
const FOOTER_P = `<p style="color:${C.ink3};font-size:12px">`;
const CARD = `<div style="border:1px solid ${C.line};border-radius:20px;padding:16px 18px;margin:0 0 16px;background:#FFFFFF">`;
const LINK = `style="color:${C.primary}"`;

function button(href: string, label: string, background: string): string {
  return `<a href="${href}" style="display:inline-block;padding:11px 20px;background:${background};color:#FFFFFF;border-radius:999px;font-weight:700;text-decoration:none">${label}</a>`;
}

/** Name of the marketplace the CTA leads to, or null when it leads to DealScore itself. */
function ctaMarketplace(it: AlertEmailItem): string | null {
  if (it.priceHikeOnly) return null;
  if (it.marketplace === undefined) return "Shopee";
  return it.marketplace ? marketplaceName(it.marketplace) : null;
}

/** "≈ X sau voucher" (same copy as ProductCard), or null when there is nothing lower to show. */
function voucherLine(it: AlertEmailItem): string | null {
  const x = it.effectivePrice;
  return x != null && Number.isFinite(x) && x >= 0 && x < it.price ? `≈ ${formatVnd(x)} sau voucher` : null;
}

/** A saved-search or demand-follow block (roadmap P4 E/F). Links go to DealScore pages, never /go. */
export interface DiscoveryEmailBlock {
  title: string;
  lead: string;
  products: Array<{ name: string; price: number | null; recommendation: Recommendation | null; url: string; imageUrl: string | null }>;
  moreCount: number;
  searchUrl: string;
  searchLabel: string;
  manageUrl: string;
  /** Default "Quản lý tìm kiếm đã lưu". */
  manageLabel?: string;
  pauseUrl: string;
  pauseLabel: string;
}

function discoveryHtml(b: DiscoveryEmailBlock): string {
  const e = escapeHtml;
  const rows = b.products
    .map((p) => {
      const img = p.imageUrl
        ? `<img src="${e(p.imageUrl)}" width="56" height="56" alt="" style="width:56px;height:56px;border-radius:12px;object-fit:cover;vertical-align:middle;margin-right:12px">`
        : "";
      const verdict = p.recommendation && p.recommendation !== "insufficient_data" ? ` · ${e(RECOMMENDATION_LABEL[p.recommendation])}` : "";
      return `<p style="margin:8px 0">${img}<a href="${e(p.url)}" style="color:${C.ink};font-weight:600">${e(p.name)}</a><br><strong>${e(formatVnd(p.price))}</strong>${verdict}</p>`;
    })
    .join("");
  const more = b.moreCount > 0 ? `<p style="margin:8px 0"><a href="${e(b.searchUrl)}" ${LINK}>và ${b.moreCount} sản phẩm khác</a></p>` : "";
  return `${CARD}
<h3 style="margin:0 0 4px">${e(b.title)}</h3>
<p style="margin:4px 0;color:${C.ink3}">${e(b.lead)}</p>
${rows}${more}<p style="margin:14px 0 4px">${button(e(b.searchUrl), e(b.searchLabel), C.primary)}</p>
<p style="margin:4px 0;font-size:13px"><a href="${e(b.manageUrl)}" ${LINK}>${e(b.manageLabel ?? "Quản lý tìm kiếm đã lưu")}</a> · <a href="${e(b.pauseUrl)}" ${LINK}>${e(b.pauseLabel)}</a></p>
</div>`;
}

function discoveryText(b: DiscoveryEmailBlock): string {
  return [
    b.title,
    b.lead,
    ...b.products.map((p) => `- ${p.name}: ${formatVnd(p.price)}${p.recommendation && p.recommendation !== "insufficient_data" ? ` · ${RECOMMENDATION_LABEL[p.recommendation]}` : ""} — ${p.url}`),
    ...(b.moreCount > 0 ? [`và ${b.moreCount} sản phẩm khác: ${b.searchUrl}`] : []),
    `${b.searchLabel}: ${b.searchUrl}`,
    `${b.manageLabel ?? "Quản lý tìm kiếm đã lưu"}: ${b.manageUrl}`,
    `${b.pauseLabel}: ${b.pauseUrl}`,
    "",
  ].join("\n");
}

const DISCLOSURE = "DealScore có thể nhận hoa hồng khi bạn mua qua liên kết này. Giá bạn trả không thay đổi.";

export function renderAlertEmail(input: {
  items: AlertEmailItem[];
  /** Discovery blocks (saved search / demand found). Empty or absent → byte-identical watch-only email. */
  discoveries?: DiscoveryEmailBlock[];
  unsubscribeAllUrl: string;
  siteUrl: string;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const { items } = input;
  const discoveries = input.discoveries ?? [];
  if (discoveries.length > 0) return renderWithDiscoveries(input, discoveries);
  const subject =
    items.length === 1
      ? items[0].priceHikeOnly
        ? `${items[0].productName} đang cao hơn mức thường thấy`
        : `${items[0].productName} còn ${formatVnd(items[0].price)}`
      : `${items.length} sản phẩm bạn theo dõi vừa có tin mới`;

  const e = escapeHtml;
  const htmlItems = items
    .map((it) => {
      const score =
        it.dealScore != null && it.recommendation
          ? `<p style="margin:4px 0">Deal Score <strong>${it.dealScore}</strong>/100 · <strong style="color:${VERDICT_COLOR[it.recommendation]}">${e(RECOMMENDATION_LABEL[it.recommendation])}</strong></p>`
          : "";
      const reasons = [...it.triggerTexts, ...it.scoreReasons.slice(0, 2)]
        .map((r) => `<li>${e(r)}</li>`)
        .join("");
      const baseline =
        it.baselinePrice != null && !it.priceHikeOnly
          ? ` <span style="color:${C.ink3};font-size:15px">(lúc bắt đầu theo dõi: ${e(formatVnd(it.baselinePrice))})</span>`
          : "";
      const eff = voucherLine(it);
      const effHtml = eff ? `<p style="margin:0 0 4px;color:${C.ink3}">${e(eff)}</p>` : "";
      const where = ctaMarketplace(it);
      const cta = where
        ? button(e(it.buyUrl), `Mua trên ${e(where)}`, CTA_BG[it.marketplace ?? "shopee"] ?? C.primary)
        : button(e(it.buyUrl), "Xem giá trên DealScore", C.primary);
      return `${CARD}
<h3 style="margin:0 0 4px">${e(it.productName)} <span style="color:${C.ink3};font-weight:normal">— ${e(it.variantKey)}</span></h3>
<p style="margin:4px 0;font-size:22px"><strong>${e(formatVnd(it.price))}</strong>${baseline}</p>
${effHtml}${score}<ul style="margin:8px 0;padding-left:20px">${reasons}</ul>
<p style="margin:14px 0 4px">${cta}</p>
<p style="margin:4px 0;font-size:13px"><a href="${e(it.manageUrl)}" ${LINK}>Xem sản phẩm đang theo dõi</a> · <a href="${e(it.pauseUrl)}" ${LINK}>Tạm dừng thông báo sản phẩm này</a></p>
</div>`;
    })
    .join("");

  const html = `${BODY_OPEN}
${WORDMARK}
${htmlItems}
${FOOTER_P}${e(DISCLOSURE)}</p>
${FOOTER_P}<a href="${e(input.unsubscribeAllUrl)}" ${LINK}>Tắt toàn bộ email thông báo</a></p>
</body></html>`;

  const text = [
    ...items.map((it) =>
      [
        `${it.productName} — ${it.variantKey}`,
        `Giá: ${formatVnd(it.price)}${it.baselinePrice != null && !it.priceHikeOnly ? ` (lúc bắt đầu theo dõi: ${formatVnd(it.baselinePrice)})` : ""}`,
        ...[voucherLine(it)].filter((l): l is string => l != null),
        ...(it.dealScore != null && it.recommendation
          ? [`Deal Score ${it.dealScore}/100 · ${RECOMMENDATION_LABEL[it.recommendation]}`]
          : []),
        ...[...it.triggerTexts, ...it.scoreReasons.slice(0, 2)].map((r) => `- ${r}`),
        ctaMarketplace(it) ? `Đến ${ctaMarketplace(it)}: ${it.buyUrl}` : `Xem giá trên DealScore: ${it.buyUrl}`,
        `Xem sản phẩm đang theo dõi: ${it.manageUrl}`,
        `Tạm dừng thông báo sản phẩm này: ${it.pauseUrl}`,
        "",
      ].join("\n"),
    ),
    DISCLOSURE,
    `Tắt toàn bộ email thông báo: ${input.unsubscribeAllUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** An email holding at least one discovery block, with or without watch items (UI spec §1.4 subjects). */
function renderWithDiscoveries(
  input: { items: AlertEmailItem[]; unsubscribeAllUrl: string; siteUrl: string },
  discoveries: DiscoveryEmailBlock[],
): { subject: string; html: string; text: string } {
  const watchPart = input.items.length > 0 ? renderAlertEmail({ ...input, discoveries: [] }) : null;
  const subject =
    input.items.length === 0 && discoveries.length === 1
      ? discoveries[0].title
      : `${input.items.length + discoveries.length} tin mới từ DealScore`;
  const e = escapeHtml;
  // The watch part's items (between its wordmark and its footer) are reused verbatim.
  const head = `${BODY_OPEN}\n${WORDMARK}\n`;
  const watchHtml = watchPart ? watchPart.html.slice(head.length, watchPart.html.indexOf(FOOTER_P)) : "";
  const html = `${head}${watchHtml}${discoveries.map(discoveryHtml).join("")}
${watchPart ? `${FOOTER_P}${e(DISCLOSURE)}</p>\n` : ""}${FOOTER_P}<a href="${e(input.unsubscribeAllUrl)}" ${LINK}>Tắt toàn bộ email thông báo</a></p>
</body></html>`;
  const watchText = watchPart ? watchPart.text.slice(0, watchPart.text.lastIndexOf(DISCLOSURE)) : "";
  const text = [
    watchText + discoveries.map(discoveryText).join("\n"),
    ...(watchPart ? [DISCLOSURE] : []),
    `Tắt toàn bộ email thông báo: ${input.unsubscribeAllUrl}`,
  ].join("\n");
  return { subject, html, text };
}

/** RFC 8058 — Gmail / Yahoo show a one-click unsubscribe button. */
export function listUnsubscribeHeaders(oneClickPostUrl: string, pageUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickPostUrl}>, <${pageUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
