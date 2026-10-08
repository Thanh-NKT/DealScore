import crypto from "node:crypto";

export type UnsubscribeScope =
  | { kind: "watch"; userId: string; watchId: string }
  | { kind: "email"; userId: string }
  // Roadmap P4: pause one saved search / cancel one demand follow.
  | { kind: "saved_search"; userId: string; savedSearchId: string }
  | { kind: "demand_follow"; userId: string; followId: string };

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): Buffer {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  return Buffer.from(b64, "base64");
}

export function signUnsubscribeToken(
  scope: UnsubscribeScope,
  secret: string,
): string {
  const payloadStr = JSON.stringify(scope);
  const payloadPart = base64UrlEncode(Buffer.from(payloadStr, "utf8"));
  const dataToSign = `v1.${payloadPart}`;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(dataToSign);
  const sigPart = base64UrlEncode(hmac.digest());

  return `v1.${payloadPart}.${sigPart}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): UnsubscribeScope | null {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return null;
  }

  const [, payloadPart, sigPart] = parts;
  const dataToSign = `v1.${payloadPart}`;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(dataToSign);
  const expectedSig = hmac.digest();
  const actualSig = base64UrlDecode(sigPart);

  if (expectedSig.length !== actualSig.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expectedSig, actualSig)) {
    return null;
  }

  try {
    const jsonStr = base64UrlDecode(payloadPart).toString("utf8");
    const parsed = JSON.parse(jsonStr);

    if (
      parsed &&
      parsed.kind === "watch" &&
      typeof parsed.userId === "string" &&
      typeof parsed.watchId === "string"
    ) {
      return {
        kind: "watch",
        userId: parsed.userId,
        watchId: parsed.watchId,
      };
    }

    if (
      parsed &&
      parsed.kind === "email" &&
      typeof parsed.userId === "string"
    ) {
      return {
        kind: "email",
        userId: parsed.userId,
      };
    }

    if (parsed && parsed.kind === "saved_search" && typeof parsed.userId === "string" && typeof parsed.savedSearchId === "string") {
      return { kind: "saved_search", userId: parsed.userId, savedSearchId: parsed.savedSearchId };
    }

    if (parsed && parsed.kind === "demand_follow" && typeof parsed.userId === "string" && typeof parsed.followId === "string") {
      return { kind: "demand_follow", userId: parsed.userId, followId: parsed.followId };
    }

    return null;
  } catch {
    return null;
  }
}
