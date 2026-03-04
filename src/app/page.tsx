import Link from "next/link";

export default function AdminHome() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-100">
      <h1 className="text-2xl font-semibold text-stone-900">RelyBricks Admin</h1>
      <p className="mt-2 text-stone-600">Property management admin portal</p>
      <Link
        href="/login"
        className="mt-8 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-500"
      >
        Sign in
      </Link>
    </div>
  );
}
