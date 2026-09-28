import { RECOMMENDATION_LABEL, type Recommendation } from "@/lib/pricing/deal-score";
import { formatVnd } from "@/lib/format";
import { escapeHtml } from "@/lib/email/escape";

export interface AlertEmailItem {
  productName: string;
  variantKey: string;
  imageUrl: string | null;
  price: number;
  baselinePrice: number | null;
  dealScore: number | null;
  recommendation: Recommendation | null;
  triggerTexts: string[];
  scoreReasons: string[]; // at most 2
  buyUrl: string;
  manageUrl: string;
  pauseUrl: string;
}

const DISCLOSURE = "Kairo có thể nhận hoa hồng khi bạn mua qua liên kết này. Giá bạn trả không thay đổi.";

export function renderAlertEmail(input: { items: AlertEmailItem[]; unsubscribeAllUrl: string; siteUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const { items } = input;
  const subject =
    items.length === 1
      ? `${items[0].productName} còn ${formatVnd(items[0].price)}`
      : `${items.length} sản phẩm bạn theo dõi vừa có tin mới`;

  const e = escapeHtml;
  const htmlItems = items
    .map((it) => {
      const score =
        it.dealScore != null && it.recommendation
          ? `<p style="margin:4px 0">Deal Score <strong>${it.dealScore}</strong>/100 · ${e(RECOMMENDATION_LABEL[it.recommendation])}</p>`
          : "";
      const reasons = [...it.triggerTexts, ...it.scoreReasons.slice(0, 2)]
        .map((r) => `<li>${e(r)}</li>`)
        .join("");
      const baseline =
        it.baselinePrice != null
          ? ` <span style="color:#62656D">(lúc bắt đầu theo dõi: ${e(formatVnd(it.baselinePrice))})</span>`
          : "";
      return `<div style="border:1px solid #E4E2DA;border-radius:20px;padding:16px;margin:0 0 16px">
<h3 style="margin:0 0 4px">${e(it.productName)} <span style="color:#62656D;font-weight:normal">— ${e(it.variantKey)}</span></h3>
<p style="margin:4px 0;font-size:20px"><strong>${e(formatVnd(it.price))}</strong>${baseline}</p>
${score}<ul style="margin:8px 0;padding-left:20px">${reasons}</ul>
<p style="margin:12px 0 4px"><a href="${e(it.buyUrl)}" style="display:inline-block;padding:10px 16px;background:#4330E6;color:#FFFFFF;border-radius:12px;font-weight:600;text-decoration:none">Mua trên Shopee</a></p>
<p style="margin:4px 0;font-size:13px"><a href="${e(it.manageUrl)}">Quản lý Watch</a> · <a href="${e(it.pauseUrl)}">Tạm dừng Watch này</a></p>
</div>`;
    })
    .join("");

  const html = `<!doctype html><html lang="vi"><body style="font-family:'Be Vietnam Pro',-apple-system,Segoe UI,Roboto,sans-serif;color:#15161A;line-height:1.5;max-width:600px">
${htmlItems}
<p style="color:#62656D;font-size:12px">${e(DISCLOSURE)}</p>
<p style="color:#62656D;font-size:12px"><a href="${e(input.unsubscribeAllUrl)}">Tắt toàn bộ email thông báo</a></p>
</body></html>`;

  const text = [
    ...items.map((it) =>
      [
        `${it.productName} — ${it.variantKey}`,
        `Giá: ${formatVnd(it.price)}${it.baselinePrice != null ? ` (lúc bắt đầu theo dõi: ${formatVnd(it.baselinePrice)})` : ""}`,
        ...(it.dealScore != null && it.recommendation
          ? [`Deal Score ${it.dealScore}/100 · ${RECOMMENDATION_LABEL[it.recommendation]}`]
          : []),
        ...[...it.triggerTexts, ...it.scoreReasons.slice(0, 2)].map((r) => `- ${r}`),
        `Mua trên Shopee: ${it.buyUrl}`,
        `Quản lý Watch: ${it.manageUrl}`,
        `Tạm dừng Watch này: ${it.pauseUrl}`,
        "",
      ].join("\n"),
    ),
    DISCLOSURE,
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
