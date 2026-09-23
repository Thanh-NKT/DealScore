import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron";
import { purgeDeletedAccounts } from "@/lib/account/purge";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // A missing secret is a configuration error — never let it through.
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const { purged, failed } = await purgeDeletedAccounts({ now: new Date() });
  if (failed.length > 0) console.error("purge-accounts: failed to delete users", failed);

  // 500 on errors so Vercel marks the run as failed.
  return NextResponse.json(
    { purged: purged.length, failed: failed.length },
    { status: failed.length > 0 ? 500 : 200, headers: NO_STORE },
  );
}
