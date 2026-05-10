"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function AdminLoginPage() {
  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySent, setRecoverySent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const emailRaw = (formData.get("email") as string) ?? "";
    const passwordRaw = (formData.get("password") as string) ?? "";
    const email = emailRaw.trim().toLowerCase();
    const password = passwordRaw;

    if (!email) {
      setError("Email is required.");
      setLoading(false);
      return;
    }

    // Guard against accidental copy/paste whitespace causing false invalid-credential errors.
    if (passwordRaw !== passwordRaw.trim()) {
      setError("Password contains extra spaces at start/end. Please remove and try again.");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const timeoutMs = 15000;
      const signInPromise = supabase.auth.signInWithPassword({
        email,
        password,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out. Check your connection and try again.")), timeoutMs)
      );
      const { error: signInError } = await Promise.race([signInPromise, timeoutPromise]);

      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    setRecoverySent(null);
    const emailInput = document.getElementById("email") as HTMLInputElement | null;
    const email = (emailInput?.value ?? "").trim().toLowerCase();

    if (!email) {
      setError("Enter your email, then click Forgot password.");
      return;
    }

    setRecoveryLoading(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setRecoverySent("Password reset email sent. Open it and continue from the link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-sm border border-stone-200">
        <h1 className="text-xl font-semibold text-stone-900">Admin sign in</h1>
        <p className="mt-2 text-sm text-stone-600">
          Enter your admin email and password.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}
          {recoverySent && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
              {recoverySent}
            </div>
          )}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-stone-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="admin@relybricks.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-stone-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-500 disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={recoveryLoading}
            className="w-full py-2 text-sm text-blue-700 hover:text-blue-800 disabled:opacity-70"
          >
            {recoveryLoading ? "Sending reset email..." : "Forgot password?"}
          </button>
        </form>
      </div>
    </div>
  );
}
