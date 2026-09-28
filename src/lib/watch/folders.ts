/** Watch folders — pure helpers (no DB). The DB mirrors these rules (0014: check, unique index, trigger). */

export const MAX_FOLDERS = 20; // same as the watch_folders_enforce_limit trigger
export const MAX_FOLDER_NAME_LENGTH = 40; // same as the watch_folders name check

export interface WatchFolder {
  id: string;
  name: string;
  sortOrder: number;
}

export type FolderNameResult = { ok: true; value: string } | { ok: false; error: string };

/** Case-insensitive key used for the uniqueness check (DB: lower(btrim(name))). */
export function folderNameKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

/**
 * Trim, collapse inner whitespace, 1–40 characters, not a duplicate (case-insensitive) of another folder.
 * `ignoreId` is the folder being renamed, so keeping its own name (or changing only its case) is allowed.
 */
export function validateFolderName(
  raw: unknown,
  existing: ReadonlyArray<Pick<WatchFolder, "id" | "name">> = [],
  ignoreId?: string,
): FolderNameResult {
  if (typeof raw !== "string") return { ok: false, error: "Vui lòng nhập tên thư mục." };
  const value = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (value.length === 0) return { ok: false, error: "Vui lòng nhập tên thư mục." };
  if (value.length > MAX_FOLDER_NAME_LENGTH) {
    return { ok: false, error: `Tên thư mục tối đa ${MAX_FOLDER_NAME_LENGTH} ký tự.` };
  }
  const key = folderNameKey(value);
  if (existing.some((f) => f.id !== ignoreId && folderNameKey(f.name) === key)) {
    return { ok: false, error: "Bạn đã có thư mục với tên này." };
  }
  return { ok: true, value };
}

export function sortFolders<F extends WatchFolder>(folders: readonly F[]): F[] {
  return [...folders].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

/** sort_order for a new folder: after every existing one. */
export function nextSortOrder(folders: ReadonlyArray<Pick<WatchFolder, "sortOrder">>): number {
  return folders.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1;
}

export interface FolderGroups<T> {
  all: { items: T[]; count: number };
  unfiled: { items: T[]; count: number };
  byFolder: Array<{ folder: WatchFolder; items: T[]; count: number }>;
}

/**
 * Split items by folder, folders in sort order (empty folders included). An item whose folder no
 * longer exists counts as unfiled, so it never disappears from every group.
 */
export function groupByFolder<T extends { folderId: string | null }>(
  items: readonly T[],
  folders: readonly WatchFolder[],
): FolderGroups<T> {
  const ordered = sortFolders(folders);
  const buckets = new Map<string, T[]>(ordered.map((f) => [f.id, []]));
  const unfiled: T[] = [];
  for (const item of items) {
    const bucket = item.folderId ? buckets.get(item.folderId) : undefined;
    if (bucket) bucket.push(item);
    else unfiled.push(item);
  }
  return {
    all: { items: [...items], count: items.length },
    unfiled: { items: unfiled, count: unfiled.length },
    byFolder: ordered.map((folder) => {
      const list = buckets.get(folder.id)!;
      return { folder, items: list, count: list.length };
    }),
  };
}
