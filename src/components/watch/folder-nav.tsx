"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { createFolder, deleteFolder, renameFolder } from "@/actions/watch";
import { MAX_FOLDERS, MAX_FOLDER_NAME_LENGTH, validateFolderName, type WatchFolder } from "@/lib/watch/folders";
import { FolderIcon, LinkIcon } from "@/components/ui/icons";
import { ShareFolderDialog } from "@/components/watch/share-folder-dialog";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

/** "all" | "unfiled" | a folder id. */
export type FolderFilter = string;
export const ALL = "all";
export const UNFILED = "unfiled";

interface FolderNavProps {
  folders: WatchFolder[];
  counts: { all: number; unfiled: number; byFolder: Record<string, number> };
  selected: FolderFilter;
  onSelect: (f: FolderFilter) => void;
}

const rowClass = (isSelected: boolean) =>
  `flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 text-left text-body-sm transition-colors ${
    isSelected ? "bg-surface-2 font-bold text-ink" : "bg-transparent font-medium text-ink-2 hover:bg-canvas hover:text-ink"
  }`;
const nameInputClass = inputClass({ size: "sm" });
const smallBtn = buttonClass({ variant: "secondary", size: "sm" });
const smallPrimary = buttonClass({ size: "sm" });

const FALLBACK_ERROR = "Chưa lưu được thư mục. Hãy thử lại.";

/**
 * Folder sidebar: "Tất cả", the user's folders (from the DB, in sort order, with counts) and
 * "Chưa xếp thư mục". Create inline; rename / delete from a small per-folder menu.
 */
