import { describe, expect, it } from "vitest";
import {
  expandQuery,
  MAX_ALTERNATIVES,
  MAX_TERM_GROUPS,
  SYNONYM_RULES,
} from "@/lib/search/synonyms";
import { CATEGORY_SYNONYMS } from "@/lib/intent/lexicon";

describe("expandQuery — category words", () => {
  it("'tai nghe sony' → an OR-group for the phrase, the brand alone", () => {
    const groups = expandQuery("tai nghe sony")!;
    expect(groups).toHaveLength(2);
    expect(groups[0][0]).toBe("tai nghe");
    expect(groups[0]).toEqual(expect.arrayContaining(["headphone", "earbuds"]));
    expect(groups[1]).toEqual(["sony"]);
  });

  it("works both ways: 'headphone' reaches 'tai nghe'", () => {
    const [group] = expandQuery("Headphone")!;
    expect(group[0]).toBe("headphone");
    expect(group).toContain("tai nghe");
  });

  it("folds diacritics before matching ('Tai nghe', 'Điện thoại')", () => {
    expect(expandQuery("Tai nghe")![0]).toContain("headphone");
    expect(expandQuery("Điện thoại")![0]).toEqual(expect.arrayContaining(["dien thoai", "phone", "smartphone"]));
  });

  it("'dt' / 'đt' expand to phone words; the abbreviation is never offered as an alternative", () => {
    expect(expandQuery("dt samsung")).toEqual([
      ["dt", "dien thoai", "phone", "smartphone"],
      ["samsung"],
    ]);
    expect(expandQuery("đt")).toEqual([["dt", "dien thoai", "phone", "smartphone"]]);
    expect(expandQuery("smartphone")![0]).not.toContain("dt");
  });

  it("longest phrase wins ('sac du phong' before any shorter rule)", () => {
    expect(expandQuery("sạc dự phòng anker")).toEqual([
      ["sac du phong", "pin du phong", "powerbank", "power bank"],
      ["anker"],
    ]);
  });

  it("'o cung' adds ssd / hdd, but 'ssd' alone does not widen to hdd", () => {
    expect(expandQuery("ổ cứng")).toEqual([["o cung", "ssd", "hdd"]]);
    expect(expandQuery("ssd")).toBeUndefined();
  });

  it("covers the rest of the curated category words", () => {
    const has = (q: string, alt: string) => expect(expandQuery(q)![0]).toContain(alt);
    has("laptop", "may tinh xach tay");
    has("lap dell", "laptop");
    has("lap top", "laptop");
    has("dong ho thong minh", "smartwatch");
    has("loa", "speaker");
    has("chuột", "mouse");
    has("bàn phím", "keyboard");
    has("màn hình", "monitor");
    has("tivi", "tv");
  });
});

describe("expandQuery — brand / model shorthands", () => {
  it("'ip 15' → iphone 15", () => {
    expect(expandQuery("ip 15")).toEqual([["ip 15", "iphone 15"]]);
  });

  it("glued forms: 'ip15pm', 'ipp15', 'iphone15'", () => {
    expect(expandQuery("ip15pm")).toEqual([["ip15pm", "iphone 15 pro max"]]);
    expect(expandQuery("ipp15")).toEqual([["ipp15", "iphone 15 pro"]]);
    expect(expandQuery("iphone15")).toEqual([["iphone15", "iphone 15"]]);
  });

  it("'ip 15 pm' and 'ipp 14' with spaces", () => {
    expect(expandQuery("ip 15 pm")).toEqual([["ip 15 pm", "iphone 15 pro max"]]);
    expect(expandQuery("ipp 14")).toEqual([["ipp 14", "iphone 14 pro"]]);
  });

  it("'ip' without a number is left alone", () => {
    expect(expandQuery("ip camera")).toBeUndefined();
  });

  it("ss → samsung, xm / mi → xiaomi, pm → pro max", () => {
    expect(expandQuery("ss s24")).toEqual([["ss", "samsung"], ["s24"]]);
    expect(expandQuery("xm")).toEqual([["xm", "xiaomi"]]);
    expect(expandQuery("mi band")).toEqual([["mi", "xiaomi"], ["band"]]);
    expect(expandQuery("galaxy pm")).toEqual([["galaxy"], ["pm", "pro max"]]);
  });

  it("capacity spacing: '2tb' ≡ '2 tb'", () => {
    expect(expandQuery("ssd 2tb")).toEqual([["ssd"], ["2tb", "2 tb"]]);
    expect(expandQuery("ssd 2 TB")).toEqual([["ssd"], ["2 tb", "2tb"]]);
    expect(expandQuery("512gb")).toEqual([["512gb", "512 gb"]]);
  });
});

