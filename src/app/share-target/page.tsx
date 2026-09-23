import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { extractFirstUrl } from "@/lib/shopee/parse-url";
import { lookupShopeeUrl } from "@/lib/lookup";
import { clientIp, hashIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

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
    // Cùng luồng với /api/lookup — cùng hạn mức. Trang này là GET công khai,
    // thiếu rate limit ở đây là một đường ingest không giới hạn.
    let productUrl: string | null = null;
    try {
      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      const result = await lookupShopeeUrl({
        raw: extractedUrl,
        ipHash: hashIp(clientIp(await headers())),
        userId: auth.user?.id ?? null,
      });
      if (result.status !== "error") productUrl = result.productUrl;
    } catch (err) {
      console.error("Lỗi share-target:", err);
    }
    // redirect() ném lỗi điều hướng — gọi NGOÀI try để không bị catch nuốt.
    if (productUrl) redirect(productUrl);
  }

  // Không trích được link Shopee hợp lệ (hoặc tra cứu thất bại): chuyển sang
  // trang tìm kiếm với phần chữ được chia sẻ.
  const fallbackQuery = text || title || candidateText;
  redirect(
    fallbackQuery
      ? `/tim-kiem?q=${encodeURIComponent(fallbackQuery)}`
      : "/tim-kiem",
  );
}
