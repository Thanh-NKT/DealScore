import { NextResponse, type NextRequest } from "next/server";
import { acquireJobLock, isAuthorizedCronRequest, releaseJobLock } from "@/lib/cron";
import { purgeDeletedAccounts } from "@/lib/account/purge";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";

const NO_STORE = { "Cache-Control": "no-store" };
/** Time for deletions; the rest of the function budget is for the lock, the count and the reply. */
const PURGE_BUDGET_MS = 45_000;
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // A missing secret is a configuration error — never let it through.
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const admin = createAdminClient();
  // Two overlapping runs would try to delete the same users.
  const owner = await acquireJobLock(admin, "purge-accounts");
  if (!owner) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });
  try {
    const { purged, failed, remaining } = await purgeDeletedAccounts(
      { now: new Date(), deadline: Date.now() + PURGE_BUDGET_MS },
      admin,
    );
    if (failed.length > 0) {
      console.error("purge-accounts: failed to delete users", failed);
      // Count only: user ids stay out of the error report.
      reportError(new Error("purge-accounts: failed to delete users"), { job: "purge-accounts", failed: failed.length });
    }

    if (remaining > 0) {
      // Accounts past the promised 30 days are still there (backlog or failures): alert.
      reportError(new Error("purge-accounts: due accounts remain after the run"), { job: "purge-accounts", remaining });
    }

    // 500 on errors so Vercel marks the run as failed.
    return NextResponse.json(
      { purged: purged.length, failed: failed.length, remaining },
      { status: failed.length > 0 ? 500 : 200, headers: NO_STORE },
    );
  } catch (err) {
    reportError(err, { job: "purge-accounts" });
    throw err;
  } finally {
    await releaseJobLock(admin, "purge-accounts", owner);
  }
}
