"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type DashboardLayoutProps = {
  children: ReactNode;
};

function SidebarIcon({ name }: { name: string }) {
  const className = "w-5 h-5 shrink-0";
  switch (name) {
    case "insight":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      );
    case "customers":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    case "properties":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    case "subscription":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isDashboard = pathname === "/dashboard";
  const isCustomers =
    pathname === "/dashboard/customers" ||
    pathname?.startsWith("/dashboard/customers/");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => setUser(u ?? null));
  }, []);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }, [router]);

  const displayName =
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email ??
    "User";
  const initial = displayName.charAt(0).toUpperCase();

  const navItems = [
    { href: "/dashboard", label: "Insight", icon: "insight", active: isDashboard },
    { href: "/dashboard/customers", label: "Customers", icon: "customers", active: isCustomers },
    { href: "/dashboard/customers", label: "Properties", icon: "properties", active: false },
    { href: "/dashboard/subscription", label: "Subscription", icon: "subscription", active: pathname?.startsWith("/dashboard/subscription") ?? false },
  ] as const;

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col md:flex-row">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="w-56 bg-white border-r border-stone-200 flex flex-col shadow-lg">
            <div className="p-4 border-b border-stone-200 flex items-center justify-between">
              <Link href="/dashboard" className="flex items-center gap-2">
                <Image
                  src="/logo.png"
                  alt="RelyBricks"
                  width={132}
                  height={40}
                  className="h-8 w-auto object-contain"
                />
              </Link>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-stone-600 text-xs"
              >
                Close
              </button>
            </div>
            <nav className="p-3 flex flex-col gap-0.5">
              {navItems.map((item) => (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    item.active
                      ? "bg-violet-600 text-white"
                      : "text-stone-700 hover:bg-stone-300/60"
                  }`}
                >
                  <SidebarIcon name={item.icon} />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <button
            type="button"
            aria-label="Close sidebar overlay"
            className="flex-1 bg-black/20"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex ${
          sidebarCollapsed ? "w-16" : "w-56"
        } shrink-0 bg-white border-r border-stone-200 flex-col`}
      >
        <div className="p-4 border-b border-stone-200 flex items-center justify-between gap-2">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="RelyBricks"
              width={sidebarCollapsed ? 40 : 140}
              height={44}
              className={sidebarCollapsed ? "h-8 w-auto object-contain" : "h-9 w-auto object-contain"}
            />
          </Link>
          <button
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:inline-flex items-center justify-center rounded-md border border-stone-200 bg-white px-1.5 py-1 text-[10px] text-stone-500 hover:bg-stone-50"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
        </div>
        <nav className="p-3 flex flex-col gap-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={`flex items-center ${
                sidebarCollapsed ? "justify-center" : "gap-3"
              } px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                item.active
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-stone-600 hover:bg-violet-50"
              }`}
            >
              <SidebarIcon name={item.icon} />
              {!sidebarCollapsed && item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="md:hidden mr-1 text-stone-600"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <span className="block w-4 border-b border-current mb-0.5" />
              <span className="block w-4 border-b border-current mb-0.5" />
              <span className="block w-4 border-b border-current" />
            </button>
            <Link href="/dashboard" className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="RelyBricks"
                width={120}
                height={36}
                className="h-8 w-auto object-contain"
              />
            </Link>
            <nav className="ml-4 flex gap-3 md:hidden text-xs font-medium text-stone-600">
              <Link
                href="/dashboard"
                className={
                  isDashboard
                    ? "text-violet-700"
                    : "hover:text-stone-900"
                }
              >
                Insight
              </Link>
              <Link
                href="/dashboard/customers"
                className={
                  isCustomers
                    ? "text-violet-700"
                    : "hover:text-stone-900"
                }
              >
                Customers
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-600 hidden sm:inline">{displayName}</span>
            <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-semibold text-sm">
              {initial}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-sm text-stone-500 hover:text-stone-700"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
