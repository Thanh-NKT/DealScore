import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/** 1.7: index catalog pages only. Personal, transactional and redirect routes stay out. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/account",
        "/api/",
        "/go/",
        "/auth/",
        "/share-target",
        "/unsubscribe",
        "/reset-password",
        "/forgot-password",
        "/login",
        "/register",
        "/search",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
