/** Card heading and footer shared by AuthShell (server) and AuthTabs (client). */
export function AuthCardHeading({ title, intro }: { title: string; intro?: React.ReactNode }) {
  return (
    <>
      <h1 className="display mt-7 text-h2 font-semibold leading-[1.12] text-balance text-ink max-[760px]:text-price-input">{title}</h1>
      {intro && <div className="mt-2 text-control leading-relaxed text-ink-2 text-pretty">{intro}</div>}
    </>
  );
}

export function AuthCardFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-7 border-t border-line pt-5 text-body-sm leading-relaxed text-ink-2">{children}</div>;
}
