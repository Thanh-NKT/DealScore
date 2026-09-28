import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`test:db missing variable ${name} (read from .env.local)`);
  return v;
}

export const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");

// Hard stop: these tests create / delete real users — never run against a real project.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SUPABASE_URL)) {
  throw new Error(`test:db only runs against a local Supabase, currently pointing at ${SUPABASE_URL}`);
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin = createClient<Database>(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"), noSession);

export interface TestUser {
  id: string;
  email: string;
  /** Anon client signed in as this user — every query goes through RLS. */
  client: SupabaseClient<Database>;
}

/**
 * Create a real user in auth.users (the trigger also creates users + notification_settings).
 * Random password that satisfies the letters_digits rule in config.toml.
 */
export async function createTestUser(): Promise<TestUser> {
  const email = `test-${randomUUID()}@kairo.test`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const client = createClient<Database>(SUPABASE_URL, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(id: string): Promise<void> {
  // May already have been removed by the purge job — ignore "not found" errors.
  await admin.auth.admin.deleteUser(id).catch(() => undefined);
}
