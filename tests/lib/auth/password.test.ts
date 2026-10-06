import { describe, expect, it } from "vitest";
import { checkPassword, passwordProblem } from "@/lib/auth/password";

describe("passwordProblem", () => {
  it.each([
    ["abc12345", null],
    ["đẹptrai1", null], // accented letters count as letters
    ["", "empty"],
    ["ab1", "too_short"],
    ["abcdefgh", "missing_digit"],
    ["12345678", "missing_letter"],
    [`a1${"x".repeat(71)}`, "too_long"],
    ["  ab12  ", null], // never trimmed; spaces are characters
  ])("%j → %s", (pw, expected) => {
    expect(passwordProblem(pw)).toBe(expected);
  });

  it("rejects the email or its local part", () => {
    expect(passwordProblem("an@dealscore.vn1", "an@dealscore.vn1")).toBe("same_as_email");
    expect(passwordProblem("An12345678", "an12345678@x.vn")).toBe("same_as_email");
    expect(passwordProblem("an12345678", "someone@x.vn")).toBeNull();
  });
});

describe("checkPassword", () => {
  it("reports each rule", () => {
    expect(checkPassword("a").map((c) => [c.rule, c.ok])).toEqual([
      ["length", false],
      ["letter", true],
      ["digit", false],
    ]);
    expect(checkPassword("abc12345").every((c) => c.ok)).toBe(true);
  });
});
