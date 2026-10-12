import Link from "next/link";
import { BellIcon, CheckIcon, ShieldCheckIcon } from "@/components/ui/icons";
import { LogoMark } from "@/components/layout/logo-mark";
import { segmentClass, segmentTrack } from "@/components/ui/segmented";

interface AuthShellProps {
  title: string;
  intro?: React.ReactNode;
  /** Shows the "Đăng nhập | Đăng ký" switch with this segment selected. */
  tab?: "login" | "register";
  next?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Only things the product actually does today — no invented numbers. */
const BENEFITS = [
  { icon: CheckIcon, text: "Theo dõi giá tối đa 50 sản phẩm bạn quan tâm." },
  { icon: BellIcon, text: "Nhận thông báo qua email hoặc trình duyệt khi giá xuống tới mức bạn muốn." },
  { icon: ShieldCheckIcon, text: "Xuất hoặc xóa dữ liệu của bạn bất cứ lúc nào." },
];

function withNext(path: string, next?: string) {
  return next && next !== "/" ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/**
 * Two columns on a measuring-grid page: the form card (logo, optional "Đăng nhập | Đăng ký" switch,
 * title, form) and, beside it on wide screens, a night panel with what an account gets you and an
 * illustrated price alert. Phones show the form first and the list under it.
 */
export function AuthShell({ title, intro, tab, next, children, footer }: AuthShellProps) {
  return (
    <main className="relative flex w-full flex-1 items-center overflow-hidden">
      <div
        aria-hidden="true"
        className="bg-ledger pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_70%_at_50%_40%,black,transparent_85%)]"
      />
      <div className="relative mx-auto grid w-full max-w-[1080px] grid-cols-1 items-stretch gap-5 px-4 py-8 min-[760px]:py-16 lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-0">
        <section className="rounded-hero border border-line bg-surface px-5 py-7 shadow-lift min-[760px]:px-10 min-[760px]:py-10 lg:order-2 lg:rounded-l-none lg:border-l-0">
          <LogoMark className="size-11" />

          {tab && (
            <nav aria-label="Đăng nhập hoặc tạo tài khoản" className={segmentTrack({ display: "grid", className: "mt-7 grid-cols-2" })}>
              <TabLink href={withNext("/login", next)} active={tab === "login"}>
                Đăng nhập
              </TabLink>
              <TabLink href={withNext("/register", next)} active={tab === "register"}>
                Đăng ký
              </TabLink>
            </nav>
          )}

          <h1 className="display mt-7 text-h2 font-semibold leading-[1.12] text-balance text-ink max-[760px]:text-price-input">{title}</h1>
          {intro && <div className="mt-2 text-control leading-relaxed text-ink-2 text-pretty">{intro}</div>}

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-7 border-t border-line pt-5 text-body-sm leading-relaxed text-ink-2">{footer}</div>}
        </section>

        <aside
          aria-label="Tài khoản DealScore cho bạn"
          className="scope-night flex flex-col justify-between gap-10 rounded-hero bg-night p-6 text-night-ink-2 min-[760px]:p-10 lg:order-1 lg:rounded-r-none"
        >
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-night-ink-3">Tài khoản DealScore</span>
            <p className="display text-h3 font-semibold leading-snug text-night-ink min-[760px]:text-h2-sm">
              Để giá tự báo cho bạn, thay vì bạn ngồi canh giá.
            </p>
          </div>

          {/* Illustration of an alert (sample numbers, labelled), so the promise has a shape */}
          <div aria-hidden="true" className="flex flex-col gap-3 max-lg:hidden">
            <div className="flex items-start gap-3 rounded-tile border border-night-line bg-night-2 p-4 shadow-lift">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
                <BellIcon className="size-4.5" strokeWidth={2.2} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-micro text-night-ink-3">
                  <span>DealScore · vừa xong</span>
                  <span className="eyebrow">Ví dụ</span>
                </span>
                <span className="text-body-sm font-semibold text-night-ink">Giá đã chạm mức bạn đặt</span>
                <span className="text-label text-night-ink-2">
                  Tai nghe chống ồn · <span className="num font-semibold text-night-ink">2.090.000đ</span> · Nên mua
                </span>
              </div>
            </div>
            <div className="mx-4 flex items-center gap-3 rounded-tile border border-night-line/60 bg-night-2/50 px-4 py-3">
              <span className="size-2 rounded-full bg-buy" />
              <span className="text-label text-night-ink-3">Thấp hơn trung vị 30 ngày 14%</span>
            </div>
          </div>

          <ul className="flex flex-col gap-4">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-body-sm leading-snug">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-night-2 text-accent ring-1 ring-night-line">
                  <Icon className="size-4" strokeWidth={2.2} />
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-night-line pt-4 text-label leading-relaxed text-night-ink-3">
            DealScore trung lập giữa các sàn. Hoa hồng tiếp thị không nằm trong phép tính Deal Score.
          </p>
        </aside>
      </div>
    </main>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={segmentClass(active, { size: "lg" })}
    >
      {children}
    </Link>
  );
}
