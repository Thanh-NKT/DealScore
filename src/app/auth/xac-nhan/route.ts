import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { redirectAfterLogin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextRaw = searchParams.get("next");
  const next = safeNextPath(nextRaw, "/");

  const allowedTypes: EmailOtpType[] = ["email", "magiclink", "signup"];

  if (!token_hash || !type || !allowedTypes.includes(type)) {
    redirect(
      `/dang-nhap?loi=otp_expired&next=${encodeURIComponent(next)}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash,
    type,
  });

  if (error || !data.user) {
    const authError = mapAuthError(error ?? {}, "verify");
    redirect(
      `/dang-nhap?loi=${encodeURIComponent(authError.code)}&next=${encodeURIComponent(next)}`,
    );
  }

  await redirectAfterLogin(supabase, data.user.id, next);
}
