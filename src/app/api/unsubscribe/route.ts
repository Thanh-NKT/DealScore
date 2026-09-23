import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST only. NO GET: mailbox link scanners open every link, so a GET that
 * unsubscribes would unsubscribe users who never clicked (W14).
 * Accepts both Gmail/Yahoo One-Click (RFC 8058) and the form on the /unsubscribe page.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const scope = secret ? verifyUnsubscribeToken(token, secret) : null;
  if (!scope) return NextResponse.json({ error: "invalid_token" }, { status: 400, headers: NO_STORE });

  // Identity comes from the verified token — there is no session here.
  const admin = createAdminClient();
  const { error } =
    scope.kind === "watch"
      ? await admin.from("watches").update({ status: "paused" }).eq("id", scope.watchId).eq("user_id", scope.userId)
      : await admin.from("notification_settings").update({ email_enabled: false }).eq("user_id", scope.userId);
  if (error) throw new Error(`Unsubscribe failed: ${error.message}`);

  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.redirect(new URL(`/unsubscribe?done=${scope.kind}`, request.url), { status: 303, headers: NO_STORE });
  }
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}
