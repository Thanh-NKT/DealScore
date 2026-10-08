"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { deleteSavedSearch, updateSavedSearch } from "@/actions/saved-search";
import { unfollowDemand } from "@/actions/demand-follow";
import { SaveSearchDialog } from "@/components/search/save-search-dialog";
import { Button } from "@/components/ui/button";
import { segmentClass } from "@/components/ui/segmented";

export interface SavedSearchRowView {
  id: string;
  name: string;
  parts: string[];
  conditionLine: string;
  statusLine: string;
  status: "active" | "paused";
  resultsHref: string;
  defaultName: string;
  maxPrice: number | null;
  onlyBuy: boolean;
}

export interface DemandFollowRowView {
  id: string;
  keyword: string;
  status: "waiting" | "found" | "expired";
  line: string;
  resultsHref: string;
}

const CARD = "flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs";

function SavedSearchRow({ row }: { row: SavedSearchRowView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: boolean }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await work();
        if (!r.ok) setError("Chưa lưu được. Thử lại sau ít phút.");
        else router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError("Chưa lưu được. Thử lại sau ít phút.");
      }
    });
  };
  return (
    <li className={CARD}>
      <div className="min-w-0 space-y-1.5">
        <p className="text-body font-semibold text-ink">{row.name}</p>
        {row.parts.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {row.parts.map((p) => (
              <li key={p} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-label text-ink-2">
                {p}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="num text-body-sm text-ink-2">{row.conditionLine}</p>
        <p className="text-micro text-ink-3">{row.statusLine}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={row.resultsHref} className="inline-flex min-h-10 items-center px-1 text-body-sm font-semibold text-primary underline underline-offset-4">
          Xem kết quả
        </Link>
        <div role="group" aria-label="Trạng thái" className="inline-flex rounded-md border border-line-strong p-0.5">
          {(["active", "paused"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={row.status === s}
              disabled={pending}
              onClick={() => row.status !== s && run(() => updateSavedSearch(row.id, { status: s }))}
              className={segmentClass(row.status === s)}
            >
              {s === "active" ? "Đang bật" : "Tạm dừng"}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Sửa
        </Button>
        {confirmDelete ? (
          <>
            <Button variant="danger" size="sm" busy={pending} onClick={() => run(() => deleteSavedSearch(row.id))}>
              Xóa hẳn
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
              Giữ lại
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
            Xóa
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-body-sm font-semibold text-avoid">
          {error}
        </p>
      ) : null}
      {editing ? (
        <SaveSearchDialog
          mode={{ kind: "edit", id: row.id, name: row.name }}
          parts={row.parts}
          defaultName={row.defaultName}
          maxPrice={row.maxPrice}
          onlyBuy={row.onlyBuy}
          open
          onClose={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

export function SavedSearchList({ rows }: { rows: SavedSearchRowView[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong p-5 text-body-sm text-ink-3">
        Chưa có tìm kiếm nào. Bấm “Lưu tìm kiếm” trên trang kết quả để nhận báo.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <SavedSearchRow key={r.id} row={r} />
      ))}
    </ul>
  );
}

function DemandRow({ row }: { row: DemandFollowRowView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  return (
    <li className={`${CARD} sm:flex-row sm:items-center sm:justify-between`}>
      <div className="min-w-0">
        <p className="text-body font-semibold text-ink">“{row.keyword}”</p>
        <p className={`text-body-sm ${row.status === "found" ? "font-semibold text-buy" : "text-ink-3"}`}>{row.line}</p>
        {error ? (
          <p role="alert" className="text-body-sm font-semibold text-avoid">
            Chưa xóa được. Thử lại sau ít phút.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.status === "found" ? (
          <Link href={row.resultsHref} className="inline-flex min-h-10 items-center px-1 text-body-sm font-semibold text-primary underline underline-offset-4">
            Xem kết quả
          </Link>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          busy={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const r = await unfollowDemand(row.id);
                if (r.ok) router.refresh();
                else setError(true);
              } catch (err) {
                unstable_rethrow(err);
                setError(true);
              }
            })
          }
        >
          {row.status === "waiting" ? "Hủy" : "Xóa"}
        </Button>
      </div>
    </li>
  );
}

export function DemandFollowList({ rows }: { rows: DemandFollowRowView[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <DemandRow key={r.id} row={r} />
      ))}
    </ul>
  );
}
