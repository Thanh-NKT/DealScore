import { NextResponse, type NextRequest } from "next/server";
import { autocompleteProducts } from "@/lib/search";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const suggestions = await autocompleteProducts(q);
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
