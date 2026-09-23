import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/lib/cron";

const h = (auth?: string) => new Headers(auth ? { authorization: auth } : {});

describe("isAuthorizedCronRequest", () => {
  it("đúng secret → true", () => expect(isAuthorizedCronRequest(h("Bearer s3cret"), "s3cret")).toBe(true));
  it("sai secret → false", () => expect(isAuthorizedCronRequest(h("Bearer nope"), "s3cret")).toBe(false));
  it("thiếu header → false", () => expect(isAuthorizedCronRequest(h(), "s3cret")).toBe(false));
  it("secret rỗng / undefined → luôn false", () => {
    expect(isAuthorizedCronRequest(h("Bearer "), "")).toBe(false);
    expect(isAuthorizedCronRequest(h("Bearer undefined"), undefined)).toBe(false);
  });
});
