 "use client";

 import { useEffect, useMemo, useState } from "react";
 import Link from "next/link";
 import { useParams, useRouter } from "next/navigation";
 import { createClient } from "@/lib/supabase";
 import { logClientAdminActivity } from "@/lib/client-admin-activity";
 import { syncCustomerSubscriptionMirrorFromProperties } from "@/lib/sync-customer-subscription-mirror";
 import { resolveTierPriceForCity } from "@/lib/subscription-tier-pricing";
 import AddPropertyTransactionForm from "./AddPropertyTransactionForm";

 type Customer = {
   id: string;
   name: string;
   email: string;
   auth_user_id: string | null;
  /** When set, customer is archived (read-only in UI; email may be reused). */
  archived_at?: string | null;
  archived_reason?: string | null;
  source: string | null;
  segment: string | null;
  lifecycle_stage: string | null;
   phone: string | null;
   whatsapp: string | null;
   preferred_contact: string | null;
   status: string;
   plan_type: string | null;
  subscription_tier_id?: string | null;
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
   subscription_tier_id?: string | null;
   plan_type?: string | null;
   subscription_date?: string | null;
   next_renewal_date?: string | null;
   package_revenue?: number | null;
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

type CustomerNote = {
  id: string;
  customer_id: string;
  customer_property_id: string | null;
  body: string;
  is_customer_visible: boolean;
  author_email: string | null;
  created_at: string | null;
};

type PropertyHubTab = "details" | "activity" | "documents";

type SubscriptionTier = {
  id: string;
  name: string;
  description: string | null;
  is_custom: boolean;
  is_active: boolean;
};

type SubscriptionTierPrice = {
  id: string;
  tier_id: string;
  city: string;
  amount: number;
  currency: string | null;
  is_active: boolean;
};

type CustomerTransaction = {
  id: string;
  type: "renewal" | "payment" | "other";
  amount: number | null;
  description: string | null;
  date: string;
  last_edit_reason?: string | null;
  customer_property_id?: string | null;
  subscription_renewal_year?: number | null;
};

type PropertyRenewalYearStatusRow = {
  customer_property_id: string;
  subscription_year: number;
  is_paid: boolean;
  paid_source: string;
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

function splitName(fullName: string | null | undefined): {
  title: string;
  first: string;
  last: string;
} {
  if (!fullName) return { title: "", first: "", last: "" };
  const raw = fullName.trim().replace(/\s+/g, " ");
  if (!raw) return { title: "", first: "", last: "" };

  const parts = raw.split(" ");
  const titles = new Set(["mr", "mr.", "mrs", "mrs.", "ms", "ms.", "dr", "dr."]);
  let title = "";
  let first = "";
  let last = "";

  if (parts.length > 0 && titles.has(parts[0].toLowerCase())) {
    title = parts[0];
    first = parts[1] ?? "";
    last = parts.slice(2).join(" ");
  } else {
    first = parts[0];
    last = parts.slice(1).join(" ");
  }

  return {
    title: title,
    first,
    last,
  };
}

function joinName(title: string, first: string, last: string): string {
  const pieces = [title.trim(), first.trim(), last.trim()].filter(Boolean);
  return pieces.join(" ");
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
  const [notes, setNotes] = useState<CustomerNote[]>([]);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [newNoteCustomerVisible, setNewNoteCustomerVisible] = useState(false);
  /** `"account"` or a `customer_properties.id` while that note save is in flight */
  const [noteSavingKey, setNoteSavingKey] = useState<string | null>(null);
  const [propertyHubOpen, setPropertyHubOpen] = useState<Record<string, boolean>>({});
  const [propertyHubTab, setPropertyHubTab] = useState<Record<string, PropertyHubTab>>({});
  const [propertyNoteBody, setPropertyNoteBody] = useState<Record<string, string>>({});
  const [propertyNoteVisible, setPropertyNoteVisible] = useState<Record<string, boolean>>({});
  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [tierPrices, setTierPrices] = useState<SubscriptionTierPrice[]>([]);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);
  const [nameTitle, setNameTitle] = useState("");
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [transactionFeedback, setTransactionFeedback] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [editTxType, setEditTxType] = useState<CustomerTransaction["type"]>("renewal");
  const [editTxDate, setEditTxDate] = useState("");
  const [editTxAmount, setEditTxAmount] = useState("");
  const [editTxDescription, setEditTxDescription] = useState("");
  const [editTxReason, setEditTxReason] = useState("");
  const [editTxRenewalYear, setEditTxRenewalYear] = useState("");
  const [savingEditTx, setSavingEditTx] = useState(false);
  const [editTxError, setEditTxError] = useState<string | null>(null);
  const [renewalStatusByProperty, setRenewalStatusByProperty] = useState<
    Record<string, PropertyRenewalYearStatusRow[]>
  >({});
  const [savingRenewalYearKey, setSavingRenewalYearKey] = useState<string | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveReasonInput, setArchiveReasonInput] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

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
             "auth_user_id",
             "source",
             "segment",
             "lifecycle_stage",
             "phone",
             "whatsapp",
             "preferred_contact",
             "status",
             "plan_type",
            "subscription_tier_id",
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
            "archived_at",
            "archived_reason",
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
      const nameParts = splitName(customerData.name);
      setNameTitle(nameParts.title);
      setNameFirst(nameParts.first);
      setNameLast(nameParts.last);

      const { data: propsData, error: propsError } = await supabase
        .from("customer_properties")
        .select(
          "id, customer_id, full_address, city, area, property_type, property_status, property_sqft, property_bhk, property_furnishing, subscription_tier_id, plan_type, subscription_date, next_renewal_date, package_revenue",
        )
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

          const { data: renewalRows } = await supabase
            .from("property_renewal_year_status")
            .select("customer_property_id, subscription_year, is_paid, paid_source")
            .in("customer_property_id", propIds);
          const grouped: Record<string, PropertyRenewalYearStatusRow[]> = {};
          for (const r of renewalRows ?? []) {
            const row = r as PropertyRenewalYearStatusRow;
            if (!grouped[row.customer_property_id]) grouped[row.customer_property_id] = [];
            grouped[row.customer_property_id].push(row);
          }
          for (const pid of propIds) {
            (grouped[pid] ?? []).sort((a, b) => a.subscription_year - b.subscription_year);
          }
          setRenewalStatusByProperty(grouped);
        } else {
          setRenewalStatusByProperty({});
        }
      } else {
        setRenewalStatusByProperty({});
      }

      const { data: tiersData } = await supabase
        .from("subscription_tiers")
        .select("id, name, description, is_custom, is_active")
        .order("name", { ascending: true });
      if (tiersData) {
        const tierList = tiersData as unknown as SubscriptionTier[];
        setTiers(tierList);
        const tierIds = tierList.map((t) => t.id);
        if (tierIds.length > 0) {
          const { data: pricesData } = await supabase
            .from("subscription_tier_prices")
            .select("id, tier_id, city, amount, currency, is_active")
            .in("tier_id", tierIds);
          if (pricesData) {
            setTierPrices(pricesData as unknown as SubscriptionTierPrice[]);
          }
        }
      }

      const { data: notesData } = await supabase
        .from("customer_notes")
        .select(
          "id, customer_id, customer_property_id, body, is_customer_visible, author_email, created_at",
        )
        .eq("customer_id", id)
        .order("created_at", { ascending: false });
      if (notesData) {
        setNotes(notesData as unknown as CustomerNote[]);
      }
      const { data: transactionData, error: transactionLoadError } = await supabase
        .from("transactions")
        .select("id, type, amount, description, date, last_edit_reason, customer_property_id, subscription_renewal_year")
        .eq("customer_id", id)
        .order("date", { ascending: false });
      if (transactionLoadError) {
        setTransactionError("Failed to load transactions.");
      } else {
        setTransactions((transactionData ?? []) as unknown as CustomerTransaction[]);
        setTransactionError(null);
      }
      setLoadingTransactions(false);
       setLoading(false);
       setLoadingProperties(false);
     }

     load();
   }, [id, router]);

  useEffect(() => {
    if (properties.length <= 1) return;
    setPropertyHubOpen((prev) => {
      const next = { ...prev };
      let changed = false;
      properties.forEach((p, i) => {
        if (!(p.id in next)) {
          next[p.id] = i === 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [properties]);

  function tiersForPropertySelect(prop: CustomerProperty) {
    return tiers.filter((t) => t.is_active || t.id === prop.subscription_tier_id);
  }

  function propertyTransactionLabel(propertyId: string | null | undefined) {
    if (!propertyId) return "All properties (legacy)";
    const p = properties.find((x) => x.id === propertyId);
    if (!p) return "Property";
    const bit = p.city?.trim() || p.area?.trim() || p.full_address?.trim()?.slice(0, 36);
    return bit ? bit : "Property";
  }

  const legacyTransactions = useMemo(
    () => transactions.filter((t) => !t.customer_property_id),
    [transactions],
  );

  const propertyRollup = useMemo(() => {
    const dates = properties
      .map((p) => p.next_renewal_date)
      .filter((d): d is string => Boolean(d));
    dates.sort();
    const earliest = dates[0] ?? form?.next_renewal_date ?? null;
    let revenue = 0;
    for (const p of properties) {
      if (p.package_revenue != null && !Number.isNaN(Number(p.package_revenue))) {
        revenue += Number(p.package_revenue);
      }
    }
    if (properties.length === 0 && form?.package_revenue != null) {
      const n = Number(form.package_revenue);
      if (!Number.isNaN(n) && n > 0) revenue = n;
    }
    return {
      earliestLabel: earliest ? formatDate(earliest) : null,
      revenueLabel: revenue > 0 ? formatCurrency(revenue) : null,
      propertyCount: properties.length,
    };
  }, [properties, form?.next_renewal_date, form?.package_revenue]);

  async function refetchRenewalStatuses() {
    if (!id) return;
    const supabase = createClient();
    const { data: propsData } = await supabase
      .from("customer_properties")
      .select("id")
      .eq("customer_id", id);
    const propIds = (propsData ?? []).map((p: { id: string }) => p.id);
    if (propIds.length === 0) {
      setRenewalStatusByProperty({});
      return;
    }
    const { data: renewalRows } = await supabase
      .from("property_renewal_year_status")
      .select("customer_property_id, subscription_year, is_paid, paid_source")
      .in("customer_property_id", propIds);
    const grouped: Record<string, PropertyRenewalYearStatusRow[]> = {};
    for (const r of renewalRows ?? []) {
      const row = r as PropertyRenewalYearStatusRow;
      if (!grouped[row.customer_property_id]) grouped[row.customer_property_id] = [];
      grouped[row.customer_property_id].push(row);
    }
    for (const pid of propIds) {
      (grouped[pid] ?? []).sort((a, b) => a.subscription_year - b.subscription_year);
    }
    setRenewalStatusByProperty(grouped);
  }

  async function refetchAfterTransaction() {
    if (!id) return;
    const supabase = createClient();
    const [propsRes, custRes] = await Promise.all([
      supabase
        .from("customer_properties")
        .select(
          "id, customer_id, full_address, city, area, property_type, property_status, property_sqft, property_bhk, property_furnishing, subscription_tier_id, plan_type, subscription_date, next_renewal_date, package_revenue",
        )
        .eq("customer_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("customers")
        .select(
          "plan_type, subscription_tier_id, next_renewal_date, subscription_date, package_revenue",
        )
        .eq("id", id)
        .maybeSingle(),
    ]);
    if (propsRes.data) {
      setProperties(propsRes.data as unknown as CustomerProperty[]);
    }
    if (custRes.data) {
      const r = custRes.data as Pick<
        Customer,
        "plan_type" | "subscription_tier_id" | "next_renewal_date" | "subscription_date" | "package_revenue"
      >;
      setForm((f) => (f ? { ...f, ...r } : f));
      setCustomer((c) => (c ? { ...c, ...r } : c));
    }
    await refetchRenewalStatuses();
  }

  function mergeTransactionSuccess(
    result: {
      data?: CustomerTransaction;
      nextRenewalDate?: string | null;
    },
  ) {
    if (result.data) {
      setTransactions((prev) => [result.data!, ...prev]);
      setTransactionFeedback({ ok: true, msg: "Transaction added." });
      setTimeout(() => setTransactionFeedback(null), 4000);
    }
    void refetchAfterTransaction();
  }

  function findTierPriceForCustomer(
    tierId: string | null | undefined,
    city: string | null | undefined,
  ): SubscriptionTierPrice | null {
    const r = resolveTierPriceForCity(tierPrices, tierId, city);
    if (!r) return null;
    const { matchedCity, ...rest } = r;
    void matchedCity;
    return rest as SubscriptionTierPrice;
  }

  function computeLifecycleStage(value: Customer): string | null {
    const status = value.status;
    const paymentStatus = value.payment_status;
    const outstanding = value.outstanding_amount ?? 0;

    if (status === "Active") return "live";
    if (status === "Prospect") return "lead";
    if (status === "Inactive") {
      if (paymentStatus === "overdue" || outstanding > 0) return "churn_risk";
      return "churned";
    }
    return value.lifecycle_stage ?? null;
  }

   function updateField<K extends keyof Customer>(
     key: K,
     value: Customer[K],
   ) {
     setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
     setSaveSuccess(false);
     setSaveError(null);
   }

   async function handleSave() {
    if (!form || !customer || form.archived_at) return;
     setSaving(true);
     setSaveError(null);
     setSaveSuccess(false);

    const lifecycleStage = computeLifecycleStage(form);
    const fullName = joinName(nameTitle, nameFirst, nameLast) || form.name;

     const supabase = createClient();

     const { error: updateError } = await supabase
       .from("customers")
       .update({
        name: fullName,
         email: form.email,
         phone: form.phone,
         whatsapp: form.whatsapp,
         preferred_contact: form.preferred_contact,
         status: form.status,
         source: form.source,
         segment: form.segment,
         lifecycle_stage: lifecycleStage,
         renewal_status: form.renewal_status,
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

    setCustomer({ ...form, lifecycle_stage: lifecycleStage });
     setSaving(false);
     setSaveSuccess(true);
    void logClientAdminActivity({
      action: "customer.updated",
      resourceType: "customer",
      resourceId: customer.id,
      summary: `Updated customer profile: ${fullName}`,
    });
   }

   function updatePropertyField<K extends keyof CustomerProperty>(
     propId: string,
     key: K,
     value: CustomerProperty[K],
   ) {
     setProperties((prev) =>
       prev.map((p) => (p.id === propId ? { ...p, [key]: value } : p)),
     );
   }

   async function handleAddProperty() {
     if (!id || customer?.archived_at) return;
     const supabase = createClient();
     const { data, error } = await supabase
       .from("customer_properties")
       .insert({ customer_id: id })
       .select(
         "id, customer_id, full_address, city, area, property_type, property_status, property_sqft, property_bhk, property_furnishing, subscription_tier_id, plan_type, subscription_date, next_renewal_date, package_revenue",
       )
       .single();
     if (error) return;
     setProperties((prev) => [...prev, data as unknown as CustomerProperty]);
    void logClientAdminActivity({
      action: "property.added",
      resourceType: "customer",
      resourceId: id,
      summary: `Added property for ${form?.name ?? "customer"}`,
    });
   }

   async function handleSaveProperty(prop: CustomerProperty) {
     if (customer?.archived_at) {
       setPropertySaveError("This customer is archived and cannot be edited.");
       return;
     }
     setPropertySavingId(prop.id);
     setPropertySaveError(null);
     setPropertySaveSuccess(false);
     const supabase = createClient();

     if (prop.subscription_tier_id && !tiers.length) {
       setPropertySaveError("Subscription tiers are still loading. Please try again.");
       setPropertySavingId(null);
       return;
     }
     if (
       prop.subscription_tier_id &&
       !findTierPriceForCustomer(prop.subscription_tier_id, prop.city)
     ) {
       setPropertySaveError(
         "This tier has no price for this property’s city. Add a city price or pick a custom tier.",
       );
       setPropertySavingId(null);
       return;
     }

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
         subscription_tier_id: prop.subscription_tier_id ?? null,
         plan_type: prop.plan_type || null,
         subscription_date: prop.subscription_date || null,
         next_renewal_date: prop.next_renewal_date || null,
         package_revenue: prop.package_revenue ?? null,
       })
       .eq("id", prop.id);
     setPropertySavingId(null);
     if (error) {
       setPropertySaveError("Failed to save property.");
       return;
     }
     if (id) {
       await syncCustomerSubscriptionMirrorFromProperties(supabase, id);
       const { data: rolled } = await supabase
         .from("customers")
         .select(
           "plan_type, subscription_tier_id, next_renewal_date, subscription_date, package_revenue",
         )
         .eq("id", id)
         .maybeSingle();
       if (rolled && form) {
         const r = rolled as Pick<
           Customer,
           | "plan_type"
           | "subscription_tier_id"
           | "next_renewal_date"
           | "subscription_date"
           | "package_revenue"
         >;
         setForm((f) => (f ? { ...f, ...r } : f));
         setCustomer((c) => (c ? { ...c, ...r } : c));
       }
     }
     setPropertySaveSuccess(true);
     setPropertySaveError(null);
     setTimeout(() => setPropertySaveSuccess(false), 3000);
    if (id) {
      void logClientAdminActivity({
        action: "property.updated",
        resourceType: "customer",
        resourceId: id,
        summary: `Saved property for ${form?.name ?? "customer"}`,
      });
    }
   }

   async function handleDeleteProperty(prop: CustomerProperty) {
     if (customer?.archived_at) return;
     if (!confirm("Remove this property?")) return;
     const supabase = createClient();
     const { error } = await supabase
       .from("customer_properties")
       .delete()
       .eq("id", prop.id);
     if (error) return;
     setProperties((prev) => prev.filter((p) => p.id !== prop.id));
    if (id) {
      void logClientAdminActivity({
        action: "property.removed",
        resourceType: "customer",
        resourceId: id,
        summary: `Removed property for ${form?.name ?? "customer"}`,
      });
    }
   }

   async function handleUploadDocument(propertyId: string, file: File) {
     if (customer?.archived_at) return;
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
    if (id) {
      void logClientAdminActivity({
        action: "document.uploaded",
        resourceType: "customer",
        resourceId: id,
        summary: `Uploaded "${file.name}" for ${form?.name ?? "customer"}`,
      });
    }
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
    if (id) {
      void logClientAdminActivity({
        action: "document.deleted",
        resourceType: "customer",
        resourceId: id,
        summary: `Deleted document "${doc.file_name}" for ${form?.name ?? "customer"}`,
      });
    }
   }

   async function handleDownloadDocument(doc: PropertyDocument) {
     const supabase = createClient();
     const { data } = await supabase.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
     if (data?.signedUrl) window.open(data.signedUrl, "_blank");
   }

  async function handleCustomerLogin(action: "setup" | "reset") {
    if (form?.archived_at) {
      setLoginError("This customer is archived.");
      return;
    }
    if (!id || !loginPassword.trim() || loginPassword.length < 8) {
      setLoginError("Password must be at least 8 characters.");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    setLoginSuccess(null);
    try {
      const res = await fetch(`/api/customers/${id}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, password: loginPassword }),
      });
      const data = (await res.json()) as { error?: string; success?: boolean; message?: string };
      if (!res.ok) {
        setLoginError(data.error ?? "Request failed.");
        return;
      }
      setLoginSuccess(data.message ?? (action === "setup" ? "Login created." : "Password reset."));
      setLoginPassword("");
      if (action === "setup" && form) {
        const supabase = createClient();
        const { data: refreshed } = await supabase
          .from("customers")
          .select("auth_user_id")
          .eq("id", id)
          .single();
        if (refreshed) {
          setForm({ ...form, auth_user_id: refreshed.auth_user_id });
          setCustomer((c) => (c ? { ...c, auth_user_id: refreshed.auth_user_id } : c));
        }
      }
    } catch {
      setLoginError("Request failed.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function addCustomerNote(params: {
    customerPropertyId: string | null;
    body: string;
    customerVisible: boolean;
    onSuccessClear?: () => void;
  }) {
    const { customerPropertyId, body, customerVisible, onSuccessClear } = params;
    if (!id || !body.trim() || form?.archived_at) return;
    const savingKey = customerPropertyId ?? "account";
    setNoteSavingKey(savingKey);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("customer_notes")
      .insert({
        customer_id: id,
        customer_property_id: customerPropertyId,
        body: body.trim(),
        is_customer_visible: customerVisible,
        author_email: user?.email ?? null,
      })
      .select(
        "id, customer_id, customer_property_id, body, is_customer_visible, author_email, created_at",
      )
      .single();

    setNoteSavingKey(null);
    if (error) return;
    setNotes((prev) => [data as unknown as CustomerNote, ...prev]);
    onSuccessClear?.();
    void logClientAdminActivity({
      action: "note.added",
      resourceType: "customer",
      resourceId: id,
      summary: `Added ${customerPropertyId ? "property" : "account"} note for ${form?.name ?? "customer"}`,
    });
  }

  function openEditTransaction(tx: CustomerTransaction) {
    if (form?.archived_at) return;
    setEditingTransactionId(tx.id);
    setEditTxType(tx.type);
    setEditTxDate(tx.date);
    setEditTxAmount(tx.amount != null ? String(tx.amount) : "");
    setEditTxDescription(tx.description ?? "");
    setEditTxRenewalYear(tx.subscription_renewal_year != null ? String(tx.subscription_renewal_year) : "");
    setEditTxReason("");
    setEditTxError(null);
  }

  function cancelEditTransaction() {
    setEditingTransactionId(null);
    setEditTxRenewalYear("");
    setEditTxError(null);
  }

  async function handleConfirmArchive() {
    if (!id) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: archiveReasonInput.trim() || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setArchiveError(data.error ?? "Failed to archive customer.");
        return;
      }
      router.push("/dashboard/customers");
    } catch {
      setArchiveError("Failed to archive customer.");
    } finally {
      setArchiving(false);
    }
  }

  async function handleEditTransaction() {
    if (!id || !editingTransactionId || !editTxDate) return;
    if (form?.archived_at) {
      setEditTxError("This customer is archived.");
      return;
    }
    if (!editTxReason.trim()) {
      setEditTxError("Edit reason is required.");
      return;
    }
    setSavingEditTx(true);
    setEditTxError(null);
    try {
      const amount =
        editTxAmount.trim() === ""
          ? null
          : Number(editTxAmount.trim());
      const txBeingEdited = transactions.find((t) => t.id === editingTransactionId);
      const hasProperty = Boolean(txBeingEdited?.customer_property_id);
      const bodyPayload: Record<string, unknown> = {
        type: editTxType,
        date: editTxDate,
        amount: amount != null && !Number.isNaN(amount) ? amount : null,
        description: editTxDescription.trim() || null,
        edit_reason: editTxReason.trim(),
      };
      if (editTxType === "renewal" && hasProperty) {
        const trimmedY = editTxRenewalYear.trim();
        if (trimmedY !== "") {
          const y = Number(trimmedY);
          if (!Number.isInteger(y) || y < 1) {
            setEditTxError("Subscription year must be a positive integer.");
            setSavingEditTx(false);
            return;
          }
          bodyPayload.subscription_renewal_year = y;
        }
      }

      const res = await fetch(
        `/api/customers/${id}/transactions/${editingTransactionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        },
      );
      const result = (await res.json()) as {
        data?: CustomerTransaction;
        nextRenewalDate?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setEditTxError(result.error ?? "Failed to update transaction.");
        return;
      }
      if (result.data) {
        setTransactions((prev) =>
          prev.map((t) => (t.id === editingTransactionId ? result.data! : t)),
        );
        void refetchAfterTransaction();
        cancelEditTransaction();
      }
    } catch {
      setEditTxError("Failed to update transaction.");
    } finally {
      setSavingEditTx(false);
    }
  }

  const isArchived = Boolean(form?.archived_at);

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

       {!loading && !error && form && isArchived && (
         <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
           <p className="font-semibold">Archived customer</p>
           <p className="mt-1 text-amber-900/90">
             This record is read-only. Login has been removed; properties and transactions are kept for
             audit. You can create a new customer with the same email.
           </p>
           {form.archived_reason ? (
             <p className="mt-2 text-xs text-amber-900/80">
               Reason: {form.archived_reason}
             </p>
           ) : null}
           <p className="mt-1 text-xs text-amber-800/80">
             Archived{" "}
             {form.archived_at
               ? new Date(form.archived_at).toLocaleString("en-IN", {
                   dateStyle: "medium",
                   timeStyle: "short",
                 })
               : ""}
           </p>
         </div>
       )}

       {!loading && !error && form && (
         <div className="mt-3 flex flex-wrap items-center gap-3">
           <button
             type="button"
             onClick={() => {
               if (!form?.id) return;
               window.location.href = `/api/reports/customer/${encodeURIComponent(String(form.id))}`;
             }}
             className="inline-flex items-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50"
           >
             Export to Excel
           </button>
           {!isArchived && (
             <button
               type="button"
               onClick={() => {
                 setShowArchiveModal(true);
                 setArchiveError(null);
                 setArchiveReasonInput("");
               }}
               className="inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50"
             >
               Archive customer…
             </button>
           )}
         </div>
       )}

       {!loading && !error && (
         <div className="mt-4 flex flex-wrap items-center gap-3">
           <button
             type="button"
             onClick={handleSave}
             disabled={saving || !form || isArchived}
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
         <div
           className={`mt-6 grid gap-4 md:grid-cols-3${isArchived ? " pointer-events-none opacity-[0.88]" : ""}`}
         >
           <div className="md:col-span-2 space-y-4">
             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <div className="flex items-center justify-between gap-2">
                 <p className="text-sm font-medium text-stone-900">Customer login</p>
                 <span
                   className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                     form.auth_user_id
                       ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                       : "bg-amber-50 text-amber-700 border border-amber-100"
                   }`}
                 >
                   {form.auth_user_id ? "Login active" : "No login"}
                 </span>
               </div>
               <p className="mt-1 text-xs text-stone-500">
                 Email: <span className="font-medium text-stone-700">{form.email}</span>
               </p>
               <p className="mt-1 text-xs text-stone-500">
                 {form.auth_user_id
                   ? "Customer can sign in at the website. Reset password below."
                   : "Set up login so this customer can sign in at the website."}
               </p>
               <div className="mt-4 flex flex-wrap items-end gap-2">
                 <div className="flex-1 min-w-[180px]">
                   <label className="block text-xs text-stone-500 mb-1">
                     {form.auth_user_id ? "New password" : "Password"}
                   </label>
                   <input
                     type="password"
                     value={loginPassword}
                     onChange={(e) => {
                       setLoginPassword(e.target.value);
                       setLoginError(null);
                     }}
                     placeholder="Min 8 characters"
                     minLength={8}
                     disabled={isArchived}
                     className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                   />
                 </div>
                 {form.auth_user_id ? (
                   <button
                     type="button"
                     onClick={() => handleCustomerLogin("reset")}
                     disabled={isArchived || loginLoading || loginPassword.length < 8}
                     className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-white hover:bg-stone-600 disabled:opacity-50"
                   >
                     {loginLoading ? "Resetting…" : "Reset password"}
                   </button>
                 ) : (
                   <button
                     type="button"
                     onClick={() => handleCustomerLogin("setup")}
                     disabled={isArchived || loginLoading || loginPassword.length < 8}
                     className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                   >
                     {loginLoading ? "Setting up…" : "Set up login"}
                   </button>
                 )}
               </div>
               {loginSuccess && <p className="mt-3 text-sm text-emerald-700">{loginSuccess}</p>}
               {loginError && <p className="mt-3 text-sm text-red-600">{loginError}</p>}
             </div>

             <div className="bg-white rounded-xl border border-stone-200 p-4">
               <div className="flex items-start justify-between gap-4">
                 <div>
                  <p className="text-sm text-stone-500">Name</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <select
                      value={nameTitle}
                      onChange={(event) => setNameTitle(event.target.value)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Title</option>
                      <option value="Mr">Mr</option>
                      <option value="Ms">Ms</option>
                      <option value="Mrs">Mrs</option>
                      <option value="Dr">Dr</option>
                    </select>
                    <input
                      type="text"
                      placeholder="First name"
                      value={nameFirst}
                      onChange={(event) => setNameFirst(event.target.value)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Last name"
                      value={nameLast}
                      onChange={(event) => setNameLast(event.target.value)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    Stored as:{" "}
                    <span className="font-medium text-stone-800">
                      {joinName(nameTitle, nameFirst, nameLast) || form.name}
                    </span>
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
                     autoComplete="off"
                     value={form.email}
                     onChange={(event) =>
                       updateField("email", event.target.value)
                     }
                     className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                 <p className="text-sm font-medium text-stone-900">Properties hub</p>
                 <p className="text-xs text-stone-500 mt-0.5 max-w-xl">
                   Each card is one property, with tabs for details (incl. property notes), activity &
                   renewals, and documents. With multiple properties, use the arrow to collapse cards.
                 </p>
                 {!loadingProperties && (
                   <button
                     type="button"
                     onClick={handleAddProperty}
                     disabled={isArchived}
                     className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
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
                   {properties.map((prop) => {
                     const multiProp = properties.length > 1;
                     const hubOpen =
                       !multiProp ||
                       (propertyHubOpen[prop.id] ?? properties[0]?.id === prop.id);
                     const tab = propertyHubTab[prop.id] ?? "details";
                     const propertyNotes = notes.filter(
                       (n) => n.customer_property_id === prop.id,
                     );
                     return (
                     <div
                       key={prop.id}
                       className="rounded-xl border border-stone-200 border-l-4 border-l-blue-500 bg-gradient-to-br from-stone-50/80 to-white p-4 shadow-sm"
                     >
                       <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-200 pb-2">
                         <div className="flex items-start gap-2 min-w-0">
                           {multiProp ? (
                             <button
                               type="button"
                               aria-expanded={hubOpen}
                               onClick={() =>
                                 setPropertyHubOpen((prev) => {
                                   const open =
                                     prev[prop.id] ?? properties[0]?.id === prop.id;
                                   return { ...prev, [prop.id]: !open };
                                 })
                               }
                               className="mt-0.5 shrink-0 rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                             >
                               <span className="sr-only">
                                 {hubOpen ? "Collapse property" : "Expand property"}
                               </span>
                               <span aria-hidden>{hubOpen ? "▼" : "▶"}</span>
                             </button>
                           ) : null}
                           <div className="min-w-0">
                             <p className="text-sm font-semibold text-stone-900">
                               {propertyTransactionLabel(prop.id)}
                             </p>
                             <p className="text-[11px] text-stone-500">
                               Next renewal:{" "}
                               <span className="font-medium text-stone-800">
                                 {formatDate(prop.next_renewal_date ?? null) ?? "Not set"}
                               </span>
                             </p>
                           </div>
                         </div>
                         <span className="text-[10px] uppercase tracking-wide text-stone-400 shrink-0">
                           Property
                         </span>
                       </div>
                       {hubOpen ? (
                         <>
                           <div
                             role="tablist"
                             className="mt-3 flex flex-wrap gap-1 border-b border-stone-200"
                           >
                             {(
                               [
                                 ["details", "Property details"],
                                 ["activity", "Activity & renewals"],
                                 ["documents", "Documents"],
                               ] as const
                             ).map(([key, label]) => (
                               <button
                                 key={key}
                                 type="button"
                                 role="tab"
                                 aria-selected={tab === key}
                                 onClick={() =>
                                   setPropertyHubTab((prev) => ({
                                     ...prev,
                                     [prop.id]: key,
                                   }))
                                 }
                                 className={`px-3 py-2 text-xs font-medium rounded-t-md border-b-2 -mb-px transition-colors ${
                                   tab === key
                                     ? "border-blue-600 text-blue-800 bg-white"
                                     : "border-transparent text-stone-500 hover:text-stone-800"
                                 }`}
                               >
                                 {label}
                               </button>
                             ))}
                           </div>
                           <div className="pt-3 space-y-3">
                       {tab === "details" ? (
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
                             className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                             className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                             className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                           <input
                             type="text"
                             placeholder="BHK"
                             value={prop.property_bhk ?? ""}
                             onChange={(e) =>
                               updatePropertyField(prop.id, "property_bhk", e.target.value || null)
                             }
                             className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                             className="w-24 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                         </div>
                         <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                           <p className="text-xs font-medium text-stone-600">
                             Subscription (this property)
                           </p>
                           <select
                             value={prop.subscription_tier_id ?? ""}
                             onChange={(e) => {
                               const value = e.target.value || null;
                               const tier = tiers.find((t) => t.id === value) || null;
                               setProperties((prev) =>
                                 prev.map((p) => {
                                   if (p.id !== prop.id) return p;
                                   const next: CustomerProperty = {
                                     ...p,
                                     subscription_tier_id: value,
                                     plan_type: tier ? tier.name : null,
                                   };
                                   const price = tier
                                     ? findTierPriceForCustomer(tier.id, p.city)
                                     : null;
                                   if (price) next.package_revenue = Number(price.amount);
                                   return next;
                                 }),
                               );
                             }}
                             className="w-full max-w-md rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           >
                             <option value="">Subscription tier</option>
                             {tiersForPropertySelect(prop).map((tier) => (
                               <option key={tier.id} value={tier.id}>
                                 {tier.name}
                                 {!tier.is_active ? " (inactive)" : ""}
                               </option>
                             ))}
                           </select>
                           {prop.subscription_tier_id && (
                             <p className="text-[11px] text-stone-500">
                               {prop.plan_type ?? "Plan"}{" "}
                               {findTierPriceForCustomer(prop.subscription_tier_id, prop.city)
                                 ? `• ₹${Number(
                                     findTierPriceForCustomer(
                                       prop.subscription_tier_id,
                                       prop.city,
                                     )?.amount ?? 0,
                                   ).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                                 : "• No city price for this tier"}
                             </p>
                           )}
                           <div className="grid grid-cols-2 gap-2">
                             <div>
                               <label className="text-[11px] text-stone-500">Start date</label>
                               <input
                                 type="date"
                                 value={prop.subscription_date ?? ""}
                                 onChange={(e) =>
                                   updatePropertyField(
                                     prop.id,
                                     "subscription_date",
                                     e.target.value || null,
                                   )
                                 }
                                 className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                               />
                             </div>
                             <div>
                               <label className="text-[11px] text-stone-500">Next renewal</label>
                               <input
                                 type="date"
                                 value={prop.next_renewal_date ?? ""}
                                 onChange={(e) =>
                                   updatePropertyField(
                                     prop.id,
                                     "next_renewal_date",
                                     e.target.value || null,
                                   )
                                 }
                                 className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                               />
                             </div>
                           </div>
                           {prop.subscription_date && (
                             <button
                               type="button"
                               onClick={() => {
                                 const start = new Date(prop.subscription_date!);
                                 const next = new Date(start);
                                 next.setFullYear(next.getFullYear() + 1);
                                 updatePropertyField(
                                   prop.id,
                                   "next_renewal_date",
                                   next.toISOString().slice(0, 10),
                                 );
                               }}
                               className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50"
                             >
                               Next renewal = 1 year from start
                             </button>
                           )}
                           <div>
                             <label className="text-[11px] text-stone-500">Annual package revenue (₹)</label>
                             <input
                               type="number"
                               min={0}
                               value={prop.package_revenue ?? ""}
                               onChange={(e) =>
                                 updatePropertyField(
                                   prop.id,
                                   "package_revenue",
                                   e.target.value === "" ? null : Number(e.target.value),
                                 )
                               }
                               className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                             />
                           </div>
                         </div>
                         <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                           <p className="text-xs font-medium text-stone-600">
                             Notes (this property)
                           </p>
                           <p className="text-[10px] text-stone-500">
                             Scoped to this property. Customer-visible notes show on the portal under this
                             property.
                           </p>
                           <div className="max-h-36 overflow-y-auto space-y-2">
                             {propertyNotes.length === 0 && (
                               <p className="text-[11px] text-stone-500">
                                 No notes for this property yet.
                               </p>
                             )}
                             {propertyNotes.map((note) => {
                               const created = formatDate(note.created_at ?? null) ?? "";
                               const isCustomer = note.is_customer_visible;
                               return (
                                 <div
                                   key={note.id}
                                   className={
                                     isCustomer
                                       ? "rounded-lg border border-blue-100 bg-blue-50/80 px-2 py-1.5"
                                       : "rounded-lg border border-stone-200 bg-white px-2 py-1.5"
                                   }
                                 >
                                   <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-stone-600">
                                     <span>
                                       {note.author_email}
                                       {created ? ` · ${created}` : ""}
                                     </span>
                                     <span
                                       className={
                                         isCustomer
                                           ? "text-[10px] font-medium text-blue-700"
                                           : "text-[10px] font-medium text-stone-600"
                                       }
                                     >
                                       {isCustomer ? "Customer" : "Internal"}
                                     </span>
                                   </div>
                                   <p className="mt-0.5 text-[11px] text-stone-800 whitespace-pre-wrap">
                                     {note.body}
                                   </p>
                                 </div>
                               );
                             })}
                           </div>
                           <textarea
                             value={propertyNoteBody[prop.id] ?? ""}
                             onChange={(e) =>
                               setPropertyNoteBody((prev) => ({
                                 ...prev,
                                 [prop.id]: e.target.value,
                               }))
                             }
                             rows={2}
                             placeholder="Add a note for this property..."
                             className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           />
                           <div className="flex flex-wrap items-center justify-between gap-2">
                             <label className="inline-flex items-center gap-2 text-[11px] text-stone-700">
                               <input
                                 type="checkbox"
                                 checked={propertyNoteVisible[prop.id] ?? false}
                                 onChange={(e) =>
                                   setPropertyNoteVisible((prev) => ({
                                     ...prev,
                                     [prop.id]: e.target.checked,
                                   }))
                                 }
                                 className="h-3 w-3 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                               />
                               <span>Customer visible</span>
                             </label>
                             <button
                               type="button"
                               onClick={() =>
                                 void addCustomerNote({
                                   customerPropertyId: prop.id,
                                   body: propertyNoteBody[prop.id] ?? "",
                                   customerVisible: propertyNoteVisible[prop.id] ?? false,
                                   onSuccessClear: () => {
                                     setPropertyNoteBody((p) => ({ ...p, [prop.id]: "" }));
                                     setPropertyNoteVisible((p) => ({ ...p, [prop.id]: false }));
                                   },
                                 })
                               }
                               disabled={
                                 isArchived ||
                                 noteSavingKey === prop.id ||
                                 !(propertyNoteBody[prop.id] ?? "").trim()
                               }
                               className="rounded-lg bg-stone-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                             >
                               {noteSavingKey === prop.id ? "Saving…" : "Add note"}
                             </button>
                           </div>
                         </div>
                         <div className="flex flex-wrap gap-2 pt-3 border-t border-stone-200">
                           <button
                             type="button"
                             onClick={() => handleSaveProperty(prop)}
                             disabled={isArchived || propertySavingId === prop.id}
                             className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                           >
                             {propertySavingId === prop.id ? "Saving…" : "Save property"}
                           </button>
                           <button
                             type="button"
                             onClick={() => handleDeleteProperty(prop)}
                             disabled={isArchived}
                             className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                           >
                             Remove property
                           </button>
                         </div>
                       </div>
                       ) : tab === "activity" ? (
                         <div className="space-y-2">
                           <p className="text-xs font-medium text-stone-600">Activity & renewals</p>
                           <p className="text-[10px] text-stone-500">
                             Renewals logged here update this property’s next renewal (+1 year from payment date).
                           </p>
                           <AddPropertyTransactionForm
                             customerId={id!}
                             customerPropertyId={prop.id}
                             disabled={isArchived}
                             onSuccess={mergeTransactionSuccess}
                             onError={(msg) =>
                               setTransactionFeedback(
                                 msg ? { ok: false, msg } : null,
                               )
                             }
                           />
                           <div className="max-h-48 overflow-y-auto space-y-1 pt-1">
                             {loadingTransactions ? (
                               <p className="text-[11px] text-stone-500">Loading…</p>
                             ) : (
                               transactions
                                 .filter((tx) => tx.customer_property_id === prop.id)
                                 .map((tx) => (
                                   <div key={tx.id} className="space-y-1">
                                     {editingTransactionId === tx.id ? (
                                       <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2 space-y-2">
                                         <p className="text-[11px] font-medium text-stone-700">Edit transaction</p>
                                         <div className="grid gap-2 grid-cols-2">
                                           <div>
                                             <label className="block text-[10px] text-stone-600">Type</label>
                                             <select
                                               value={editTxType}
                                               onChange={(e) =>
                                                 setEditTxType(e.target.value as CustomerTransaction["type"])
                                               }
                                               className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                                             >
                                               <option value="renewal">Renewal</option>
                                               <option value="payment">Payment</option>
                                               <option value="other">Other</option>
                                             </select>
                                           </div>
                                           <div>
                                             <label className="block text-[10px] text-stone-600">Date</label>
                                             <input
                                               type="date"
                                               value={editTxDate}
                                               onChange={(e) => setEditTxDate(e.target.value)}
                                               className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                                             />
                                           </div>
                                         </div>
                                         <div className="grid gap-2 grid-cols-2">
                                           <div>
                                             <label className="block text-[10px] text-stone-600">Amount</label>
                                             <input
                                               type="number"
                                               min={0}
                                               value={editTxAmount}
                                               onChange={(e) => setEditTxAmount(e.target.value)}
                                               className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                                             />
                                           </div>
                                           <div>
                                             <label className="block text-[10px] text-stone-600">Description</label>
                                             <input
                                               type="text"
                                               value={editTxDescription}
                                               onChange={(e) => setEditTxDescription(e.target.value)}
                                               className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                                             />
                                           </div>
                                         </div>
                                         {editTxType === "renewal" && tx.customer_property_id ? (
                                           <div>
                                             <label className="block text-[10px] text-stone-600">
                                               Subscription year (optional)
                                             </label>
                                             <input
                                               type="number"
                                               min={1}
                                               value={editTxRenewalYear}
                                               onChange={(e) => setEditTxRenewalYear(e.target.value)}
                                               placeholder="Auto from dates if empty"
                                               className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                                             />
                                           </div>
                                         ) : null}
                                         <div>
                                           <label className="block text-[10px] text-stone-600">
                                             Reason <span className="text-red-600">*</span>
                                           </label>
                                           <input
                                             type="text"
                                             value={editTxReason}
                                             onChange={(e) => {
                                               setEditTxReason(e.target.value);
                                               setEditTxError(null);
                                             }}
                                             className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                                           />
                                         </div>
                                         {editTxError && (
                                           <p className="text-[10px] text-red-600">{editTxError}</p>
                                         )}
                                         <div className="flex gap-2">
                                           <button
                                             type="button"
                                             onClick={() => void handleEditTransaction()}
                                             disabled={savingEditTx}
                                             className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
                                           >
                                             {savingEditTx ? "Saving…" : "Save"}
                                           </button>
                                           <button
                                             type="button"
                                             onClick={cancelEditTransaction}
                                             disabled={savingEditTx}
                                             className="rounded border border-stone-300 bg-white px-2 py-1 text-[11px]"
                                           >
                                             Cancel
                                           </button>
                                         </div>
                                       </div>
                                     ) : (
                                       <div className="flex items-start justify-between gap-2 rounded-md bg-white border border-stone-100 px-2 py-1.5">
                                         <div>
                                           <p className="text-[11px] font-medium capitalize text-stone-800">
                                             {tx.type}
                                           </p>
                                           <p className="text-[10px] text-stone-500">
                                             {new Date(tx.date).toLocaleDateString("en-IN")}
                                           </p>
                                           {tx.type === "renewal" && tx.subscription_renewal_year != null ? (
                                             <p className="text-[10px] text-stone-500">
                                               Subscription year {tx.subscription_renewal_year}
                                             </p>
                                           ) : null}
                                           {tx.description && (
                                             <p className="text-[10px] text-stone-600">{tx.description}</p>
                                           )}
                                         </div>
                                         <div className="flex items-center gap-1 shrink-0">
                                           <span className="text-[11px] font-semibold">
                                             {tx.amount != null
                                               ? `₹${Number(tx.amount).toLocaleString("en-IN")}`
                                               : "—"}
                                           </span>
                                           <button
                                             type="button"
                                             onClick={() => openEditTransaction(tx)}
                                             disabled={isArchived}
                                             className="text-[10px] text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                                           >
                                             Edit
                                           </button>
                                         </div>
                                       </div>
                                     )}
                                   </div>
                                 ))
                             )}
                             {!loadingTransactions &&
                               transactions.filter((tx) => tx.customer_property_id === prop.id)
                                 .length === 0 && (
                                 <p className="text-[11px] text-stone-500">No entries for this property yet.</p>
                               )}
                           </div>
                           <div className="pt-3 border-t border-stone-200 space-y-2">
                             <p className="text-[11px] font-medium text-stone-700">Subscription years (paid)</p>
                             <p className="text-[10px] text-stone-500">
                               Renewal transactions set this automatically. Toggle only if you need to correct a
                               mistake. Paid requires a renewal entry for that year.
                             </p>
                             {(() => {
                               const fromTx = transactions
                                 .filter(
                                   (tx) =>
                                     tx.customer_property_id === prop.id &&
                                     tx.type === "renewal" &&
                                     tx.subscription_renewal_year != null,
                                 )
                                 .map((tx) => tx.subscription_renewal_year!);
                               const fromStatus = (renewalStatusByProperty[prop.id] ?? []).map(
                                 (r) => r.subscription_year,
                               );
                               const yearSet = new Set([...fromTx, ...fromStatus]);
                               const years = Array.from(yearSet).sort((a, b) => a - b);
                               if (years.length === 0) {
                                 return (
                                   <p className="text-[10px] text-stone-400">
                                     No subscription years yet — log a renewal above (set property start date
                                     first).
                                   </p>
                                 );
                               }
                               return (
                                 <ul className="space-y-1.5">
                                   {years.map((yr) => {
                                     const row = (renewalStatusByProperty[prop.id] ?? []).find(
                                       (r) => r.subscription_year === yr,
                                     );
                                     const hasTxn = transactions.some(
                                       (tx) =>
                                         tx.customer_property_id === prop.id &&
                                         tx.type === "renewal" &&
                                         tx.subscription_renewal_year === yr,
                                     );
                                     const paid = row ? row.is_paid : hasTxn;
                                     const key = `${prop.id}-${yr}`;
                                     return (
                                       <li
                                         key={yr}
                                         className="flex flex-wrap items-center justify-between gap-2 rounded border border-stone-100 bg-stone-50/80 px-2 py-1.5"
                                       >
                                         <span className="text-[11px] text-stone-800">
                                           Year {yr}
                                           <span
                                             className={`ml-2 font-medium ${
                                               paid ? "text-emerald-700" : "text-amber-800"
                                             }`}
                                           >
                                             {paid ? "Paid" : "Unpaid"}
                                           </span>
                                           {row?.paid_source === "admin_override" ? (
                                             <span className="ml-1 text-[10px] text-stone-500">(admin)</span>
                                           ) : null}
                                         </span>
                                         <div className="flex gap-1">
                                           <button
                                             type="button"
                                             disabled={
                                               isArchived ||
                                               savingRenewalYearKey === key ||
                                               (!paid && !hasTxn)
                                             }
                                             title={
                                               !paid && !hasTxn
                                                 ? "Add a renewal transaction for this year first"
                                                 : undefined
                                             }
                                             onClick={() => {
                                               if (!id || isArchived) return;
                                               void (async () => {
                                                 setSavingRenewalYearKey(key);
                                                 try {
                                                   const res = await fetch(
                                                     `/api/customers/${id}/properties/${prop.id}/renewal-years/${yr}`,
                                                     {
                                                       method: "PATCH",
                                                       headers: { "Content-Type": "application/json" },
                                                       body: JSON.stringify({ is_paid: !paid }),
                                                     },
                                                   );
                                                   const data = (await res.json()) as { error?: string };
                                                   if (!res.ok) {
                                                     setTransactionFeedback({
                                                       ok: false,
                                                       msg: data.error ?? "Could not update paid status.",
                                                     });
                                                     return;
                                                   }
                                                   await refetchRenewalStatuses();
                                                   setTransactionFeedback({
                                                     ok: true,
                                                     msg: `Year ${yr} marked ${!paid ? "paid" : "unpaid"}.`,
                                                   });
                                                   setTimeout(() => setTransactionFeedback(null), 4000);
                                                 } finally {
                                                   setSavingRenewalYearKey(null);
                                                 }
                                               })();
                                             }}
                                             className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[10px] text-stone-800 hover:bg-stone-50 disabled:opacity-40"
                                           >
                                             {savingRenewalYearKey === key
                                               ? "…"
                                               : paid
                                                 ? "Mark unpaid"
                                                 : "Mark paid"}
                                           </button>
                                         </div>
                                       </li>
                                     );
                                   })}
                                 </ul>
                               );
                             })()}
                           </div>
                         </div>
                       ) : tab === "documents" ? (
                         <div className="space-y-2">
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
                       ) : null}
                           </div>
                         </>
                       ) : null}
                     </div>
                   );
                   })}
                 </div>
               )}
             </div>

             <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <p className="text-sm font-medium text-stone-900">Notes & comments</p>
              <p className="text-xs text-stone-500">
                Account-wide only (not tied to a property). Property-specific notes live under each property
                card → Property details. Tick “Customer visible” to show in the customer portal.
              </p>
              <div className="space-y-2">
                <textarea
                  value={newNoteBody}
                  onChange={(event) => setNewNoteBody(event.target.value)}
                  rows={3}
                  placeholder="Add a new note..."
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700">
                    <input
                      type="checkbox"
                      checked={newNoteCustomerVisible}
                      onChange={(event) => setNewNoteCustomerVisible(event.target.checked)}
                      className="h-3 w-3 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Customer visible</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void addCustomerNote({
                        customerPropertyId: null,
                        body: newNoteBody,
                        customerVisible: newNoteCustomerVisible,
                        onSuccessClear: () => {
                          setNewNoteBody("");
                          setNewNoteCustomerVisible(false);
                        },
                      })
                    }
                    disabled={isArchived || noteSavingKey === "account" || !newNoteBody.trim()}
                    className="inline-flex items-center rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                  >
                    {noteSavingKey === "account" ? "Saving…" : "Add note"}
                  </button>
                </div>
              </div>
              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                {notes.filter((n) => !n.customer_property_id).length === 0 && (
                  <p className="text-xs text-stone-500">No account-wide notes yet.</p>
                )}
                {notes
                  .filter((n) => !n.customer_property_id)
                  .map((note) => {
                  const created = formatDate(note.created_at ?? null) ?? "";
                  const isCustomer = note.is_customer_visible;
                  return (
                    <div
                      key={note.id}
                      className={
                        isCustomer
                          ? "rounded-lg border border-blue-100 bg-blue-50 px-3 py-2"
                          : "rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-600">
                          {note.author_email && <span>{note.author_email}</span>}
                          {created && (
                            <>
                              <span>•</span>
                              <span>{created}</span>
                            </>
                          )}
                        </div>
                        <span
                          className={
                            isCustomer
                              ? "inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                              : "inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700"
                          }
                        >
                          {isCustomer ? "Customer note" : "Internal"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-stone-800 whitespace-pre-wrap">
                        {note.body}
                      </p>
                    </div>
                  );
                })}
              </div>
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
              <p className="text-sm font-medium text-stone-900">Annual package rollup</p>
              <p className="text-2xl font-semibold text-stone-900 tabular-nums">
                {propertyRollup.revenueLabel ?? "—"}
              </p>
              <p className="text-xs text-stone-500 leading-relaxed">
                {propertyRollup.propertyCount > 0 ? (
                  <>
                    Sum of <span className="font-medium text-stone-700">package revenue</span> across{" "}
                    {propertyRollup.propertyCount} propert
                    {propertyRollup.propertyCount === 1 ? "y" : "ies"} in the hub
                    {propertyRollup.earliestLabel ? (
                      <>
                        {" "}
                        · Earliest next renewal:{" "}
                        <span className="font-medium text-stone-700">{propertyRollup.earliestLabel}</span>
                      </>
                    ) : null}
                    . Edit amounts per property under{" "}
                    <span className="font-medium text-stone-700">Properties hub</span>.
                  </>
                ) : (
                  <>
                    No property rows yet — showing customer-level package revenue if set. Add properties
                    above to roll up from each subscription.
                  </>
                )}
              </p>
            </div>

            {transactionFeedback && (
              <p
                className={`text-xs px-2 py-1 rounded-lg ${
                  transactionFeedback.ok
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
                    : "bg-red-50 text-red-700 border border-red-100"
                }`}
              >
                {transactionFeedback.msg}
              </p>
            )}
            {transactionError && (
              <p className="text-xs text-red-600 px-2 py-1 rounded-lg bg-red-50 border border-red-100">
                {transactionError}
              </p>
            )}

            {properties.length === 0 && id && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
                <p className="text-sm font-medium text-stone-900">No property rows yet</p>
                <p className="text-xs text-stone-600">
                  Add a property in the hub, or log account-level transactions here (renewals update the
                  customer record only).
                </p>
                <AddPropertyTransactionForm
                  customerId={id}
                  customerPropertyId={null}
                  disabled={isArchived}
                  onSuccess={mergeTransactionSuccess}
                  onError={(msg) =>
                    setTransactionFeedback(msg ? { ok: false, msg } : null)
                  }
                />
              </div>
            )}

            {legacyTransactions.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
                <p className="text-sm font-medium text-stone-900">Legacy transactions</p>
                <p className="text-xs text-stone-500">
                  Not linked to a property row. Prefer logging renewals inside each property card.
                </p>
                <div className="max-h-56 overflow-y-auto space-y-1 border-t border-stone-100 pt-2">
                  {legacyTransactions.map((tx) => (
                    <div key={tx.id} className="space-y-1">
                      {editingTransactionId === tx.id ? (
                        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2 space-y-2">
                          <p className="text-[11px] font-medium text-stone-700">Edit transaction</p>
                          <div className="grid gap-2 grid-cols-2">
                            <select
                              value={editTxType}
                              onChange={(e) =>
                                setEditTxType(e.target.value as CustomerTransaction["type"])
                              }
                              className="rounded border border-stone-300 px-2 py-1 text-[11px]"
                            >
                              <option value="renewal">Renewal</option>
                              <option value="payment">Payment</option>
                              <option value="other">Other</option>
                            </select>
                            <input
                              type="date"
                              value={editTxDate}
                              onChange={(e) => setEditTxDate(e.target.value)}
                              className="rounded border border-stone-300 px-2 py-1 text-[11px]"
                            />
                          </div>
                          <div className="grid gap-2 grid-cols-2">
                            <input
                              type="number"
                              min={0}
                              value={editTxAmount}
                              onChange={(e) => setEditTxAmount(e.target.value)}
                              className="rounded border border-stone-300 px-2 py-1 text-[11px]"
                            />
                            <input
                              type="text"
                              value={editTxDescription}
                              onChange={(e) => setEditTxDescription(e.target.value)}
                              className="rounded border border-stone-300 px-2 py-1 text-[11px]"
                            />
                          </div>
                          <input
                            type="text"
                            value={editTxReason}
                            onChange={(e) => {
                              setEditTxReason(e.target.value);
                              setEditTxError(null);
                            }}
                            placeholder="Edit reason *"
                            className="w-full rounded border border-stone-300 px-2 py-1 text-[11px]"
                          />
                          {editTxError && (
                            <p className="text-[10px] text-red-600">{editTxError}</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleEditTransaction()}
                              disabled={savingEditTx}
                              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditTransaction}
                              className="rounded border px-2 py-1 text-[11px]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-[11px]">
                          <div>
                            <span className="font-medium capitalize">{tx.type}</span>
                            <span className="text-stone-500">
                              {" "}
                              · {new Date(tx.date).toLocaleDateString("en-IN")}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditTransaction(tx)}
                            disabled={isArchived}
                            className="text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
           </div>
         </div>
       )}

      {showArchiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            className="bg-white rounded-xl border border-stone-200 max-w-md w-full p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-dialog-title"
          >
            <h3 id="archive-dialog-title" className="text-base font-semibold text-stone-900">
              Archive this customer?
            </h3>
            <p className="mt-2 text-sm text-stone-600">
              Their login will be removed, they will disappear from lists and company reports, and
              properties and transactions stay in the database for audit. You can create a new customer
              with the same email afterward.
            </p>
            <label className="block mt-3 text-xs font-medium text-stone-600">Reason (optional)</label>
            <textarea
              value={archiveReasonInput}
              onChange={(e) => setArchiveReasonInput(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. Requested removal, duplicate account…"
            />
            {archiveError && <p className="mt-2 text-sm text-red-600">{archiveError}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                disabled={archiving}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={archiving}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {archiving ? "Archiving…" : "Archive customer"}
              </button>
            </div>
          </div>
        </div>
      )}
     </div>
   );
 }

