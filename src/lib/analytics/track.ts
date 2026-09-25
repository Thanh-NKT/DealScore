import "server-only";
import { cookies } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeProps, type EventName } from "@/lib/analytics/events";

/** Same anonymous session cookie that /go writes on buy clicks. */
export const SESSION_COOKIE = "kairo_sid";

/**
 * Record one analytics event (1.11). Never throws: losing an event must not break the request.
 * Call it inside after() so it runs once the response has been sent.
 * userId comes from getUser() on the server — never from the client.
 */
export async function track(
  name: EventName,
  opts: { userId?: string | null; sessionId?: string | null; props?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("analytics_events")
      .insert({
        name,
        user_id: opts.userId ?? null,
        session_id: opts.sessionId ?? null,
        props: sanitizeProps(name, opts.props),
      });
    if (error) console.error(`track(${name}) failed:`, error.message);
  } catch (err) {
    console.error(`track(${name}) failed:`, err);
  }
}

/** The anonymous session id, if the browser already has one. Read-only: Server Components can't set cookies. */
export async function currentSessionId(): Promise<string | null> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * track() scheduled with after(): runs once the response is sent, so analytics never slows a page.
 * The session id is read now (request scope), the write happens later. Outside a request scope
 * (unit tests, scripts) this is a no-op.
 */
export function trackAfter(
  name: EventName,
  opts: { userId?: string | null; props?: Record<string, unknown> } = {},
): void {
  try {
    const sessionIdPromise = currentSessionId();
    after(async () => track(name, { ...opts, sessionId: await sessionIdPromise }));
  } catch {
    // No request scope — nothing to attach the event to.
  }
}
