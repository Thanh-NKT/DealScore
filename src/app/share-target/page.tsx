import { redirect } from "next/navigation";
import { extractFirstUrl, parseShopeeUrl } from "@/lib/shopee/parse-url";
import { resolveShopeeRedirect } from "@/lib/shopee/resolve-redirect";
import { resolveOrIngestShopee } from "@/lib/ingest";

interface ShareTargetProps {
  searchParams: Promise<{
    title?: string;
    text?: string;
    url?: string;
  }>;
}

export default async function ShareTargetPage({
  searchParams,
}: ShareTargetProps) {
  const { title, text, url: rawUrl } = await searchParams;

  const candidateText = `${rawUrl || ""} ${text || ""} ${title || ""}`.trim();
  const extractedUrl = extractFirstUrl(candidateText);

  if (extractedUrl) {
    let parsed = parseShopeeUrl(extractedUrl);

    if (!parsed.ok && parsed.reason === "needs_redirect") {
      const redirectRes = await resolveShopeeRedirect(extractedUrl);
      if (redirectRes.ok) {
        parsed = parseShopeeUrl(redirectRes.finalUrl);
      }
    }

    if (parsed.ok) {
      const result = await resolveOrIngestShopee({
        shopId: parsed.shopId,
        itemId: parsed.itemId,
      });

      if (result.status === "resolved" || result.status === "ingested") {
        redirect(result.productUrl);
      }
    }
  }

  // Nếu không trích xuất được link Shopee hợp lệ, chuyển hướng sang trang tìm kiếm
  const fallbackQuery = text || title || candidateText;
  redirect(
    fallbackQuery
      ? `/tim-kiem?q=${encodeURIComponent(fallbackQuery)}`
      : "/tim-kiem",
  );
}
