import Link from "next/link";
import { InfoIcon } from "@/components/ui/icons";
import { explainLookup, RETRYABLE_LOOKUP, type LookupProblem as Problem } from "./use-lookup";
import { buttonClass } from "@/components/ui/button";

interface LookupProblemProps {
  problem: Problem;
  /** What the user typed, to offer "search by name" with it when it isn't a link. */
  input: string;
  onRetry: () => void;
}

/**
 * Calm problem card for the link lookup (inner box: surface-2, no red): what happened, what to do
 * next, and the next action — retry as the one primary button, "search by name" as secondary.
 */
export function LookupProblem({ problem, input, onRetry }: LookupProblemProps) {
  const { what, next } = explainLookup(problem);
  const text = input.trim();
  const searchText = text && !/https?:\/\//i.test(text) && !text.includes("/") ? text.slice(0, 200) : "";
  const offerSearch = problem.code === "not_a_url" || problem.code === "not_shopee";
  const retryable = RETRYABLE_LOOKUP.has(problem.code);

  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-3.5 text-body-sm leading-normal text-ink">
      <InfoIcon className="mt-px size-5 shrink-0 text-ink-2" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{what}</p>
        {next && <p className="max-w-[68ch] text-ink-2">{next}</p>}
        {(retryable || offerSearch) && (
          <div className="flex flex-wrap gap-2 pt-2">
            {retryable && (
              <button
                type="button"
                onClick={onRetry}
                className={buttonClass({ size: "sm" })}
              >
                Thử lại
              </button>
            )}
            {offerSearch && (
              <Link
                href={searchText ? `/search?q=${encodeURIComponent(searchText)}` : "/search"}
                className="inline-flex min-h-10 max-w-full items-center rounded-full border border-line-strong/60 bg-surface px-5 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out [overflow-wrap:anywhere] hover:bg-surface-2"
              >
                {searchText ? `Tìm “${searchText.length > 40 ? `${searchText.slice(0, 40)}…` : searchText}”` : "Tìm theo tên sản phẩm"}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
