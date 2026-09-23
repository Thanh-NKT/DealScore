/**
 * Consent version for the Terms of Use and Privacy Policy.
 * Bump this when the Terms or the Policy change — every user must consent again.
 */
export const CURRENT_CONSENT_VERSION = "2026-09-23";

export function needsConsent(consentVersion: string | null | undefined): boolean {
  return consentVersion !== CURRENT_CONSENT_VERSION;
}
