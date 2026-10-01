import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { extractFirstUrl } from "@/lib/shopee/parse-url";
import { lookupProductUrl } from "@/lib/lookup";
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
    // Same flow as /api/lookup — same quota. This page is a public GET;
    // without a rate limit here it would be an unlimited ingest path.
    let productUrl: string | null = null;
    try {
      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      const result = await lookupProductUrl({
        raw: extractedUrl,
        ipHash: hashIp(clientIp(await headers())),
        userId: auth.user?.id ?? null,
      });
      if (result.status !== "error") productUrl = result.productUrl;
    } catch (err) {
      console.error("share-target error:", err);
    }
    // redirect() throws a navigation error — call it OUTSIDE the try so catch doesn't swallow it.
    if (productUrl) redirect(productUrl);
  }

  // No valid product link could be extracted (or the lookup failed): fall back to
  // the search page with the shared text.
  const fallbackQuery = text || title || candidateText;
  redirect(
    fallbackQuery
      ? `/search?q=${encodeURIComponent(fallbackQuery)}`
      : "/search",
  );
}
