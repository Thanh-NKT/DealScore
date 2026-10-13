"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { segmentClass, segmentTrack } from "@/components/ui/segmented";
import { AuthCardFooter, AuthCardHeading } from "./auth-card";
import { GoogleSignIn } from "./google-sign-in";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

export type AuthTab = "login" | "register";

const LINK = "font-semibold text-primary underline underline-offset-4 hover:text-primary-hover";

const PATH: Record<AuthTab, string> = { login: "/login", register: "/register" };

// Must match the pages' `metadata.title` (the client switch updates document.title itself).
export const AUTH_DOC_TITLE: Record<AuthTab, string> = {
  login: "Đăng nhập — DealScore",
  register: "Tạo tài khoản — DealScore",
};

function withNext(path: string, next: string) {
  return next && next !== "/" ? `${path}?next=${encodeURIComponent(next)}` : path;
}

function tabFromPath(pathname: string | null, fallback: AuthTab): AuthTab {
  if (pathname === PATH.login) return "login";
  if (pathname === PATH.register) return "register";
  return fallback;
}

/**
 * "Đăng nhập | Đăng ký" switch plus both forms. Switching is client-only: the URL changes through
 * history.pushState (Next keeps usePathname in sync, so Back/Forward work) without a server round
 * trip, and both forms stay mounted so whatever was typed survives a switch. The links keep real
 * hrefs, so a modified click or a no-JS visit still loads /login or /register.
 */
export function AuthTabs({
  initialTab,
  next,
  loginError,
  googleEnabled,
}: {
  initialTab: AuthTab;
  next: string;
  loginError?: string;
  googleEnabled: boolean;
}) {
  const tab = tabFromPath(usePathname(), initialTab);

  useEffect(() => {
    document.title = AUTH_DOC_TITLE[tab];
  }, [tab]);

  function select(e: React.MouseEvent<HTMLAnchorElement>, target: AuthTab) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (target !== tab) window.history.pushState(null, "", withNext(PATH[target], next));
  }

  return (
    <>
      <nav aria-label="Đăng nhập hoặc tạo tài khoản" className={segmentTrack({ display: "grid", className: "mt-7 grid-cols-2" })}>
        {(["login", "register"] as const).map((t) => (
          <Link
            key={t}
            href={withNext(PATH[t], next)}
            prefetch={false}
            onClick={(e) => select(e, t)}
            aria-current={tab === t ? "page" : undefined}
            className={segmentClass(tab === t, { size: "lg" })}
          >
            {t === "login" ? "Đăng nhập" : "Đăng ký"}
          </Link>
        ))}
      </nav>

      <div hidden={tab !== "login"}>
        <AuthCardHeading title="Chào mừng trở lại" intro="Đăng nhập để xem các sản phẩm bạn đang theo dõi giá." />
        <div className="mt-7">
          {googleEnabled && <GoogleSignIn next={next} />}
          <LoginForm initialNext={next} initialError={loginError} />
        </div>
        <AuthCardFooter>
          <p>
            Trước đây bạn đăng nhập bằng mã gửi qua email? Tài khoản đó chưa có mật khẩu, hãy chọn{" "}
            <Link href="/forgot-password" className={LINK}>
              Quên mật khẩu
            </Link>{" "}
            để tạo.
          </p>
        </AuthCardFooter>
      </div>

      <div hidden={tab !== "register"}>
        <AuthCardHeading
          title="Tạo tài khoản DealScore"
          intro="Miễn phí. DealScore gửi một thư để xác nhận email trước khi bạn bắt đầu theo dõi giá."
        />
        <div className="mt-7">
          {googleEnabled && <GoogleSignIn next={next} label="Đăng ký bằng Google" />}
          <RegisterForm initialNext={next} />
        </div>
        <AuthCardFooter>
          <p>
            Khi tạo tài khoản, bạn đồng ý với{" "}
            <Link href="/terms" className={LINK}>
              Điều khoản sử dụng
            </Link>{" "}
            và{" "}
            <Link href="/privacy" className={LINK}>
              Chính sách quyền riêng tư
            </Link>{" "}
            của DealScore.
          </p>
        </AuthCardFooter>
      </div>
    </>
  );
}
