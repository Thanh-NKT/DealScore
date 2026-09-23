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
      title: "Supabase not connected",
      body: (
        <>
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>,
          then restart the dev server.
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
        title: "Connected, but no schema yet",
        body: (
          <>
            Connected, but querying the <code>products</code> table failed:{" "}
            <span className="opacity-80">{error.message}</span>. Run the
            migration <code>supabase/migrations/0001_init.sql</code>.
          </>
        ),
      };
    }

    return {
      tone: "ok",
      title: "Supabase is ready",
      body: (
        <>
          Connected. The catalog has <strong>{count ?? 0}</strong> normalized
          products.
        </>
      ),
    };
  } catch (e) {
    return {
      tone: "warn",
      title: "Could not reach Supabase",
      body: <>{(e as Error).message}</>,
    };
  }
}

/**
 * Server Component: checks the Supabase connection and renders its status (dev only).
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
