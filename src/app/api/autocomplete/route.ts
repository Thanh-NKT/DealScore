import { NextResponse, type NextRequest } from "next/server";
import {
  AUTOCOMPLETE_MIN_CHARS,
  autocomplete,
  normalizeAutocompleteQuery,
} from "@/lib/search/autocomplete";
import { emptyAutocomplete, type AutocompleteResponse } from "@/lib/search/autocomplete-types";

/** Search-box suggestions: `AutocompleteResponse` (src/lib/search/autocomplete-types.ts). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = normalizeAutocompleteQuery(searchParams.get("q"));

  if (q.length < AUTOCOMPLETE_MIN_CHARS) {
    return NextResponse.json<AutocompleteResponse>(emptyAutocomplete(q));
  }

  try {
    const suggestions = await autocomplete(q);
    return NextResponse.json<AutocompleteResponse>(suggestions, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("api/autocomplete error:", err);
    // no-store: a transient failure must never be cached as "no suggestions".
    return NextResponse.json<AutocompleteResponse>(emptyAutocomplete(q), {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
