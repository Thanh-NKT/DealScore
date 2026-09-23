"use client";

import { useState, useEffect, useRef, type KeyboardEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { normalizeLookupInput, parseShopeeUrl } from "@/lib/shopee/parse-url";
import { formatVnd } from "@/lib/format";

interface Suggestion {
  productId: string;
  slug: string;
  categorySlug: string;
  name: string;
  brand: string | null;
  image: string | null;
  bestPrice: number | null;
}

interface SearchBoxProps {
  initialQuery?: string;
}

export function SearchBox({ initialQuery = "" }: SearchBoxProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Kiểm tra nếu query là một Shopee URL
  const isShopeeUrl = (() => {
    if (!query) return false;
    // Chuẩn hóa như server: nhận cả đoạn văn bản chia sẻ từ app Shopee.
    const parsed = parseShopeeUrl(normalizeLookupInput(query));
    return parsed.ok || parsed.reason === "needs_redirect";
  })();

  const visibleSuggestions = !isShopeeUrl && query.trim().length >= 2 ? suggestions : [];
  const showDropdown = isOpen && visibleSuggestions.length > 0;

  // Debounced Autocomplete
  useEffect(() => {
    if (isShopeeUrl || query.trim().length < 2) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.slice(0, 8));
          setIsOpen(data.length > 0);
          setActiveIndex(-1);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("Autocomplete fetch error:", err);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isShopeeUrl]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || visibleSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < visibleSuggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : visibleSuggestions.length - 1));
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const selected = visibleSuggestions[activeIndex];
      if (selected) {
        router.push(`/${selected.categorySlug}/${selected.slug}`);
        setIsOpen(false);
      }
    }
  };

  const handleFormSubmit = async (e: FormEvent) => {
    if (isShopeeUrl) {
      e.preventDefault();
      if (submitting) return;
      // Chuyển sang luồng URL lookup
      setLookupError(null);
      try {
        setSubmitting(true);
        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: query.trim() }),
        });
        const data = await res.json();
        if (res.ok && data.productUrl) {
          router.push(data.productUrl);
        } else {
          // Hiện đúng lỗi server trả về. Chuyển sang trang tìm kiếm với
          // chính URL làm từ khóa chỉ ra "không tìm thấy" và làm mất lý do thật
          // (vd bị giới hạn lượt tra cứu).
          setLookupError(data?.message || "Có lỗi xảy ra. Vui lòng thử lại.");
        }
      } catch {
        setLookupError("Có lỗi xảy ra. Vui lòng thử lại.");
      } finally {
        setSubmitting(false);
      }
    }
    // Ngược lại để form submit bình thường tới /tim-kiem?q=...
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <form
        action="/tim-kiem"
        method="get"
        onSubmit={handleFormSubmit}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <input
            type="text"
            name="q"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              setLookupError(null);
              if (val.trim().length < 2) {
                setIsOpen(false);
              }
            }}
            onFocus={() => {
              if (visibleSuggestions.length > 0) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            aria-controls="autocomplete-listbox"
            aria-activedescendant={
              activeIndex >= 0 ? `suggestion-item-${activeIndex}` : undefined
            }
            aria-busy={loading}
            placeholder="Tìm theo tên sản phẩm, hãng, model hoặc dán link Shopee..."
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="disabled:opacity-60 rounded-xl border border-foreground bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:opacity-90 active:scale-95"
        >
          {isShopeeUrl ? "Kiểm tra giá" : "Tìm kiếm"}
        </button>
      </form>

      {lookupError && (
        <p role="alert" className="mt-2 text-xs text-rec-avoid">
          {lookupError}
        </p>
      )}

      {/* Danh sách gợi ý Autocomplete */}
      {showDropdown && (
        <ul
          id="autocomplete-listbox"
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-border bg-background py-1.5 shadow-lg"
        >
          {visibleSuggestions.map((item, idx) => {
            const isActive = idx === activeIndex;
            return (
              <li
                key={item.productId}
                id={`suggestion-item-${idx}`}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  router.push(`/${item.categorySlug}/${item.slug}`);
                  setIsOpen(false);
                }}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "hover:bg-black/5 dark:hover:bg-white/5 text-foreground"
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="truncate">
                    <div className="font-semibold truncate">{item.name}</div>
                    {item.brand && (
                      <div
                        className={`text-[10px] ${
                          isActive ? "opacity-80" : "text-muted"
                        }`}
                      >
                        {item.brand}
                      </div>
                    )}
                  </div>
                </div>

                {item.bestPrice != null && (
                  <span className="shrink-0 font-bold">
                    {formatVnd(item.bestPrice)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
