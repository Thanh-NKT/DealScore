"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/actions/account";
import { trackAfter } from "@/lib/analytics/track";
import { parsePreferencesForm, type PreferencesField } from "@/lib/preferences";
import { savePreferencesForUser } from "@/lib/preferences/queries";
import { createClient } from "@/lib/supabase/server";
import { gateUser } from "@/lib/auth/session";

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
  // Same AuthGate as the page: no writes without the current consent, or while pending deletion.
  const gate = await gateUser(supabase);
  if (gate.kind === "signed_out") {
    return { status: "error", errors: { form: "Phiên đăng nhập đã hết. Hãy đăng nhập lại để lưu sở thích." } };
  }
  if (gate.kind === "blocked") {
    return {
      status: "error",
      errors: {
        form:
          gate.reason === "consent"
            ? "Hãy đồng ý điều khoản mới của Kairo (tải lại trang) rồi lưu lại sở thích."
            : "Tài khoản đang chờ xóa. Khôi phục tài khoản để lưu sở thích.",
      },
    };
  }
  const user = { id: gate.userId };

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
