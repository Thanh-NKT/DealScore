import Link from "next/link";
import { BellIcon, CheckIcon, ShieldCheckIcon, TrendUpIcon } from "@/components/ui/icons";
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
 * One centred white card on the canvas: the DealScore logo tile (night square, lime trend stroke, same
 * as the header), an optional "Đăng nhập | Đăng ký" segmented switch, the title and the form. What an
 * account gets you sits quietly under the card.
 */
export function AuthShell({ title, intro, tab, next, children, footer }: AuthShellProps) {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center px-4 py-8 min-[760px]:py-14">
      <section className="rounded-lg border border-line bg-surface px-5 py-7 min-[760px]:px-9 min-[760px]:py-9">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-md bg-night text-accent">
          <TrendUpIcon className="size-6" strokeWidth={2.4} />
        </span>

        {tab && (
          <nav aria-label="Đăng nhập hoặc tạo tài khoản" className={segmentTrack({ display: "grid", className: "mt-6 grid-cols-2" })}>
            <TabLink href={withNext("/login", next)} active={tab === "login"}>
              Đăng nhập
            </TabLink>
            <TabLink href={withNext("/register", next)} active={tab === "register"}>
              Đăng ký
            </TabLink>
          </nav>
        )}

        <h1 className="display mt-6 text-h2 font-extrabold leading-[1.15] text-balance text-ink max-[760px]:text-price-input">{title}</h1>
        {intro && <div className="mt-2 text-control leading-relaxed text-ink-2 text-pretty">{intro}</div>}

        <div className="mt-7">{children}</div>

        {footer && <div className="mt-7 border-t border-line pt-5 text-body-sm leading-relaxed text-ink-2">{footer}</div>}
      </section>

      <ul className="mt-6 space-y-3 px-1">
        {BENEFITS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-body-sm leading-snug text-ink-2">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-ink">
              <Icon className="size-4" strokeWidth={2} />
            </span>
            <span className="pt-1">{text}</span>
          </li>
        ))}
      </ul>
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