describe("expandQuery — false expansions of cheap shorthands (review M1)", () => {
  it("IP protection ratings never become iPhones (ip54, ip65, ip67, ip68, ipx4, spaced or glued)", () => {
    for (const q of ["ip67", "ip68", "ip65", "ip54", "ipx4", "ipx7", "ip6x", "ip 67", "ip 68", "loa bluetooth ip67", "tai nghe ipx4"]) {
      const groups = expandQuery(q) ?? [];
      expect(groups.flat().some((alt) => alt.startsWith("iphone")), q).toBe(false);
    }
  });

  it("real iPhone numbers still expand (3–19)", () => {
    expect(expandQuery("ip 6")).toEqual([["ip 6", "iphone 6"]]);
    expect(expandQuery("ip12")).toEqual([["ip12", "iphone 12"]]);
    expect(expandQuery("ip 17 pm")).toEqual([["ip 17 pm", "iphone 17 pro max"]]);
    expect(expandQuery("iphone16")).toEqual([["iphone16", "iphone 16"]]);
  });

  it("'lap' (= lắp) means laptop only next to a laptop brand or line", () => {
    expect(expandQuery("lắp đặt camera")).toBeUndefined();
    expect(expandQuery("lắp ráp pc gaming")).toBeUndefined();
    expect(expandQuery("lap")).toBeUndefined();
    expect(expandQuery("lap dell")).toEqual([["lap", "laptop", "may tinh xach tay", "notebook"], ["dell"]]);
    expect(expandQuery("asus lap")![1]).toContain("laptop");
  });

  it("'mi' (= mi / mì / mí) means Xiaomi only before a Xiaomi line or a model number", () => {
    for (const q of ["kẹp mi", "mascara mi", "mì tôm", "mi", "mí mắt"]) expect(expandQuery(q), q).toBeUndefined();
    expect(expandQuery("mi band 8")).toEqual([["mi", "xiaomi"], ["band"], ["8"]]);
    expect(expandQuery("mi 11")![0]).toEqual(["mi", "xiaomi"]);
    expect(expandQuery("mi tv")![0]).toEqual(["mi", "xiaomi"]);
  });

  it("'ss' (= so sánh) means Samsung only before a Samsung line or model", () => {
    for (const q of ["ss iphone 15 pro", "ss 2 san pham", "ss", "ss gia"]) {
      const groups = expandQuery(q) ?? [];
      expect(groups.flat(), q).not.toContain("samsung");
    }
    for (const q of ["ss s24", "ss galaxy", "ss a55", "ss 990 pro", "ss t7", "ss z fold6", "ss buds3"]) {
      expect(expandQuery(q)![0], q).toEqual(["ss", "samsung"]);
    }
  });
});

describe("expandQuery — safety and no-op cases", () => {
  it("no synonym → undefined (the RPC runs its plain v11 query)", () => {
    expect(expandQuery("sony wh 1000xm5")).toBeUndefined();
    expect(expandQuery("")).toBeUndefined();
    expect(expandQuery("   !!! ")).toBeUndefined();
  });

  it("the original phrase is always first", () => {
    for (const q of ["tai nghe", "headphone", "dt", "ip 15", "2tb", "loa"]) {
      const groups = expandQuery(q)!;
      expect(groups[0][0]).toBe(q.replace(/\s+/g, " "));
    }
  });

  it(`at most ${MAX_ALTERNATIVES} alternatives per group`, () => {
    for (const rule of SYNONYM_RULES) {
      for (const phrase of rule.match) {
        for (const group of expandQuery(phrase) ?? []) {
          expect(group.length).toBeLessThanOrEqual(MAX_ALTERNATIVES);
          expect(new Set(group).size).toBe(group.length);
        }
      }
    }
  });

  it(`more than ${MAX_TERM_GROUPS} groups → no expansion (never drop words)`, () => {
    const words = Array.from({ length: MAX_TERM_GROUPS }, (_, i) => `w${i}`).join(" ");
    expect(expandQuery(`tai nghe ${words}`)).toBeUndefined();
    expect(expandQuery(`tai nghe ${words.split(" ").slice(1).join(" ")}`)).toHaveLength(MAX_TERM_GROUPS);
  });

  it("output only holds folded [a-z0-9] words — punctuation never reaches the RPC", () => {
    const groups = expandQuery("tai-nghe | (sony) & !headphone:*")!;
    for (const g of groups) for (const alt of g) expect(alt).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
  });

  it("every lexicon phrase is already in folded form", () => {
    for (const rule of SYNONYM_RULES) {
      for (const p of [...rule.match, ...rule.alternatives]) expect(p).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });
});

describe("lexicon drift guard (review M10)", () => {
  // Search synonyms (SYNONYM_RULES) and intent categories (CATEGORY_SYNONYMS) are separate lexicons.
  // Where a category phrase is also a synonym phrase, the two must agree on the family.
  const rulePhrases = new Set(SYNONYM_RULES.flatMap((r) => r.match));
  const expandsTo = (p: string) => new Set(expandQuery(p)?.[0] ?? [p]);
  const families = Object.entries(CATEGORY_SYNONYMS).map(([slug, phrases]) => [slug, phrases.filter((p) => rulePhrases.has(p))] as const);

  it("phrases of one category expand within one family", () => {
    for (const [slug, phrases] of families) {
      for (const a of phrases) {
        for (const b of phrases) {
          expect(expandsTo(a).has(b) || expandsTo(b).has(a), `${slug}: ${a} / ${b}`).toBe(true);
        }
      }
    }
  });

  it("phrases of different categories never expand into each other", () => {
    for (const [slugA, a] of families) {
      for (const [slugB, b] of families) {
        if (slugA === slugB) continue;
        for (const p of a) for (const q of b) expect(expandsTo(p).has(q), `${slugA}:${p} → ${slugB}:${q}`).toBe(false);
      }
    }
  });
});
