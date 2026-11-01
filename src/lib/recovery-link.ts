/**
 * Supabase recovery and invite links arrive in more than one shape.
 * Admin `generateLink` redirects with implicit hash tokens. The PKCE email
 * flow redirects with `?code=`. Server templates may send `token_hash`.
 * Expired links redirect with an error hash and no tokens.
 */

export const RECOVERY_LINK_EXPIRED =
  "This link has expired or was already used. Open the latest email and use that link again, or request a new one from the sign-in page.";

export const RECOVERY_LINK_MISSING =
  "Open the link in your email to set a password. If it expired, request a new one from the sign-in page.";

export const RECOVERY_LINK_UNUSABLE =
  "We couldn't use this link. It may have expired or already been used. Open the latest email and try again.";

export const RECOVERY_LINK_OFFLINE =
  "We couldn't reach the sign-in service. Check your connection and try again.";

export const EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

export type RecoveryOtpType = (typeof EMAIL_OTP_TYPES)[number];

export type RecoveryLink =
  | { kind: "error"; message: string }
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "code"; code: string }
  | { kind: "otp"; tokenHash: string; type: RecoveryOtpType }
  | { kind: "none" };

export function isRecoveryOtpType(value: string | null): value is RecoveryOtpType {
  return !!value && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function paramsFromHref(href: string): URLSearchParams {
  const url = new URL(href);
  const merged = new URLSearchParams();
  if (url.hash.startsWith("#")) {
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
      merged.set(key, value);
    });
  }
  // Search params win over the hash, matching Supabase's URL parser.
  url.searchParams.forEach((value, key) => {
    merged.set(key, value);
  });
  return merged;
}

export function interpretRecoveryLink(href: string): RecoveryLink {
  let params: URLSearchParams;
  try {
    params = paramsFromHref(href);
  } catch {
    return { kind: "none" };
  }

  const error = params.get("error");
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (accessToken && refreshToken) {
    return { kind: "session", accessToken, refreshToken };
  }

  if (error || errorCode || errorDescription || accessToken || refreshToken) {
    return { kind: "error", message: RECOVERY_LINK_EXPIRED };
  }

  if (code) {
    return { kind: "code", code };
  }

  if (tokenHash && isRecoveryOtpType(type)) {
    return { kind: "otp", tokenHash, type };
  }

  return { kind: "none" };
}

export function recoveryTransportMessage(error: { message?: string } | null | undefined): string | null {
  const message = error?.message ?? "";
  if (/network|failed to fetch|fetch failed|timeout/i.test(message)) {
    return RECOVERY_LINK_OFFLINE;
  }
  return null;
}

/** Keeps the post-login redirect on this site. */
export function safeNextPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("://") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/dashboard";
  }
  return value;
}
