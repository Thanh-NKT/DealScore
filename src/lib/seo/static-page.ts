import type { Metadata } from "next";

/** Metadata for a fixed, indexable content page (canonical without query). Pure. */
export function staticPageMetadata(p: { path: string; title: string; description: string }, siteUrl: string): Metadata {
  const url = `${siteUrl}${p.path}`;
  const title = `${p.title} | DealScore`;
  return {
    title,
    description: p.description,
    alternates: { canonical: url },
    openGraph: { title, description: p.description, url, type: "website", locale: "vi_VN" },
  };
}
