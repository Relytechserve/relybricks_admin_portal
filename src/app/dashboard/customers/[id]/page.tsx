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

 type CustomerProperty = {
   id: string;
   customer_id: string;
   full_address: string | null;
   city: string | null;
   area: string | null;
   property_type: string | null;
   property_status: string | null;
   property_sqft: number | null;
   property_bhk: string | null;
   property_furnishing: string | null;
 };

 type PropertyDocument = {
   id: string;
   customer_property_id: string;
   file_name: string;
   storage_path: string;
   file_size: number | null;
   content_type: string | null;
   created_at: string | null;
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
  const [form, setForm] = useState<Customer | null>(null);
  const [properties, setProperties] = useState<CustomerProperty[]>([]);
   const [loading, setLoading] = useState(true);
   const [loadingProperties, setLoadingProperties] = useState(true);
   const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [propertySaveSuccess, setPropertySaveSuccess] = useState(false);
  const [propertySaveError, setPropertySaveError] = useState<string | null>(null);
  const [propertySavingId, setPropertySavingId] = useState<string | null>(null);
  const [documentsByPropertyId, setDocumentsByPropertyId] = useState<Record<string, PropertyDocument[]>>({});
  const [documentUploadingPropertyId, setDocumentUploadingPropertyId] = useState<string | null>(null);
  const [documentMessage, setDocumentMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedFileByPropertyId, setSelectedFileByPropertyId] = useState<Record<string, File | null>>({});

   const id = params?.id;

   useEffect(() => {
     if (!id) return;

     const supabase = createClient();

     async function load() {
       setLoading(true);
       setLoadingProperties(true);
       setError(null);

       const {
         data: { user },
       } = await supabase.auth.getUser();

       if (!user) {
         router.push("/login");
         setLoading(false);
         setLoadingProperties(false);
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
         setLoadingProperties(false);
         return;
       }

      if (!data) {
        setError("Customer not found.");
        setLoading(false);
        setLoadingProperties(false);
        return;
      }

      const customerData = data as unknown as Customer;
      setCustomer(customerData);
      setForm(customerData);

      const { data: propsData, error: propsError } = await supabase
        .from("customer_properties")
        .select("id, customer_id, full_address, city, area, property_type, property_status, property_sqft, property_bhk, property_furnishing")
        .eq("customer_id", id)
        .order("created_at", { ascending: true });

      if (!propsError && propsData) {
        const propsList = (propsData as unknown) as CustomerProperty[];
        setProperties(propsList);
        const propIds = propsList.map((p) => p.id);
        if (propIds.length > 0) {
          const { data: docsData } = await supabase
            .from("property_documents")
            .select("id, customer_property_id, file_name, storage_path, file_size, content_type, created_at")
            .in("customer_property_id", propIds)
            .order("created_at", { ascending: false });
          if (docsData) {
            const byProp = (docsData as unknown as PropertyDocument[]).reduce<Record<string, PropertyDocument[]>>(
              (acc, doc) => {
                const pid = doc.customer_property_id;
                if (!acc[pid]) acc[pid] = [];
                acc[pid].push(doc);
                return acc;
              },
              {},
            );
            setDocumentsByPropertyId(byProp);
          }
        }
      }
       setLoading(false);
       setLoadingProperties(false);
     }

     load();
   }, [id, router]);

  const formattedRenewalDate = useMemo(
    () => formatDate(form?.next_renewal_date ?? null),
    [form?.next_renewal_date],
  );

   const paymentStatus = useMemo(() => {
     if (!form) return null;
     if (form.payment_status) {
       return form.payment_status;
     }
     const billed = form.billed_amount;
     if (billed != null && Number(billed) > 0) return "paid";
     return "unpaid";
   }, [form]);

   const formattedPackageRevenue = useMemo(
     () => formatCurrency(form?.package_revenue ?? null),
     [form?.package_revenue],
   );

   const formattedOutstanding = useMemo(
     () => formatCurrency(form?.outstanding_amount ?? null),
     [form?.outstanding_amount],
   );

   function updateField<K extends keyof Customer>(
     key: K,
     value: Customer[K],
   ) {
     setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
     setSaveSuccess(false);
     setSaveError(null);
   }

   async function handleSave() {
     if (!form || !customer) return;
     setSaving(true);
     setSaveError(null);
     setSaveSuccess(false);

     const supabase = createClient();

     const { error: updateError } = await supabase
       .from("customers")
       .update({
         name: form.name,
         email: form.email,
         phone: form.phone,
         whatsapp: form.whatsapp,
         preferred_contact: form.preferred_contact,
         status: form.status,
         plan_type: form.plan_type,
         source: form.source,
         segment: form.segment,
         lifecycle_stage: form.lifecycle_stage,
         subscription_date: form.subscription_date,
         next_renewal_date: form.next_renewal_date,
         renewal_status: form.renewal_status,
         package_revenue: form.package_revenue,
         billed_amount: form.billed_amount,
         outstanding_amount: form.outstanding_amount,
         payment_status: form.payment_status,
         property_city: form.property_city,
         property_area: form.property_area,
         property_type: form.property_type,
         property_status: form.property_status,
         property_bhk: form.property_bhk,
         property_furnishing: form.property_furnishing,
         manager_name: form.manager_name,
         manager_email: form.manager_email,
         manager_phone: form.manager_phone,
         last_contacted_at: form.last_contacted_at,
         next_follow_up_at: form.next_follow_up_at,
         notes: form.notes,
       })
       .eq("id", customer.id);

     if (updateError) {
       setSaveError("Failed to save changes.");
       setSaving(false);
       return;
     }

     setCustomer(form);
     setSaving(false);
     setSaveSuccess(true);
   }

   function updatePropertyField(
     propId: string,
     key: keyof CustomerProperty,
     value: string | number | null,
   ) {
     setProperties((prev) =>
       prev.map((p) => (p.id === propId ? { ...p, [key]: value } : p)),
     );
   }

   async function handleAddProperty() {
     if (!id) return;
     const supabase = createClient();
     const { data, error } = await supabase
       .from("customer_properties")
       .insert({ customer_id: id })
       .select("id, customer_id, full_address, city, area, property_type, property_status, property_sqft, property_bhk, property_furnishing")
       .single();
     if (error) return;
     setProperties((prev) => [...prev, data as unknown as CustomerProperty]);
   }

   async function handleSaveProperty(prop: CustomerProperty) {
     setPropertySavingId(prop.id);
     setPropertySaveError(null);
     setPropertySaveSuccess(false);
     const supabase = createClient();
     const { error } = await supabase
       .from("customer_properties")
       .update({
         full_address: prop.full_address || null,
         city: prop.city || null,
         area: prop.area || null,
         property_type: prop.property_type || null,
         property_status: prop.property_status || null,
         property_sqft: prop.property_sqft ?? null,
         property_bhk: prop.property_bhk || null,
         property_furnishing: prop.property_furnishing || null,
       })
       .eq("id", prop.id);
     setPropertySavingId(null);
     if (error) {
       setPropertySaveError("Failed to save property.");
       return;
     }
     setPropertySaveSuccess(true);
     setPropertySaveError(null);
     setTimeout(() => setPropertySaveSuccess(false), 3000);
   }

   async function handleDeleteProperty(prop: CustomerProperty) {
     if (!confirm("Remove this property?")) return;
     const supabase = createClient();
     const { error } = await supabase
       .from("customer_properties")
       .delete()
       .eq("id", prop.id);
     if (error) return;
     setProperties((prev) => prev.filter((p) => p.id !== prop.id));
   }

   async function handleUploadDocument(propertyId: string, file: File) {
     setDocumentUploadingPropertyId(propertyId);
     setDocumentMessage(null);
     const supabase = createClient();
     const ext = file.name.replace(/^.*\./, "") || "";
     const storagePath = `${propertyId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
     const { error: uploadError } = await supabase.storage
       .from("property-documents")
       .upload(storagePath, file, { contentType: file.type, upsert: false });
     if (uploadError) {
       setDocumentMessage({ type: "error", text: "Upload failed." });
       setDocumentUploadingPropertyId(null);
       return;
     }
     const { data: row, error: insertError } = await supabase
       .from("property_documents")
       .insert({
         customer_property_id: propertyId,
         file_name: file.name,
         storage_path: storagePath,
         file_size: file.size,
         content_type: file.type || null,
       })
       .select("id, customer_property_id, file_name, storage_path, file_size, content_type, created_at")
       .single();
     setDocumentUploadingPropertyId(null);
     if (insertError) {
       setDocumentMessage({ type: "error", text: "Saved file record failed." });
       return;
     }
     setDocumentsByPropertyId((prev) => ({
       ...prev,
       [propertyId]: [row as unknown as PropertyDocument, ...(prev[propertyId] ?? [])],
     }));
     setSelectedFileByPropertyId((prev) => ({ ...prev, [propertyId]: null }));
     setDocumentMessage({ type: "success", text: "Document uploaded." });
     setTimeout(() => setDocumentMessage(null), 3000);
   }

   async function handleDeleteDocument(doc: PropertyDocument) {
     if (!confirm("Delete this document?")) return;
     const supabase = createClient();
     await supabase.storage.from("property-documents").remove([doc.storage_path]);
     await supabase.from("property_documents").delete().eq("id", doc.id);
     setDocumentsByPropertyId((prev) => {
       const list = (prev[doc.customer_property_id] ?? []).filter((d) => d.id !== doc.id);
       return { ...prev, [doc.customer_property_id]: list };
     });
   }

   async function handleDownloadDocument(doc: PropertyDocument) {
     const supabase = createClient();
     const { data } = await supabase.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
     if (data?.signedUrl) window.open(data.signedUrl, "_blank");
   }

   return (
     <div>
       <div className="flex items-center gap-2 text-sm text-stone-600">
         <Link href="/dashboard/customers" className="hover:underline">
           Customers
         </Link>
         <span>/</span>
         <span className="text-stone-900">
          {form?.name ?? "Customer details"}
         </span>
       </div>

       <h2 className="mt-4 text-lg font-semibold text-stone-900">
         Customer overview
       </h2>
       <p className="mt-1 text-stone-600">
        View and enrich key information for this customer.
       </p>

       {!loading && !error && (
         <div className="mt-4 flex flex-wrap items-center gap-3">
           <button
             type="button"
             onClick={handleSave}
             disabled={saving || !form}
             className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-60"
           >
             {saving ? "Saving…" : "Save changes"}
           </button>
           {saveSuccess && (
             <span className="text-sm text-emerald-700">
               Changes saved.
             </span>
           )}
           {saveError && (
             <span className="text-sm text-red-600">
               {saveError}
             </span>
           )}
         </div>
       )}

       {loading && <p className="mt-6 text-stone-500">Loading customer...</p>}

       {!loading && error && (
         <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
           {error}
         </div>
       )}

       {!loading && !error && form && (
         <div className="mt-6 grid gap-4 md:grid-cols-3">
           <div className="md:col-span-2 space-y-4">
             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <div className="flex items-start justify-between gap-4">
                 <div>
                   <p className="text-sm text-stone-500">Name</p>
                   <p className="mt-1 text-base font-semibold text-stone-900">
                     {form.name}
                   </p>
                   <p className="mt-2 text-xs font-medium text-stone-500">
                     {form.plan_type ?? "Plan not set"} •{" "}
                     {form.lifecycle_stage ?? form.status}
                   </p>
                   {form.segment && (
                     <p className="mt-1 text-xs text-stone-500">
                       Segment: {form.segment}
                     </p>
                   )}
                   {form.source && (
                     <p className="mt-1 text-xs text-stone-500">
                       Source: {form.source}
                     </p>
                   )}
                 </div>
                 <div>
                   <p className="text-sm text-stone-500 mb-1">Customer status</p>
                   <select
                     value={form.status}
                     onChange={(event) =>
                       updateField("status", event.target.value as Customer["status"])
                     }
                     className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                   >
                     <option value="Active">Active</option>
                     <option value="Inactive">Inactive</option>
                     <option value="Prospect">Prospect</option>
                   </select>
                 </div>
               </div>
               <div className="mt-4 grid gap-4 md:grid-cols-2">
                 <div>
                   <p className="text-sm text-stone-500">Email</p>
                   <input
                     type="email"
                     value={form.email}
                     onChange={(event) =>
                       updateField("email", event.target.value)
                     }
                     className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                   />
                 </div>
                 <div>
                   <p className="text-sm text-stone-500">Phone / WhatsApp</p>
                   <div className="mt-1 flex flex-col gap-2 text-sm text-stone-900">
                     <input
                       type="tel"
                       placeholder="Phone"
                       value={form.phone ?? ""}
                       onChange={(event) =>
                         updateField(
                           "phone",
                           event.target.value || null,
                         )
                       }
                       className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                     />
                     <input
                       type="tel"
                       placeholder="WhatsApp"
                       value={form.whatsapp ?? ""}
                       onChange={(event) =>
                         updateField(
                           "whatsapp",
                           event.target.value || null,
                         )
                       }
                       className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                     />
                     <select
                       value={form.preferred_contact ?? ""}
                       onChange={(event) =>
                         updateField(
                           "preferred_contact",
                           (event.target.value || null) as Customer["preferred_contact"],
                         )
                       }
                       className="w-full rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                     >
                       <option value="">Preferred contact</option>
                       <option value="email">Email</option>
                       <option value="whatsapp">WhatsApp</option>
                       <option value="both">Email & WhatsApp</option>
                     </select>
                   </div>
                 </div>
               </div>
             </div>

             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <div className="flex items-center justify-between gap-2">
                 <p className="text-sm text-stone-500">Properties</p>
                 {!loadingProperties && (
                   <button
                     type="button"
                     onClick={handleAddProperty}
                     className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                   >
                     Add property
                   </button>
                 )}
               </div>
               {loadingProperties ? (
                 <p className="mt-2 text-sm text-stone-500">Loading properties...</p>
               ) : (
                 <div className="mt-3 space-y-4">
                   {(propertySaveSuccess || propertySaveError) && (
                     <p className={`text-sm ${propertySaveSuccess ? "text-emerald-700" : "text-red-600"}`}>
                       {propertySaveSuccess ? "Property saved." : propertySaveError}
                     </p>
                   )}
                   {properties.length === 0 && (
                     <p className="text-sm text-stone-500">No properties yet. Add one above.</p>
                   )}
                   {properties.map((prop) => (
                     <div
                       key={prop.id}
                       className="rounded-lg border border-stone-200 bg-stone-50/50 p-3 space-y-2"
                     >
                       <div className="grid gap-2 text-sm">
                         <label className="text-stone-600">Address</label>
                         <textarea
                           placeholder="Full property address"
                           value={prop.full_address ?? ""}
                           onChange={(e) =>
                             updatePropertyField(prop.id, "full_address", e.target.value || null)
                           }
                           rows={2}
                           className="w-full rounded-lg border border-stone-300 px-3 py-2 text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                         />
                         <div className="grid grid-cols-2 gap-2">
                           <input
                             type="text"
                             placeholder="City"
                             value={prop.city ?? ""}
                             onChange={(e) =>
                               updatePropertyField(prop.id, "city", e.target.value || null)
                             }
                             className="rounded-lg border border-stone-300 px-3 py-2 text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                           <input
                             type="text"
                             placeholder="Area"
                             value={prop.area ?? ""}
                             onChange={(e) =>
                               updatePropertyField(prop.id, "area", e.target.value || null)
                             }
                             className="rounded-lg border border-stone-300 px-3 py-2 text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                         </div>
                         <div className="flex flex-wrap items-center gap-2">
                           <select
                             value={prop.property_type ?? ""}
                             onChange={(e) =>
                               updatePropertyField(
                                 prop.id,
                                 "property_type",
                                 e.target.value || null,
                               )
                             }
                             className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                           >
                             <option value="">Type</option>
                             <option value="apartment">Apartment</option>
                             <option value="villa">Villa</option>
                             <option value="bungalow">Bungalow</option>
                             <option value="land">Land</option>
                           </select>
                           <select
                             value={prop.property_status ?? ""}
                             onChange={(e) =>
                               updatePropertyField(
                                 prop.id,
                                 "property_status",
                                 e.target.value || null,
                               )
                             }
                             className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                           >
                             <option value="">Status</option>
                             <option value="Occupied">Occupied</option>
                             <option value="Vacant">Vacant</option>
                           </select>
                           <input
                             type="number"
                             placeholder="Sq ft"
                             value={prop.property_sqft ?? ""}
                             onChange={(e) => {
                               const raw = e.target.value;
                               updatePropertyField(
                                 prop.id,
                                 "property_sqft",
                                 raw === "" ? null : (parseInt(raw, 10) || null),
                               );
                             }}
                             className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                           <input
                             type="text"
                             placeholder="BHK"
                             value={prop.property_bhk ?? ""}
                             onChange={(e) =>
                               updatePropertyField(prop.id, "property_bhk", e.target.value || null)
                             }
                             className="w-16 rounded-lg border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                           <input
                             type="text"
                             placeholder="Furnishing"
                             value={prop.property_furnishing ?? ""}
                             onChange={(e) =>
                               updatePropertyField(
                                 prop.id,
                                 "property_furnishing",
                                 e.target.value || null,
                               )
                             }
                             className="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                         </div>
                         <div className="flex gap-2 pt-1">
                           <button
                             type="button"
                             onClick={() => handleSaveProperty(prop)}
                             disabled={propertySavingId === prop.id}
                             className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                           >
                             {propertySavingId === prop.id ? "Saving…" : "Save"}
                           </button>
                           <button
                             type="button"
                             onClick={() => handleDeleteProperty(prop)}
                             className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                           >
                             Remove
                           </button>
                         </div>
                         <div className="mt-3 pt-3 border-t border-stone-200">
                           <p className="text-xs font-medium text-stone-600 mb-2">Documents</p>
                           {documentMessage && (
                             <p className={`text-xs mb-2 ${documentMessage.type === "success" ? "text-emerald-700" : "text-red-600"}`}>
                               {documentMessage.text}
                             </p>
                           )}
                           <ul className="text-xs text-stone-700 space-y-1 mb-2">
                             {(documentsByPropertyId[prop.id] ?? []).map((doc) => (
                               <li key={doc.id} className="flex items-center gap-2 flex-wrap">
                                 <span className="truncate flex-1 min-w-0">{doc.file_name}</span>
                                 <button
                                   type="button"
                                   onClick={() => handleDownloadDocument(doc)}
                                   className="text-blue-600 hover:underline shrink-0"
                                 >
                                   Download
                                 </button>
                                 <button
                                   type="button"
                                   onClick={() => handleDeleteDocument(doc)}
                                   className="text-red-600 hover:underline shrink-0"
                                 >
                                   Delete
                                 </button>
                               </li>
                             ))}
                             {(documentsByPropertyId[prop.id] ?? []).length === 0 && (
                               <li className="text-stone-500">No documents yet.</li>
                             )}
                           </ul>
                           <div className="flex items-center gap-2 flex-wrap">
                             <input
                               type="file"
                               accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt,.csv"
                               className="text-xs text-stone-600 file:mr-2 file:rounded file:border-0 file:bg-stone-100 file:px-2 file:py-1 file:text-xs"
                               onChange={(e) => {
                                 const file = e.target.files?.[0];
                                 setSelectedFileByPropertyId((prev) => ({ ...prev, [prop.id]: file ?? null }));
                               }}
                             />
                             <button
                               type="button"
                               disabled={!selectedFileByPropertyId[prop.id] || documentUploadingPropertyId === prop.id}
                               onClick={() => {
                                 const file = selectedFileByPropertyId[prop.id];
                                 if (file) handleUploadDocument(prop.id, file);
                               }}
                               className="rounded-lg bg-stone-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-600 disabled:opacity-50"
                             >
                               {documentUploadingPropertyId === prop.id ? "Uploading…" : "Upload"}
                             </button>
                             {selectedFileByPropertyId[prop.id] && (
                               <span className="text-stone-500 truncate max-w-[120px]">
                                 {selectedFileByPropertyId[prop.id]?.name}
                               </span>
                             )}
                           </div>
                         </div>
                       </div>
                     </div>
                   ))}
                 </div>
               )}
             </div>

             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <p className="text-sm text-stone-500">Account manager</p>
               <div className="mt-2 text-sm text-stone-900 space-y-2">
                 <input
                   type="text"
                   placeholder="Name"
                   value={form.manager_name ?? ""}
                   onChange={(event) =>
                     updateField(
                       "manager_name",
                       event.target.value || null,
                     )
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 <input
                   type="email"
                   placeholder="Email"
                   value={form.manager_email ?? ""}
                   onChange={(event) =>
                     updateField(
                       "manager_email",
                       event.target.value || null,
                     )
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 <input
                   type="tel"
                   placeholder="Phone"
                   value={form.manager_phone ?? ""}
                   onChange={(event) =>
                     updateField(
                       "manager_phone",
                       event.target.value || null,
                     )
                   }
                   className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
               </div>
             </div>
           </div>
           <div className="space-y-4">
              <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
               <div>
                 <p className="text-sm text-stone-500">Subscription start date</p>
                 <input
                   type="date"
                   value={form.subscription_date ?? ""}
                   onChange={(event) =>
                     updateField("subscription_date", event.target.value || null)
                   }
                   className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 <select
                   value={form.renewal_status ?? ""}
                   onChange={(event) =>
                     updateField(
                       "renewal_status",
                       (event.target.value || null) as Customer["renewal_status"],
                     )
                   }
                   className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 >
                   <option value="">Renewal status</option>
                   <option value="on_time">On time</option>
                   <option value="overdue">Overdue</option>
                   <option value="cancelled">Cancelled</option>
                 </select>
               </div>
                {customer?.contract_term_months != null && (
                 <div>
                   <p className="text-sm text-stone-500">Contract term</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {customer.contract_term_months} months
                   </p>
                 </div>
               )}
             </div>
             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <p className="text-sm text-stone-500">Next subscription renewal date</p>
               <p className="mt-0.5 text-xs text-stone-500">Yearly subscription</p>
               <p className="mt-1 text-base font-semibold text-stone-900">
                 {formattedRenewalDate ?? "Not scheduled"}
               </p>
               <div className="mt-2 flex flex-wrap items-center gap-2">
                 <input
                   type="date"
                   value={form.next_renewal_date ?? ""}
                   onChange={(event) =>
                     updateField(
                       "next_renewal_date",
                       event.target.value || null,
                     )
                   }
                   className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 {form.subscription_date && (
                   <button
                     type="button"
                     onClick={() => {
                       const start = new Date(form!.subscription_date!);
                       const next = new Date(start);
                       next.setFullYear(next.getFullYear() + 1);
                       updateField(
                         "next_renewal_date",
                         next.toISOString().slice(0, 10),
                       );
                     }}
                     className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                   >
                     Set to 1 year from start
                   </button>
                 )}
               </div>
             </div>
             <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
               <div>
                 <p className="text-sm text-stone-500">Annual package revenue</p>
                 <p className="mt-1 text-base font-semibold text-stone-900">
                   {formattedPackageRevenue ?? "Not set"}
                 </p>
                 <input
                   type="number"
                   min={0}
                   value={form.package_revenue ?? ""}
                   onChange={(event) =>
                     updateField(
                       "package_revenue",
                       event.target.value === ""
                         ? null
                         : Number(event.target.value),
                     )
                   }
                   className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
               </div>
               <div>
                 <p className="text-sm text-stone-500">Outstanding amount</p>
                 <p className="mt-1 text-base font-semibold text-stone-900">
                   {formattedOutstanding ?? "None"}
                 </p>
                 <input
                   type="number"
                   min={0}
                   value={form.outstanding_amount ?? ""}
                   onChange={(event) =>
                     updateField(
                       "outstanding_amount",
                       event.target.value === ""
                         ? null
                         : Number(event.target.value),
                     )
                   }
                   className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
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
                 <select
                   value={form.payment_status ?? ""}
                   onChange={(event) =>
                     updateField(
                       "payment_status",
                       (event.target.value || null) as Customer["payment_status"],
                     )
                   }
                   className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 >
                   <option value="">Not set</option>
                   <option value="paid">Paid</option>
                   <option value="partially_paid">Partially paid</option>
                   <option value="overdue">Overdue</option>
                   <option value="write_off">Write off</option>
                 </select>
               </div>
            </div>
            {(customer?.last_contacted_at || customer?.next_follow_up_at) && (
               <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
                 <div>
                   <p className="text-sm text-stone-500">Last contacted</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {formatDate(customer?.last_contacted_at ?? null) ?? "Not set"}
                   </p>
                 </div>
                 <div>
                   <p className="text-sm text-stone-500">Next follow-up</p>
                   <p className="mt-1 text-sm text-stone-900">
                     {formatDate(customer?.next_follow_up_at ?? null) ?? "Not set"}
                   </p>
                 </div>
               </div>
            )}
            {form?.notes && (
               <div className="bg-white rounded-xl border border-stone-200 p-4">
                 <p className="text-sm text-stone-500">Internal notes</p>
                 <textarea
                   value={form.notes ?? ""}
                   onChange={(event) =>
                     updateField("notes", event.target.value || null)
                   }
                   rows={4}
                   className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                 />
               </div>
             )}
           </div>
         </div>
       )}
     </div>
   );
 }

