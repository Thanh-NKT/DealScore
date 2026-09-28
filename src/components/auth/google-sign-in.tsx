import { signInWithGoogle } from "@/actions/oauth";

/** Google's four-colour "G" — required by Google's sign-in branding, the one logo allowed on these pages. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
    </svg>
  );
}

/**
 * "Tiếp tục với Google" (Phase 2). A plain form posting a Server Action, so it works without JS.
 * Secondary button style: the email form below stays the main path for most users.
 */
export function GoogleSignIn({ next, label = "Tiếp tục với Google" }: { next: string; label?: string }) {
  return (
    <div className="space-y-4">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-md border border-line-strong bg-surface px-4 text-[15px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2"
        >
          <GoogleMark />
          {label}
        </button>
      </form>
      <p className="flex items-center gap-3 text-[13px] text-ink-3" role="separator" aria-label="hoặc dùng email">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        hoặc dùng email
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </p>
    </div>
  );
}
