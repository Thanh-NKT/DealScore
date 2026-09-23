import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`test:db thiếu biến ${name} (đọc từ .env.local)`);
  return v;
}

export const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");

// Chặn cứng: test tạo / xóa user thật — không bao giờ chạy trên project thật.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SUPABASE_URL)) {
  throw new Error(`test:db chỉ chạy trên Supabase local, đang trỏ tới ${SUPABASE_URL}`);
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin = createClient<Database>(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"), noSession);

export interface TestUser {
  id: string;
  email: string;
  /** Client anon đã đăng nhập bằng user này — mọi query đi qua RLS. */
  client: SupabaseClient<Database>;
}

/**
 * Tạo user thật trong auth.users (trigger tạo luôn users + notification_settings).
 * Mật khẩu CHỈ dùng trong test; sản phẩm không có đăng nhập bằng mật khẩu.
 */
export async function createTestUser(): Promise<TestUser> {
  const email = `test-${randomUUID()}@kairo.test`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser thất bại");

  const client = createClient<Database>(SUPABASE_URL, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(id: string): Promise<void> {
  // Có thể đã bị job purge xóa trước — bỏ qua lỗi "không tìm thấy".
  await admin.auth.admin.deleteUser(id).catch(() => undefined);
}
