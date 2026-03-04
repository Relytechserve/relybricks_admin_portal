"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function AdminLoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

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
        </form>
      </div>
    </div>
  );
}
