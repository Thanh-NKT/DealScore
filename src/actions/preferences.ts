"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/actions/account";
import { trackAfter } from "@/lib/analytics/track";
import { parsePreferencesForm, type PreferencesField } from "@/lib/preferences";
import { savePreferencesForUser } from "@/lib/preferences/queries";
import { createClient } from "@/lib/supabase/server";

export type PreferencesActionResult = ActionResult<PreferencesField | "form">;

/**
 * Save the shopping preferences form (spec §5). Identity comes from the session (`getUser()`) —
 * any user id in the form is ignored.
 */
export async function savePreferences(
  _prev: PreferencesActionResult,
  form: FormData,
): Promise<PreferencesActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", errors: { form: "Phiên đăng nhập đã hết. Hãy đăng nhập lại để lưu sở thích." } };
  }

  const parsed = parsePreferencesForm(form);
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  const p = parsed.value;

  const { error } = await savePreferencesForUser(supabase, user.id, p);
  if (error) {
    console.error("preferences: save failed", error.message);
    return { status: "error", errors: { form: "Chưa lưu được sở thích. Các lựa chọn của bạn vẫn còn, hãy thử lại." } };
  }

  trackAfter("preferences_saved", {
    userId: user.id,
    props: {
      brands: p.brands.length,
      categories: p.categoryIds.length,
      has_price: p.minPrice != null || p.maxPrice != null,
      marketplaces: p.marketplaces.length,
    },
  });
  revalidatePath("/account/preferences");
  return { status: "saved" };
}
