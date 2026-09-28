import { CheckIcon, DashIcon } from "@/components/ui/icons";

interface DealReasonsProps {
  reasons: string[];
}

/** The engine prefixes reasons with a glyph; the list draws its own icons instead. */
const PRO = /^\s*[✓✔☑]\s*/u;
const CON = /^\s*(?:⚠️?|[✗✘×!])\s*/u;
const MAX_REASONS = 6;

type Reason = { kind: "pro" | "con"; text: string };

function parseReasons(reasons: string[] | null | undefined): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const raw of reasons ?? []) {
    if (typeof raw !== "string") continue;
    const kind = PRO.test(raw) ? "pro" : "con";
    const text = raw.replace(PRO, "").replace(CON, "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ kind, text });
  }
  return out.slice(0, MAX_REASONS);
}

/**
 * Reasons list inside the "Vì sao N điểm?" card. Plain-language reasons from the engine: a check on
 * `buy-soft` for points in the buyer's favour, a dash on `surface-2` for neutral or unfavourable
 * ones. Glyph prefixes are stripped, duplicates and empty strings dropped, and the list is capped so
 * a noisy engine run can't flood the page.
 */
export function DealReasons({ reasons }: DealReasonsProps) {
  const items = parseReasons(reasons);
  if (items.length === 0) return null;

  return (
    <ul aria-label="Lý do" className="grid max-w-[68ch] gap-3.5">
      {items.map(({ kind, text }) => (
        <li key={text} className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-3 text-[14px] leading-normal text-ink">
          <span
            className={`grid size-[26px] place-items-center rounded-sm ${kind === "pro" ? "bg-buy-soft text-buy" : "bg-surface-2 text-ink-2"}`}
          >
            {kind === "pro" ? (
              <CheckIcon className="size-[15px]" strokeWidth={3} />
            ) : (
              <DashIcon className="size-[15px]" strokeWidth={3} />
            )}
          </span>
          <span className="self-center [overflow-wrap:anywhere]">
            <span className="sr-only">{kind === "pro" ? "Điểm có lợi: " : "Lưu ý: "}</span>
            {/[.!?…]$/.test(text) ? text : `${text}.`}
          </span>
        </li>
      ))}
    </ul>
  );
}
