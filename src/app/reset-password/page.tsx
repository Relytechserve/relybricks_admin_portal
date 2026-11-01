"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  interpretRecoveryLink,
  recoveryTransportMessage,
  RECOVERY_LINK_MISSING,
  RECOVERY_LINK_UNUSABLE,
} from "@/lib/recovery-link";

type Phase = "checking" | "ready" | "blocked";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const passwordError = useMemo(() => {
    if (!password && !confirmPassword) return null;
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return null;
  }, [password, confirmPassword]);

  useEffect(() => {
    let requestId = 0;

    async function establishSession() {
      const id = ++requestId;
      const current = () => id === requestId;
      setPhase("checking");
      setError(null);
      setSuccess(null);

      try {
        const link = interpretRecoveryLink(window.location.href);

        if (link.kind === "error") {
          if (current()) {
            setError(link.message);
            setPhase("blocked");
          }
          return;
        }

        if (link.kind === "code") {
          const target = new URL("/auth/callback", window.location.origin);
          target.searchParams.set("code", link.code);
          target.searchParams.set("next", "/reset-password");
          window.location.replace(target.toString());
          return;
        }

        const supabase = createClient();

        if (link.kind === "session") {
          // The SSR browser client is locked to PKCE and will not adopt implicit
          // `#access_token` / `#refresh_token` redirects from generateLink.
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
          if (!current()) return;
          if (sessionError) {
            setError(recoveryTransportMessage(sessionError) ?? RECOVERY_LINK_UNUSABLE);
            setPhase("blocked");
            return;
          }
          window.history.replaceState(window.history.state, "", "/reset-password");
          setPhase("ready");
          return;
        }

        if (link.kind === "otp") {
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: link.tokenHash,
            type: link.type,
          });
          if (!current()) return;
          if (otpError) {
            setError(recoveryTransportMessage(otpError) ?? RECOVERY_LINK_UNUSABLE);
            setPhase("blocked");
            return;
          }
          window.history.replaceState(window.history.state, "", "/reset-password");
          setPhase("ready");
          return;
        }

        const { data, error: userError } = await supabase.auth.getUser();
        if (!current()) return;
        if (userError || !data.user) {
          setError(recoveryTransportMessage(userError) ?? RECOVERY_LINK_MISSING);
          setPhase("blocked");
          return;
        }
        setPhase("ready");
      } catch (err: unknown) {
        if (!current()) return;
        const message = err instanceof Error ? err.message : "";
        setError(recoveryTransportMessage({ message }) ?? RECOVERY_LINK_UNUSABLE);
        setPhase("blocked");
      }
    }

    function onHashChange() {
      void establishSession();
    }

    void establishSession();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      requestId += 1;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (phase !== "ready") return;

    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        const offline = recoveryTransportMessage(updateError);
        if (offline) {
          setError(offline);
          return;
        }
        if (/auth session missing/i.test(updateError.message)) {
          setError(RECOVERY_LINK_UNUSABLE);
          setPhase("blocked");
          return;
        }
        setError(updateError.message);
        return;
      }

      setSuccess("Password updated. Redirecting to dashboard...");
      router.refresh();
      setTimeout(() => router.push("/dashboard"), 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(recoveryTransportMessage({ message }) ?? "Could not update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-sm border border-stone-200">
        <h1 className="text-xl font-semibold text-stone-900">Set new password</h1>
        <p className="mt-2 text-sm text-stone-600">
          {phase === "ready"
            ? "Choose a new password for your account."
            : "Use the link from your email to choose a new password."}
        </p>

        {phase === "checking" && (
          <p className="mt-6 text-sm text-stone-600" role="status">
            Confirming your link...
          </p>
        )}

        {phase === "blocked" && error && (
          <div className="mt-6 space-y-4">
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
              {error}
            </div>
            <Link
              href="/login"
              className="inline-block text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Back to sign in
            </Link>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm" role="status">
                {success}
              </div>
            )}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-stone-700 mb-1">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-stone-700 mb-1"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Repeat the new password"
              />
            </div>
            {passwordError && <p className="text-sm text-red-700">{passwordError}</p>}

            <button
              type="submit"
              disabled={loading || !!passwordError}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-500 disabled:opacity-70"
            >
              {loading ? "Updating password..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
