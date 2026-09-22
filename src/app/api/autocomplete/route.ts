import { NextResponse, type NextRequest } from "next/server";
import { searchProducts } from "@/lib/search";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const result = await searchProducts({
      q,
      page: 1,
      sort: "relevance",
    });

    const suggestions = result.items.slice(0, 8).map((item) => ({
      productId: item.productId,
      slug: item.slug,
      categorySlug: item.categorySlug,
      name: item.canonicalName,
      brand: item.brand,
      image: item.image,
      bestPrice: item.bestPrice,
    }));

    return NextResponse.json(suggestions, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("Lỗi api/autocomplete:", err);
    return NextResponse.json([], { status: 500 });
  }
}
