"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center px-4">
      <h1 className="text-xl font-semibold text-stone-900">Something went wrong</h1>
      <p className="mt-2 text-stone-600 text-center max-w-md">An error occurred. Please try again.</p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-500 font-medium"
        >
          Try again
        </button>
        <Link href="/" className="px-4 py-2 border border-stone-300 rounded-xl hover:bg-stone-50 font-medium">
          Go home
        </Link>
      </div>
    </div>
  );
}
