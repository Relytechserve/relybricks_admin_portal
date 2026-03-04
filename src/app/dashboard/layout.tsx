 "use client";

 import type { ReactNode } from "react";
 import Link from "next/link";
 import Image from "next/image";
 import { usePathname, useRouter } from "next/navigation";
 import { useCallback } from "react";
 import { createClient } from "@/lib/supabase";

 type DashboardLayoutProps = {
   children: ReactNode;
 };

 export default function DashboardLayout({ children }: DashboardLayoutProps) {
   const pathname = usePathname();
   const router = useRouter();

   const isDashboard = pathname === "/dashboard";
   const isCustomers =
     pathname === "/dashboard/customers" ||
     pathname?.startsWith("/dashboard/customers/");

   const handleSignOut = useCallback(async () => {
     const supabase = createClient();
     await supabase.auth.signOut();
     router.push("/login");
   }, [router]);

   return (
     <div className="min-h-screen bg-stone-100">
       <header className="bg-white border-b border-stone-200 px-6 py-4">
         <div className="flex justify-between items-center">
           <Link href="/dashboard" className="flex items-center gap-3">
             <Image
               src="/logo.png"
               alt="RelyBricks Property Management"
               width={120}
               height={40}
               priority
               className="h-8 w-auto object-contain"
             />
             <span className="text-sm font-medium text-stone-600 hidden sm:inline">
               Admin
             </span>
           </Link>
           <div className="flex items-center gap-4">
             <nav className="flex gap-4">
               <Link
                 href="/dashboard"
                 className={
                   isDashboard
                     ? "text-stone-900 font-medium"
                     : "text-stone-600 hover:text-stone-900 font-medium"
                 }
               >
                 Dashboard
               </Link>
               <Link
                 href="/dashboard/customers"
                 className={
                   isCustomers
                     ? "text-stone-900 font-medium"
                     : "text-stone-600 hover:text-stone-900 font-medium"
                 }
               >
                 Customers
               </Link>
             </nav>
             <button
               type="button"
               onClick={handleSignOut}
               className="px-3 py-1.5 rounded-lg border border-stone-300 text-sm text-stone-700 hover:bg-stone-50"
             >
               Sign out
             </button>
           </div>
         </div>
       </header>
       <main className="p-6 max-w-7xl mx-auto">{children}</main>
     </div>
   );
 }

