 "use client";

 import { useEffect, useMemo, useState } from "react";
 import Link from "next/link";
 import { useRouter } from "next/navigation";
 import { createClient } from "@/lib/supabase";

 type CustomerRow = {
   id: string;
   name: string;
   email: string;
   status: string;
   plan_type: string | null;
  source: string | null;
  segment: string | null;
  lifecycle_stage: string | null;
  payment_status: string | null;
   subscription_date: string | null;
   renewal_date: string | null;
   next_renewal_date: string | null;
   renewal_status: string | null;
   package_revenue: number | null;
   billed_amount: number | null;
   property_city: string | null;
   property_area: string | null;
   property_type: string | null;
   property_status: string | null;
   created_at: string | null;
  updated_at?: string | null;
 };

 type Filters = {
   search: string;
   status: string;
   plan: string;
   paymentStatus: string;
  lifecycleStage: string;
  source: string;
   city: string;
   registeredFrom: string;
   registeredTo: string;
   renewalFrom: string;
   renewalTo: string;
 };

type SortKey =
  | "lastUpdated"
  | "name"
  | "email"
  | "status"
  | "plan"
  | "registration"
  | "nextRenewal"
  | "payment";

 function getPaymentStatus(customer: CustomerRow): "paid" | "unpaid" {
   const billed = customer.billed_amount;
   return billed != null && Number(billed) > 0 ? "paid" : "unpaid";
 }

 export default function CustomersPage() {
   const [customers, setCustomers] = useState<CustomerRow[]>([]);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);
   const [filters, setFilters] = useState<Filters>({
     search: "",
     status: "all",
     plan: "all",
     paymentStatus: "all",
    lifecycleStage: "all",
    source: "all",
     city: "all",
     registeredFrom: "",
     registeredTo: "",
     renewalFrom: "",
     renewalTo: "",
   });
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "lastUpdated",
    direction: "desc",
  });
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
        setLoading(false);
        router.push("/login");
        return;
      }

      const baseColumns = [
        "id",
        "name",
        "email",
        "status",
        "plan_type",
        "subscription_date",
        "renewal_date",
        "next_renewal_date",
        "renewal_status",
        "package_revenue",
        "billed_amount",
        "property_city",
        "property_area",
        "property_type",
        "property_status",
        "created_at",
      ];
      const optionalColumns = ["source", "segment", "lifecycle_stage", "payment_status", "updated_at"];
      const allColumns = [...baseColumns, ...optionalColumns];

      let data: CustomerRow[] | null = null;

      const { data: fullData, error: fullError } = await supabase
        .from("customers")
        .select(allColumns.join(", "));

      if (fullError) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("customers")
          .select(baseColumns.join(", "));
        if (fallbackError) {
          setError("Failed to load customers.");
          setLoading(false);
          return;
        }
        data = (fallbackData ?? []) as unknown as CustomerRow[];
      } else {
        data = (fullData ?? []) as unknown as CustomerRow[];
      }

      setCustomers(data ?? []);
      setLoading(false);
     }

     load();
   }, [router]);

   const uniqueCities = useMemo(
     () =>
       Array.from(
         new Set(
           customers
             .map((c) => c.property_city)
             .filter((c): c is string => Boolean(c)),
         ),
       ).sort((a, b) => a.localeCompare(b)),
     [customers],
   );

  const uniqueSources = useMemo(
    () =>
      Array.from(
        new Set(
          customers
            .map((c) => c.source)
            .filter((c): c is string => Boolean(c)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [customers],
  );

  function compareStrings(a: string | null | undefined, b: string | null | undefined) {
    const av = (a ?? "").toLowerCase();
    const bv = (b ?? "").toLowerCase();
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }

  function compareDates(a: string | null | undefined, b: string | null | undefined) {
    const av = a ?? "";
    const bv = b ?? "";
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }

  const filteredCustomers = useMemo(() => {
    const result = customers.filter((c) => {
       if (
         filters.search &&
         !`${c.name} ${c.email}`.toLowerCase().includes(filters.search.toLowerCase())
       ) {
         return false;
       }

       if (filters.status !== "all" && c.status !== filters.status) {
         return false;
       }

       if (filters.plan !== "all" && c.plan_type !== filters.plan) {
         return false;
       }

      if (
        filters.lifecycleStage !== "all" &&
        c.lifecycle_stage !== filters.lifecycleStage
      ) {
        return false;
      }

      if (filters.source !== "all" && c.source !== filters.source) {
        return false;
      }

       if (filters.paymentStatus !== "all") {
         const status = getPaymentStatus(c);
         if (filters.paymentStatus === "paid" && status !== "paid") return false;
         if (filters.paymentStatus === "unpaid" && status !== "unpaid") return false;
       }

       if (filters.city !== "all" && c.property_city !== filters.city) {
         return false;
       }

       if (filters.registeredFrom) {
         const created = c.subscription_date ?? c.created_at;
         if (!created || created < filters.registeredFrom) {
           return false;
         }
       }

       if (filters.registeredTo) {
         const created = c.subscription_date ?? c.created_at;
         if (!created || created > filters.registeredTo) {
           return false;
         }
       }

       if (filters.renewalFrom && c.next_renewal_date) {
         if (c.next_renewal_date < filters.renewalFrom) {
           return false;
         }
       }

       if (filters.renewalTo && c.next_renewal_date) {
         if (c.next_renewal_date > filters.renewalTo) {
           return false;
         }
       }

      return true;
    });

    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "lastUpdated": {
          const aDate = a.updated_at ?? a.subscription_date ?? a.created_at;
          const bDate = b.updated_at ?? b.subscription_date ?? b.created_at;
          cmp = compareDates(aDate, bDate);
          break;
        }
        case "name":
          cmp = compareStrings(a.name, b.name);
          break;
        case "email":
          cmp = compareStrings(a.email, b.email);
          break;
        case "status":
          cmp = compareStrings(a.status, b.status);
          break;
        case "plan":
          cmp = compareStrings(a.plan_type, b.plan_type);
          break;
        case "registration": {
          const aReg = a.subscription_date ?? a.created_at;
          const bReg = b.subscription_date ?? b.created_at;
          cmp = compareDates(aReg, bReg);
          break;
        }
        case "nextRenewal":
          cmp = compareDates(a.next_renewal_date, b.next_renewal_date);
          break;
        case "payment": {
          const aPay = getPaymentStatus(a);
          const bPay = getPaymentStatus(b);
          cmp = compareStrings(aPay, bPay);
          break;
        }
        default:
          cmp = 0;
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [customers, filters, sort]);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  function renderSortIndicator(key: SortKey) {
    if (sort.key !== key) return null;
    return <span className="ml-1 text-[10px]">{sort.direction === "asc" ? "▲" : "▼"}</span>;
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold text-stone-900">Customers</h2>
        {!loading && !error && customers.length > 0 && (
          <p className="text-sm text-stone-500">
            Showing{" "}
            <span className="font-medium text-stone-900">
              {filteredCustomers.length}
            </span>{" "}
            of{" "}
            <span className="font-medium text-stone-900">{customers.length}</span>{" "}
            customers
          </p>
        )}
      </div>

      {/* Filters: always visible so layout is stable */}
      <div
        className={`mt-6 bg-white rounded-xl border border-stone-200 p-4 ${loading ? "opacity-60 pointer-events-none" : ""}`}
      >
           <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
             <div className="md:col-span-2">
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 Search
               </label>
               <input
                 type="text"
                 value={filters.search}
                 onChange={(event) =>
                   setFilters((prev) => ({ ...prev, search: event.target.value }))
                 }
                 placeholder="Search by name or email"
                 className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               />
             </div>
             <div>
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 Status
               </label>
               <select
                 value={filters.status}
                 onChange={(event) =>
                   setFilters((prev) => ({ ...prev, status: event.target.value }))
                 }
                 className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               >
                 <option value="all">All</option>
                 <option value="Active">Active</option>
                 <option value="Inactive">Inactive</option>
                 <option value="Prospect">Prospect</option>
               </select>
             </div>
             <div>
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 Plan
               </label>
               <select
                 value={filters.plan}
                 onChange={(event) =>
                   setFilters((prev) => ({ ...prev, plan: event.target.value }))
                 }
                 className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               >
                 <option value="all">All</option>
                 <option value="Basic">Basic</option>
                 <option value="Gold">Gold</option>
                 <option value="Premium">Premium</option>
                 <option value="Custom">Custom</option>
               </select>
             </div>
             <div>
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 Payment status
               </label>
               <select
                 value={filters.paymentStatus}
                 onChange={(event) =>
                   setFilters((prev) => ({
                     ...prev,
                     paymentStatus: event.target.value,
                   }))
                 }
                 className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               >
                 <option value="all">All</option>
                 <option value="paid">Paid</option>
                 <option value="unpaid">Not paid</option>
               </select>
             </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">
                Lifecycle stage
              </label>
              <select
                value={filters.lifecycleStage}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    lifecycleStage: event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="churn_risk">Churn risk</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">
                Source
              </label>
              <select
                value={filters.source}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, source: event.target.value }))
                }
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                {uniqueSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>
             <div>
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 City
               </label>
               <select
                 value={filters.city}
                 onChange={(event) =>
                   setFilters((prev) => ({ ...prev, city: event.target.value }))
                 }
                 className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
               >
                 <option value="all">All</option>
                 {uniqueCities.map((city) => (
                   <option key={city} value={city}>
                     {city}
                   </option>
                 ))}
               </select>
             </div>
             <div className="md:col-span-2 lg:col-span-2">
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 Registration date
               </label>
               <div className="flex gap-2">
                 <input
                   type="date"
                   value={filters.registeredFrom}
                   onChange={(event) =>
                     setFilters((prev) => ({
                       ...prev,
                       registeredFrom: event.target.value,
                     }))
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 <input
                   type="date"
                   value={filters.registeredTo}
                   onChange={(event) =>
                     setFilters((prev) => ({
                       ...prev,
                       registeredTo: event.target.value,
                     }))
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
               </div>
             </div>
             <div className="md:col-span-2 lg:col-span-2">
               <label className="block text-xs font-medium text-stone-600 mb-1">
                 Next renewal date
               </label>
               <div className="flex gap-2">
                 <input
                   type="date"
                   value={filters.renewalFrom}
                   onChange={(event) =>
                     setFilters((prev) => ({
                       ...prev,
                       renewalFrom: event.target.value,
                     }))
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 <input
                   type="date"
                   value={filters.renewalTo}
                   onChange={(event) =>
                     setFilters((prev) => ({
                       ...prev,
                       renewalTo: event.target.value,
                     }))
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
               </div>
             </div>
           </div>
      </div>

      {loading && (
        <p className="mt-6 text-stone-500" aria-live="polite">
          Loading customers…
        </p>
      )}
       {!loading && error && (
         <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
           {error}
         </div>
       )}
       {!loading && !error && customers.length === 0 && (
         <p className="mt-6 text-stone-500">No customers found.</p>
       )}
       {!loading && !error && customers.length > 0 && (
         <div className="mt-4 bg-white rounded-xl border border-stone-200 overflow-hidden">
           <table className="w-full text-left">
             <thead className="bg-stone-50 border-b border-stone-200">
               <tr>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="inline-flex items-center"
                  >
                    Name
                    {renderSortIndicator("name")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("email")}
                    className="inline-flex items-center"
                  >
                    Email
                    {renderSortIndicator("email")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("status")}
                    className="inline-flex items-center"
                  >
                    Status
                    {renderSortIndicator("status")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("plan")}
                    className="inline-flex items-center"
                  >
                    Plan / city
                    {renderSortIndicator("plan")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("registration")}
                    className="inline-flex items-center"
                  >
                    Registration
                    {renderSortIndicator("registration")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("nextRenewal")}
                    className="inline-flex items-center"
                  >
                    Next renewal
                    {renderSortIndicator("nextRenewal")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-stone-900">
                  <button
                    type="button"
                    onClick={() => handleSort("payment")}
                    className="inline-flex items-center"
                  >
                    Payment
                    {renderSortIndicator("payment")}
                  </button>
                </th>
               </tr>
             </thead>
             <tbody>
               {filteredCustomers.map((c) => {
                 const paymentStatus = getPaymentStatus(c);
                 const registrationDate =
                   c.subscription_date ??
                   c.created_at ??
                   "";
                 const nextRenewalDate = c.next_renewal_date ?? "";

                 return (
                   <tr
                     key={c.id}
                     className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                     onClick={() =>
                       router.push(
                         `/dashboard/customers/${encodeURIComponent(c.id)}`,
                       )
                     }
                   >
                     <td className="px-4 py-3">
                       <Link
                         href={`/dashboard/customers/${encodeURIComponent(c.id)}`}
                         className="text-blue-600 hover:underline"
                         onClick={(event) => event.stopPropagation()}
                       >
                         {c.name}
                       </Link>
                     </td>
                     <td className="px-4 py-3 text-sm text-stone-700">
                       {c.email}
                     </td>
                     <td className="px-4 py-3">
                       <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                         {c.status}
                       </span>
                     </td>
                     <td className="px-4 py-3 text-sm text-stone-700">
                       <div className="flex flex-col gap-0.5">
                         <span>{c.plan_type ?? "—"}</span>
                         <span className="text-xs text-stone-500">
                           {c.property_city ?? "City not set"}
                         </span>
                       </div>
                     </td>
                     <td className="px-4 py-3 text-sm text-stone-700">
                       {registrationDate || "—"}
                     </td>
                     <td className="px-4 py-3 text-sm text-stone-700">
                       {nextRenewalDate || "—"}
                     </td>
                     <td className="px-4 py-3">
                       <span
                         className={
                           paymentStatus === "paid"
                             ? "inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-100"
                             : "inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-100"
                         }
                       >
                         {paymentStatus === "paid" ? "Paid" : "Not paid"}
                       </span>
                     </td>
                   </tr>
                 );
               })}
             </tbody>
           </table>
         </div>
       )}
     </div>
   );
 }


