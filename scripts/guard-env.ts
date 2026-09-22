/**
 * Chặn mọi script phá hủy dữ liệu chạy nhầm vào môi trường thật.
 *
 * seed-dev xóa sạch catalog trước khi chạy. Nếu lỡ chạy khi .env.local đang
 * trỏ sang project production thì mất toàn bộ dữ liệu — và không có bản sao.
 * Vì vậy chặn ở tầng code, không dựa vào việc người chạy nhớ kiểm tra.
 */

const LOCAL_HOST_PATTERNS = [
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/host\.docker\.internal(:\d+)?$/,
];

export interface LocalEnv {
  url: string;
  serviceKey: string;
}

/**
 * Trả về URL + service key, hoặc thoát tiến trình nếu không phải môi trường local.
 * Đặt ALLOW_DESTRUCTIVE_REMOTE=1 để bỏ qua — chỉ dùng khi thực sự có chủ đích.
 */
export function requireLocalSupabase(scriptName: string): LocalEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      `[${scriptName}] Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.`,
    );
    process.exit(1);
  }

  const origin = url.replace(/\/+$/, "");
  const isLocal = LOCAL_HOST_PATTERNS.some((re) => re.test(origin));

  if (!isLocal && process.env.ALLOW_DESTRUCTIVE_REMOTE !== "1") {
    console.error(
      `\n[${scriptName}] TỪ CHỐI CHẠY.\n\n` +
        `  Script này XÓA SẠCH catalog trước khi chạy.\n` +
        `  NEXT_PUBLIC_SUPABASE_URL đang trỏ tới: ${origin}\n` +
        `  Đây không phải Supabase local.\n\n` +
        `  Nếu thực sự muốn, đặt ALLOW_DESTRUCTIVE_REMOTE=1.\n`,
    );
    process.exit(1);
  }

  return { url: origin, serviceKey };
}
