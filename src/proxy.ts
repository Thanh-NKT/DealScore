import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: convention "proxy" (thay cho "middleware" đã deprecated).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Áp dụng cho mọi request trừ:
     * - _next/static, _next/image
     * - favicon.ico, các file ảnh tĩnh
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
