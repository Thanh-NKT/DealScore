import { createClient } from "@/lib/supabase/server";

type Status =
  | { tone: "warn"; title: string; body: React.ReactNode }
  | { tone: "ok"; title: string; body: React.ReactNode };

async function getStatus(): Promise<Status> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      tone: "warn",
      title: "Chưa kết nối Supabase",
      body: (
        <>
          Điền <code>NEXT_PUBLIC_SUPABASE_URL</code> và{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> vào <code>.env.local</code>,
          sau đó khởi động lại dev server.
        </>
      ),
    };
  }

  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true });

    if (error) {
      return {
        tone: "warn",
        title: "Đã kết nối, nhưng chưa có schema",
        body: (
          <>
            Kết nối OK nhưng truy vấn bảng <code>products</code> lỗi:{" "}
            <span className="opacity-80">{error.message}</span>. Hãy chạy
            migration <code>supabase/migrations/0001_init.sql</code>.
          </>
        ),
      };
    }

    return {
      tone: "ok",
      title: "Supabase đã sẵn sàng",
      body: (
        <>
          Kết nối thành công. Catalog hiện có <strong>{count ?? 0}</strong> sản
          phẩm chuẩn hóa.
        </>
      ),
    };
  } catch (e) {
    return {
      tone: "warn",
      title: "Không gọi được Supabase",
      body: <>{(e as Error).message}</>,
    };
  }
}

/**
 * Server Component: kiểm tra kết nối Supabase và hiển thị trạng thái.
 */
export default async function SupabaseStatus() {
  const status = await getStatus();
  const styles =
    status.tone === "ok"
      ? "border-green-500/40 bg-green-500/5"
      : "border-amber-500/40 bg-amber-500/5";

  return (
    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${styles}`}>
      <div className="mb-1 font-semibold">
        {status.tone === "ok" ? "🟢 " : "🟡 "}
        {status.title}
      </div>
      <div className="opacity-90 [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 dark:[&_code]:bg-white/10">
        {status.body}
      </div>
    </div>
  );
}
