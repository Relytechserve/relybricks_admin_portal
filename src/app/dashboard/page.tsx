 "use client";

 import { useEffect, useState } from "react";
 import { useRouter } from "next/navigation";
 import type { PostgrestError } from "@supabase/supabase-js";
 import { createClient } from "@/lib/supabase";

 type CustomerSummary = {
   status: string;
   plan_type: string | null;
   next_renewal_date: string | null;
   package_revenue: number | null;
  lifecycle_stage: string | null;
  payment_status: string | null;
  outstanding_amount: number | null;
 };

 type DashboardStats = {
   totalCustomers: number;
   activeCustomers: number;
   upcomingRenewals: number;
   totalRevenue: number;
  churnRiskCustomers: number;
  overdueCustomers: number;
 };

 export default function AdminDashboardPage() {
   const [loading, setLoading] = useState(true);
   const [stats, setStats] = useState<DashboardStats | null>(null);
   const [error, setError] = useState<string | null>(null);
   const router = useRouter();

   useEffect(() => {
     const supabase = createClient();

     async function load() {
       setLoading(true);
       setError(null);

       const {
         data: { user },
       } = await supabase.auth.getUser();

       if (!user) {
         router.push("/login");
         return;
       }

       const { data, error } = (await supabase
         .from("customers")
         .select(
          "status, plan_type, next_renewal_date, package_revenue, lifecycle_stage, payment_status, outstanding_amount",
        )) as { data: CustomerSummary[] | null; error: PostgrestError | null };

       if (error) {
         setError("Failed to load dashboard data.");
         setLoading(false);
         return;
       }

       const customers = data ?? [];

       const totalCustomers = customers.length;
       const activeCustomers = customers.filter(
         (c) => c.status === "Active",
       ).length;

       const today = new Date();
       const in30Days = new Date();
       in30Days.setDate(today.getDate() + 30);

       const upcomingRenewals = customers.filter((c) => {
         if (!c.next_renewal_date) return false;
         const d = new Date(c.next_renewal_date);
         return d >= today && d <= in30Days;
       }).length;

       const totalRevenue = customers.reduce((sum, c) => {
         return sum + (c.package_revenue ?? 0);
       }, 0);

      const churnRiskCustomers = customers.filter((c) => {
        return c.lifecycle_stage === "churn_risk";
      }).length;

      const overdueCustomers = customers.filter((c) => {
        if (c.payment_status === "overdue") return true;
        const outstanding = c.outstanding_amount ?? 0;
        return outstanding > 0 && c.status === "Active";
      }).length;

       setStats({
         totalCustomers,
         activeCustomers,
         upcomingRenewals,
         totalRevenue,
        churnRiskCustomers,
        overdueCustomers,
       });
       setLoading(false);
     }

     load();
   }, [router]);

   return (
     <div>
       <h2 className="text-lg font-semibold text-stone-900">Dashboard</h2>
       <p className="mt-1 text-stone-600">
         High-level view of your customers and revenue.
       </p>

       {loading && (
         <p className="mt-6 text-stone-500">Loading dashboard data...</p>
       )}

       {!loading && error && (
         <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
           {error}
         </div>
       )}

      {!loading && !error && stats && (
        <>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-sm text-stone-500">Total customers</p>
              <p className="mt-2 text-2xl font-semibold text-stone-900">
                {stats.totalCustomers}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-sm text-stone-500">Active customers</p>
              <p className="mt-2 text-2xl font-semibold text-stone-900">
                {stats.activeCustomers}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-sm text-stone-500">
                Renewals in next 30 days
              </p>
              <p className="mt-2 text-2xl font-semibold text-stone-900">
                {stats.upcomingRenewals}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-sm text-stone-500">Annual package revenue</p>
              <p className="mt-2 text-2xl font-semibold text-stone-900">
                ₹
                {stats.totalRevenue.toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-amber-200 p-4">
              <p className="text-sm text-amber-700">Churn risk customers</p>
              <p className="mt-2 text-2xl font-semibold text-amber-900">
                {stats.churnRiskCustomers}
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Mark lifecycle stage as &quot;churn_risk&quot; to include here.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-red-200 p-4">
              <p className="text-sm text-red-700">Overdue / outstanding</p>
              <p className="mt-2 text-2xl font-semibold text-red-900">
                {stats.overdueCustomers}
              </p>
              <p className="mt-1 text-xs text-red-700">
                Customers with overdue payment status or outstanding amount &gt; 0.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <p className="text-sm text-stone-500">Average revenue per customer</p>
              <p className="mt-2 text-2xl font-semibold text-stone-900">
                ₹
                {Math.round(
                  stats.totalCustomers > 0
                    ? stats.totalRevenue / stats.totalCustomers
                    : 0,
                ).toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}
              </p>
            </div>
          </div>
        </>
      )}
     </div>
   );
 }

