import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretRecoveryLink,
  RECOVERY_LINK_EXPIRED,
  safeNextPath,
} from "./recovery-link";

const origin = "https://relybricksadminportal.vercel.app/reset-password";

test("reads implicit recovery tokens from the hash", () => {
  const link = interpretRecoveryLink(
    `${origin}#access_token=access&refresh_token=refresh&expires_in=3600&token_type=bearer&type=recovery`,
  );
  assert.deepEqual(link, {
    kind: "session",
    accessToken: "access",
    refreshToken: "refresh",
  });
});

test("reads invite hash tokens the same way", () => {
  const link = interpretRecoveryLink(
    `${origin}#access_token=access&refresh_token=refresh&type=invite`,
  );
  assert.equal(link.kind, "session");
});

test("treats an expired or used link as a failure, not a form", () => {
  const link = interpretRecoveryLink(
    `${origin}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
  );
  assert.deepEqual(link, { kind: "error", message: RECOVERY_LINK_EXPIRED });
});

test("reads an expired link from the query string", () => {
  const link = interpretRecoveryLink(
    `${origin}?error=access_denied&error_code=otp_expired`,
  );
  assert.deepEqual(link, { kind: "error", message: RECOVERY_LINK_EXPIRED });
});

test("treats a partial token hash as a failure", () => {
  const link = interpretRecoveryLink(`${origin}#access_token=only-access&type=recovery`);
  assert.equal(link.kind, "error");
});

test("reads a PKCE code from the query string", () => {
  const link = interpretRecoveryLink(`${origin}?code=auth-code&next=/reset-password`);
  assert.deepEqual(link, { kind: "code", code: "auth-code" });
});

test("reads a token hash for server-side verify", () => {
  const link = interpretRecoveryLink(`${origin}?token_hash=hashed&type=recovery`);
  assert.deepEqual(link, { kind: "otp", tokenHash: "hashed", type: "recovery" });
});

test("ignores an unknown otp type", () => {
  const link = interpretRecoveryLink(`${origin}?token_hash=hashed&type=not-a-type`);
  assert.deepEqual(link, { kind: "none" });
});

test("a bare reset page has no link", () => {
  assert.deepEqual(interpretRecoveryLink(origin), { kind: "none" });
});

test("search params override the same hash keys", () => {
  const link = interpretRecoveryLink(
    `${origin}?access_token=from-search&refresh_token=from-search#access_token=from-hash&refresh_token=from-hash`,
  );
  assert.deepEqual(link, {
    kind: "session",
    accessToken: "from-search",
    refreshToken: "from-search",
  });
});

test("safeNextPath stays on this site", () => {
  assert.equal(safeNextPath("/reset-password"), "/reset-password");
  assert.equal(safeNextPath(null), "/dashboard");
  assert.equal(safeNextPath("//evil.example"), "/dashboard");
  assert.equal(safeNextPath("https://evil.example"), "/dashboard");
});
