import { describe, expect, it } from "vitest";
import {
  groupByFolder,
  nextSortOrder,
  sortFolders,
  validateFolderName,
  type WatchFolder,
} from "@/lib/watch/folders";

const folders: WatchFolder[] = [
  { id: "f2", name: "Skincare", sortOrder: 1 },
  { id: "f1", name: "Nhà bếp", sortOrder: 0 },
  { id: "f3", name: "Trống", sortOrder: 2 },
];

describe("validateFolderName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(validateFolderName("  Quà   tặng  ")).toEqual({ ok: true, value: "Quà tặng" });
  });

  it.each([["", "empty"], ["   ", "spaces only"], [undefined, "not a string"], [42, "number"]] as Array<[unknown, string]>)(
    "%s (%s) → error",
    (name) => {
      const r = validateFolderName(name);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/tên thư mục/);
    },
  );

  it("1 and 40 characters are fine; 41 is too long", () => {
    expect(validateFolderName("a").ok).toBe(true);
    expect(validateFolderName("a".repeat(40)).ok).toBe(true);
    const r = validateFolderName("a".repeat(41));
    expect(!r.ok && r.error).toMatch(/40 ký tự/);
  });

  it("duplicate names are rejected case-insensitively (Vietnamese too)", () => {
    expect(validateFolderName("skincare", folders).ok).toBe(false);
    const r = validateFolderName("NHÀ BẾP", folders);
    expect(!r.ok && r.error).toMatch(/đã có/);
  });

  it("NFD input matches an NFC name", () => {
    expect(validateFolderName("Nhà bếp".normalize("NFD"), folders).ok).toBe(false);
  });

  it("rename: the folder may keep its own name or change its case", () => {
    expect(validateFolderName("SKINCARE", folders, "f2")).toEqual({ ok: true, value: "SKINCARE" });
    expect(validateFolderName("Skincare", folders, "f1").ok).toBe(false);
  });
});

describe("sortFolders / nextSortOrder", () => {
  it("orders by sort_order", () => {
    expect(sortFolders(folders).map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });
  it("new folder goes after the last one; 0 when none", () => {
    expect(nextSortOrder(folders)).toBe(3);
    expect(nextSortOrder([])).toBe(0);
  });
});

describe("groupByFolder", () => {
  const items = [
    { id: "a", folderId: "f1" },
    { id: "b", folderId: null },
    { id: "c", folderId: "f2" },
    { id: "d", folderId: "f1" },
    { id: "e", folderId: "deleted-folder" },
  ];

  it("counts all, unfiled and each folder (in folder order, empty folders kept)", () => {
    const g = groupByFolder(items, folders);
    expect(g.all.count).toBe(5);
    expect(g.byFolder.map((x) => [x.folder.id, x.count, x.items.map((i) => i.id)])).toEqual([
      ["f1", 2, ["a", "d"]],
      ["f2", 1, ["c"]],
      ["f3", 0, []],
    ]);
  });

  it("an item whose folder no longer exists is unfiled", () => {
    const g = groupByFolder(items, folders);
    expect(g.unfiled.items.map((i) => i.id)).toEqual(["b", "e"]);
    expect(g.unfiled.count).toBe(2);
  });

  it("every item lands in exactly one of unfiled / a folder", () => {
    const g = groupByFolder(items, folders);
    expect(g.unfiled.count + g.byFolder.reduce((s, x) => s + x.count, 0)).toBe(g.all.count);
  });

  it("no folders → everything unfiled", () => {
    const g = groupByFolder(items, []);
    expect(g.byFolder).toEqual([]);
    expect(g.unfiled.count).toBe(5);
  });
});