export function FolderNav({ folders, counts, selected, onSelect }: FolderNavProps) {
  const uid = useId();
  const [mode, setMode] = useState<null | { kind: "create" } | { kind: "rename"; id: string } | { kind: "delete"; id: string }>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const shareFolderRow = folders.find((f) => f.id === shareFor) ?? null;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setMode(null);
    setName("");
    setError(null);
  };

  const run = (work: () => Promise<{ status: "ok" } | { status: "error"; error: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await work();
        if (r.status === "error") {
          setError(r.error);
          return;
        }
        after?.();
        close();
      } catch (err) {
        unstable_rethrow(err);
        setError(FALLBACK_ERROR);
      }
    });
  };

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    if (!mode || mode.kind === "delete") return;
    const renamingId = mode.kind === "rename" ? mode.id : undefined;
    const check = validateFolderName(name, folders, renamingId);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (renamingId) run(() => renameFolder(renamingId, check.value));
    else
      run(async () => {
        const r = await createFolder(check.value);
        if (r.status === "ok" && r.folder) onSelect(r.folder.id);
        return r;
      });
  };

  const nameForm = (label: string, submitLabel: string) => (
    <form onSubmit={submitName} className="flex flex-col gap-2 rounded-md bg-surface-2 p-2.5">
      <label htmlFor={`${uid}-name`} className="text-label font-semibold text-ink">
        {label}
      </label>
      <input
        id={`${uid}-name`}
        autoFocus
        value={name}
        maxLength={MAX_FOLDER_NAME_LENGTH + 10}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        placeholder="Ví dụ: Nhà bếp"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${uid}-error` : undefined}
        className={nameInputClass}
      />
      {error && (
        <p id={`${uid}-error`} role="alert" className="text-label font-semibold text-avoid">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={close} className={`${smallBtn} flex-1`}>
          Hủy
        </button>
        <button type="submit" disabled={pending} className={`${smallPrimary} flex-1`}>
          {pending ? "Đang lưu…" : submitLabel}
        </button>
      </div>
    </form>
  );

  return (
    <nav aria-label="Thư mục" className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <span className="px-3 pb-2 pt-1 text-label font-bold text-ink-3">Thư mục</span>

      <FolderRow label="Tất cả" count={counts.all} selected={selected === ALL} onSelect={() => onSelect(ALL)} />

      {folders.map((f) => {
        if (mode?.kind === "rename" && mode.id === f.id) {
          return <div key={f.id}>{nameForm(`Đổi tên “${f.name}”`, "Lưu")}</div>;
        }
        if (mode?.kind === "delete" && mode.id === f.id) {
          return (
            <div key={f.id} role="alert" className="flex flex-col gap-2 rounded-md bg-surface-2 p-2.5">
              <p className="text-label text-ink">
                Xóa thư mục <b>“{f.name}”</b>? Các theo dõi bên trong vẫn được giữ và chuyển sang “Chưa xếp thư mục”.
              </p>
              {error && <p className="text-label font-semibold text-avoid">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={close} autoFocus className={`${smallBtn} flex-1`}>
                  Giữ lại
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deleteFolder(f.id), () => selected === f.id && onSelect(ALL))}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-avoid/70 bg-surface px-3 text-label font-semibold text-avoid transition-colors hover:bg-avoid-soft disabled:border-line disabled:text-ink-3"
                >
                  {pending ? "Đang xóa…" : "Xóa thư mục"}
                </button>
              </div>
            </div>
          );
        }
        return (
          <FolderRow
            key={f.id}
            label={f.name}
            count={counts.byFolder[f.id] ?? 0}
            selected={selected === f.id}
            onSelect={() => onSelect(f.id)}
            shared={Boolean(f.share)}
            menu={{
              onShare: () => {
                setMenuFor(null);
                setShareFor(f.id);
              },
              open: menuFor === f.id,
              setOpen: (open) => setMenuFor(open ? f.id : null),
              onRename: () => {
                setMenuFor(null);
                setError(null);
                setName(f.name);
                setMode({ kind: "rename", id: f.id });
              },
              onDelete: () => {
                setMenuFor(null);
                setError(null);
                setMode({ kind: "delete", id: f.id });
              },
            }}
          />
        );
      })}

      <FolderRow
        label="Chưa xếp thư mục"
        count={counts.unfiled}
        selected={selected === UNFILED}
        onSelect={() => onSelect(UNFILED)}
      />

      {mode?.kind === "create" ? (
        <div className="mt-1">{nameForm("Tên thư mục mới", "Tạo")}</div>
      ) : (
        <button
          type="button"
          disabled={folders.length >= MAX_FOLDERS}
          onClick={() => {
            setError(null);
            setName("");
            setMode({ kind: "create" });
          }}
          className="mt-1 flex h-11 items-center gap-2.5 rounded-md border border-dashed border-line-strong px-3 text-body-sm font-medium text-ink-2 transition-colors hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{folders.length >= MAX_FOLDERS ? `Đã đủ ${MAX_FOLDERS} thư mục` : "Tạo thư mục"}</span>
        </button>
      )}
      {shareFolderRow ? (
        <ShareFolderDialog key={shareFolderRow.id} folder={shareFolderRow} open onClose={() => setShareFor(null)} />
      ) : null}
    </nav>
  );
}

function FolderRow({
  label,
  count,
  selected,
  onSelect,
  menu,
  shared = false,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
  shared?: boolean;
  menu?: { open: boolean; setOpen: (open: boolean) => void; onRename: () => void; onDelete: () => void; onShare?: () => void };
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menu?.open ?? false;
  const setOpen = menu?.setOpen;

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen || !setOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, setOpen]);

  return (
    <div ref={menuRef} className="relative flex items-center gap-1">
      <button type="button" onClick={onSelect} aria-pressed={selected} className={rowClass(selected)}>
        <FolderIcon className="size-[18px] shrink-0 text-ink-2" />
        <span className="flex-1 truncate">{label}</span>
        {shared ? (
          <>
            <LinkIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
            <span className="sr-only">đang chia sẻ</span>
          </>
        ) : null}
        <span className="text-label text-ink-3">{count}</span>
      </button>
      {menu && (
        <>
          <button
            type="button"
            aria-label={`Tùy chọn thư mục ${label}`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={() => menu.setOpen(!menu.open)}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-canvas hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.75" />
              <circle cx="12" cy="12" r="1.75" />
              <circle cx="19" cy="12" r="1.75" />
            </svg>
          </button>
          {menu.open && (
            <div role="menu" className="absolute right-0 top-11 z-20 flex w-48 flex-col rounded-md border border-line bg-surface p-1 shadow-lift">
              <button role="menuitem" type="button" autoFocus onClick={menu.onRename} className="h-10 rounded-sm px-3 text-left text-body-sm font-medium text-ink hover:bg-surface-2">
                Đổi tên
              </button>
              {menu.onShare ? (
                <button role="menuitem" type="button" onClick={menu.onShare} className="h-10 rounded-sm px-3 text-left text-body-sm font-medium text-ink hover:bg-surface-2">
                  Chia sẻ thư mục…
                </button>
              ) : null}
              <button role="menuitem" type="button" onClick={menu.onDelete} className="h-10 rounded-sm px-3 text-left text-body-sm font-medium text-avoid hover:bg-avoid-soft">
                Xóa thư mục
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
