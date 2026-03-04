 "use client";

 import { useEffect, useMemo, useState } from "react";
 import Link from "next/link";
 import { useParams, useRouter } from "next/navigation";
 import { createClient } from "@/lib/supabase";

 type Customer = {
   id: string;
   name: string;
   email: string;
  source: string | null;
  segment: string | null;
  lifecycle_stage: string | null;
   phone: string | null;
   whatsapp: string | null;
   preferred_contact: string | null;
   status: string;
   plan_type: string | null;
   next_renewal_date: string | null;
   renewal_status: string | null;
   subscription_date: string | null;
   package_revenue: number | null;
   billed_amount: number | null;
   outstanding_amount: number | null;
  contract_term_months: number | null;
   property_city: string | null;
   property_area: string | null;
   property_type: string | null;
   property_status: string | null;
  property_bhk: string | null;
  property_furnishing: string | null;
  manager_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  payment_status: string | null;
   notes: string | null;
 };

 function formatDate(value: string | null) {
   if (!value) return null;
   const date = new Date(value);
   if (Number.isNaN(date.getTime())) return value;
   return date.toLocaleDateString("en-IN", {
     year: "numeric",
     month: "short",
     day: "numeric",
   });
 }

 function formatCurrency(value: number | null) {
   if (value == null) return null;
   return `₹${Number(value).toLocaleString("en-IN", {
     maximumFractionDigits: 0,
   })}`;
 }

 export default function CustomerDetailPage() {
   const params = useParams<{ id: string }>();
   const router = useRouter();
   const [customer, setCustomer] = useState<Customer | null>(null);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);

   const id = params?.id;

   useEffect(() => {
     if (!id) return;

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

       const { data, error } = await supabase
         .from("customers")
         .select(
           [
             "id",
             "name",
             "email",
             "source",
             "segment",
             "lifecycle_stage",
             "phone",
             "whatsapp",
             "preferred_contact",
             "status",
             "plan_type",
             "next_renewal_date",
             "renewal_status",
             "subscription_date",
             "package_revenue",
             "billed_amount",
             "outstanding_amount",
             "contract_term_months",
             "property_city",
             "property_area",
             "property_type",
             "property_status",
             "property_bhk",
             "property_furnishing",
             "manager_name",
             "manager_email",
             "manager_phone",
             "last_contacted_at",
             "next_follow_up_at",
             "payment_status",
             "notes",
           ].join(", "),
         )
         .eq("id", id)
         .maybeSingle();

       if (error) {
         setError("Failed to load customer.");
         setLoading(false);
         return;
       }

       if (!data) {
         setError("Customer not found.");
         setLoading(false);
         return;
       }

       setCustomer(data as Customer);
       setLoading(false);
     }

     load();
   }, [id, router]);

   const formattedRenewalDate = useMemo(
     () => formatDate(customer?.next_renewal_date ?? null),
     [customer?.next_renewal_date],
   );

   const formattedSubscriptionDate = useMemo(
     () => formatDate(customer?.subscription_date ?? null),
     [customer?.subscription_date],
   );

   const paymentStatus = useMemo(() => {
    if (!customer) return null;
    if (customer.payment_status) {
      return customer.payment_status;
    }
    const billed = customer.billed_amount;
    if (billed != null && Number(billed) > 0) return "paid";
    return "unpaid";
   }, [customer]);

   const formattedPackageRevenue = useMemo(
     () => formatCurrency(customer?.package_revenue ?? null),
     [customer?.package_revenue],
   );

   const formattedOutstanding = useMemo(
     () => formatCurrency(customer?.outstanding_amount ?? null),
     [customer?.outstanding_amount],
   );

   return (
     <div>
       <div className="flex items-center gap-2 text-sm text-stone-600">
         <Link href="/dashboard/customers" className="hover:underline">
           Customers
         </Link>
         <span>/</span>
         <span className="text-stone-900">
           {customer?.name ?? "Customer details"}
         </span>
       </div>

       <h2 className="mt-4 text-lg font-semibold text-stone-900">
         Customer overview
       </h2>
       <p className="mt-1 text-stone-600">
         View key information for this customer.
       </p>

       {loading && <p className="mt-6 text-stone-500">Loading customer...</p>}

       {!loading && error && (
         <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
           {error}
         </div>
       )}

       {!loading && !error && customer && (
         <div className="mt-6 grid gap-4 md:grid-cols-3">
           <div className="md:col-span-2 space-y-4">
             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <div className="flex items-start justify-between gap-4">
                 <div>
                   <p className="text-sm text-stone-500">Name</p>
                   <p className="mt-1 text-base font-semibold text-stone-900">
                     {customer.name}
                   </p>
                   <p className="mt-2 text-xs font-medium text-stone-500">
                     {customer.plan_type ?? "Plan not set"} •{" "}
                     {customer.lifecycle_stage ?? customer.status}
                   </p>
                   {customer.segment && (
                     <p className="mt-1 text-xs text-stone-500">
                       Segment: {customer.segment}
                     </p>
                   )}
                   {customer.source && (
                     <p className="mt-1 text-xs text-stone-500">
                       Source: {customer.source}
                     </p>
                   )}
                 </div>
                 <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-xs font-medium text-stone-700">
                   {customer.status}
                 </span>
               </div>
               <div className="mt-4 grid gap-4 md:grid-cols-2">
                 <div>
                   <p className="text-sm text-stone-500">Email</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {customer.email}
                   </p>
                 </div>
                 <div>
                   <p className="text-sm text-stone-500">Phone / WhatsApp</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {customer.phone ?? "Not set"}
                     {customer.whatsapp
                       ? ` · WhatsApp: ${customer.whatsapp}`
                       : ""}
                   </p>
                   {customer.preferred_contact && (
                     <p className="mt-1 text-xs text-stone-500">
                       Prefers{" "}
                       {customer.preferred_contact === "both"
                         ? "email & WhatsApp"
                         : customer.preferred_contact}
                     </p>
                   )}
                 </div>
               </div>
             </div>

             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <p className="text-sm text-stone-500">Property</p>
               <div className="mt-2 text-sm text-stone-900 space-y-1">
                 <p>
                   {customer.property_type ?? "Type not set"} •{" "}
                   {customer.property_status ?? "Status not set"}
                 </p>
                 <p className="text-stone-700">
                   {customer.property_area ?? "Area not set"}
                   {customer.property_city
                     ? `, ${customer.property_city}`
                     : ""}
                 </p>
                 <p className="text-xs text-stone-500">
                   {customer.property_bhk ?? "BHK not set"}
                   {customer.property_furnishing
                     ? ` • ${customer.property_furnishing}`
                     : ""}
                 </p>
               </div>
             </div>

             {(customer.manager_name ||
               customer.manager_email ||
               customer.manager_phone) && (
               <div className="bg-white rounded-xl border border-stone-200 p-4">
                 <p className="text-sm text-stone-500">Account manager</p>
                 <div className="mt-2 text-sm text-stone-900 space-y-1">
                   {customer.manager_name && <p>{customer.manager_name}</p>}
                   {customer.manager_email && (
                     <p className="text-stone-700">{customer.manager_email}</p>
                   )}
                   {customer.manager_phone && (
                     <p className="text-stone-700">{customer.manager_phone}</p>
                   )}
                 </div>
               </div>
             )}
           </div>
           <div className="space-y-4">
             <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
               <div>
                 <p className="text-sm text-stone-500">Subscription</p>
                 <p className="mt-1 text-base font-semibold text-stone-900">
                   {formattedSubscriptionDate ?? "Not set"}
                 </p>
                 {customer.renewal_status && (
                   <p className="mt-1 text-xs text-stone-500">
                     Renewal status: {customer.renewal_status}
                   </p>
                 )}
               </div>
               {customer.contract_term_months != null && (
                 <div>
                   <p className="text-sm text-stone-500">Contract term</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {customer.contract_term_months} months
                   </p>
                 </div>
               )}
             </div>
             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <p className="text-sm text-stone-500">Next renewal</p>
               <p className="mt-1 text-base font-semibold text-stone-900">
                 {formattedRenewalDate ?? "Not scheduled"}
               </p>
             </div>
             <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
               <div>
                 <p className="text-sm text-stone-500">Annual package revenue</p>
                 <p className="mt-1 text-base font-semibold text-stone-900">
                   {formattedPackageRevenue ?? "Not set"}
                 </p>
               </div>
               <div>
                 <p className="text-sm text-stone-500">Outstanding amount</p>
                 <p className="mt-1 text-base font-semibold text-stone-900">
                   {formattedOutstanding ?? "None"}
                 </p>
               </div>
               <div>
                 <p className="text-sm text-stone-500">Payment status</p>
                 <p className="mt-1">
                   <span
                     className={
                       paymentStatus === "paid"
                         ? "inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-100"
                         : "inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-100"
                     }
                   >
                     {paymentStatus === "paid" ? "Paid" : "Not paid"}
                   </span>
                 </p>
               </div>
             </div>
             {(customer.last_contacted_at || customer.next_follow_up_at) && (
               <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
                 <div>
                   <p className="text-sm text-stone-500">Last contacted</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {formatDate(customer.last_contacted_at) ?? "Not set"}
                   </p>
                 </div>
                 <div>
                   <p className="text-sm text-stone-500">Next follow-up</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {formatDate(customer.next_follow_up_at) ?? "Not set"}
                   </p>
                 </div>
               </div>
             )}
             {customer.notes && (
               <div className="bg-white rounded-xl border border-stone-200 p-4">
                 <p className="text-sm text-stone-500">Internal notes</p>
                 <p className="mt-1 text-sm text-stone-900 whitespace-pre-line">
                   {customer.notes}
                 </p>
               </div>
             )}
           </div>
         </div>
       )}
     </div>
   );
 }

