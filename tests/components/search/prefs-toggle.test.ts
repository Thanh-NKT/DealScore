import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrefsToggle } from "@/components/search/prefs-toggle";

describe("PrefsToggle", () => {
  it("off: a plain link that turns prefs=1 on, back to page 1", () => {
    const html = renderToStaticMarkup(createElement(PrefsToggle, { base: { q: "ssd", page: 3 }, on: false }));
    expect(html).toContain('href="/search?q=ssd&amp;prefs=1"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Theo sở thích của tôi");
  });

  it("on: the link drops prefs and keeps the rest of the search", () => {
    const html = renderToStaticMarkup(createElement(PrefsToggle, { base: { q: "ssd", brands: ["WD"], prefs: true }, on: true }));
    expect(html).toContain('href="/search?q=ssd&amp;brand=WD"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('href="/account/preferences"');
  });
});
