import type { Metadata } from "next";
import Link from "next/link";
import { InfoIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng — DealScore",
};

/** Placeholder until the legal text is written. Only states commitments PRODUCT.md already makes. */
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-[68ch] flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="display text-h1-sm font-semibold leading-[1.1] text-balance text-ink sm:text-h1">Điều khoản sử dụng</h1>
      <p className="mt-5 flex items-start gap-2.5 rounded-md bg-surface-2 p-4 text-control leading-relaxed text-ink-2">
        <InfoIcon className="mt-0.5 size-5 text-ink" />
        <span>
        Văn bản đầy đủ đang được soạn. Dưới đây là những cam kết chính của DealScore.</span>
      </p>
      <ul className="mt-6 list-disc space-y-2.5 pl-5 text-body leading-[1.6] text-ink marker:text-ink-3">
        <li>
          Giá, Deal Score và kết luận Nên mua / Có thể chờ / Chưa nên mua là thông tin tham khảo, tính từ giá hệ thống ghi nhận được, không phải lời
          khuyên tài chính và không hứa giá sẽ tăng hay giảm.
        </li>
        <li>Giá sau voucher chỉ là ước tính; DealScore không bảo đảm bạn nhận được voucher.</li>
        <li>
          Một số liên kết là liên kết tiếp thị: nếu bạn mua qua đó, DealScore có thể nhận hoa hồng. Việc này không làm thay đổi giá bạn trả, và không ảnh
          hưởng tới Deal Score hay thứ tự hiển thị.
        </li>
        <li>Việc mua hàng diễn ra trên sàn thương mại điện tử và theo điều khoản của sàn đó.</li>
      </ul>
      <p className="mt-8 text-body leading-[1.6] text-ink-2">
        Về dữ liệu cá nhân, xem{" "}
        <Link href="/privacy" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
          Chính sách quyền riêng tư
        </Link>
        .
      </p>
    </main>
  );
}
