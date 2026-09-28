import type { Metadata } from "next";
import Link from "next/link";
import { InfoIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư — Kairo",
};

/**
 * Placeholder until the legal text is written. It only states what the code actually stores
 * (tables in supabase/migrations) and the account tools that exist; keep it in sync with them.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[68ch] flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="display text-h1-sm font-extrabold leading-[1.1] text-balance text-ink sm:text-h1">Chính sách quyền riêng tư</h1>
      <p className="mt-5 flex items-start gap-2.5 rounded-md bg-surface-2 p-4 text-control leading-relaxed text-ink-2">
        <InfoIcon className="mt-0.5 size-5 text-ink" />
        <span>
        Văn bản đầy đủ đang được soạn. Dưới đây là bản tóm tắt những dữ liệu Kairo đang lưu và quyền của bạn với dữ liệu đó.</span>
      </p>

      <h2 className="display mt-10 text-h3 font-bold leading-tight text-ink max-[760px]:text-h4">Kairo lưu những gì</h2>
      <ul className="mt-3 list-disc space-y-2.5 pl-5 text-body leading-[1.6] text-ink marker:text-ink-3">
        <li>Email của bạn, để đăng nhập và gửi thông báo giá.</li>
        <li>Thời điểm bạn đồng ý với điều khoản, và bạn có muốn nhận email deal hay không.</li>
        <li>Cài đặt thông báo: kênh nhận (email, thông báo trình duyệt), giờ im lặng, tần suất.</li>
        <li>Các sản phẩm bạn theo dõi, điều kiện báo bạn đặt, và lịch sử các lần Kairo đã báo.</li>
        <li>Nếu bạn bật thông báo trình duyệt: địa chỉ nhận thông báo của trình duyệt và tên trình duyệt.</li>
        <li>Khi bạn bấm “Đến sàn”: sản phẩm được bấm, nguồn (web, email…) và một mã phiên, để đo liên kết tiếp thị.</li>
        <li>Khi bạn dán link tra cứu: kết quả tra cứu và một bản băm của địa chỉ IP để chống lạm dụng. Kairo không lưu địa chỉ IP gốc.</li>
      </ul>

      <h2 className="display mt-10 text-h3 font-bold leading-tight text-ink max-[760px]:text-h4">Quyền của bạn</h2>
      <ul className="mt-3 list-disc space-y-2.5 pl-5 text-body leading-[1.6] text-ink marker:text-ink-3">
        <li>
          Tải toàn bộ dữ liệu của bạn:{" "}
          <Link href="/account/export" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
            Xuất dữ liệu
          </Link>
          .
        </li>
        <li>
          Xóa tài khoản:{" "}
          <Link href="/account/delete" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
            Xóa tài khoản
          </Link>
          . Tài khoản được giữ 30 ngày để bạn có thể khôi phục, sau đó bị xóa hẳn. Nhật ký lượt bấm và tra cứu được giữ lại nhưng không còn gắn
          với tài khoản của bạn.
        </li>
        <li>Tắt email deal bất cứ lúc nào trong phần Thông báo của tài khoản.</li>
      </ul>
    </main>
  );
}
