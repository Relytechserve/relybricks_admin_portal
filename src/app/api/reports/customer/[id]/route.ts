import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { loadCustomerNotesForCustomer } from "@/lib/customer-notes";

type Customer = {
  id: string;
  name: string;
  email: string;
  status: string;
  plan_type: string | null;
  lifecycle_stage: string | null;
  subscription_date: string | null;
  next_renewal_date: string | null;
  renewal_status: string | null;
  package_revenue: number | null;
  billed_amount: number | null;
  outstanding_amount: number | null;
  payment_status: string | null;
  customer_location: string | null;
  property_city: string | null;
  property_area: string | null;
  property_type: string | null;
  property_status: string | null;
  notes: string | null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const params = await Promise.resolve(context.params);
  const customerId = typeof params?.id === "string" ? params.id : "";
  if (!customerId) {
    return NextResponse.json({ error: "Missing customer id." }, { status: 400 });
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      {
        error:
          "Server configuration is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 500 },
    );
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is required. Add it to .env.local (Supabase Dashboard > Settings > API > service_role key).",
      },
      { status: 500 },
    );
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in as admin." }, { status: 401 });
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json({ error: "Only admins can generate reports." }, { status: 403 });
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: customerData, error: customerError } = await serviceClient
    .from("customers")
    .select(
      [
        "id",
        "name",
        "email",
        "status",
        "plan_type",
        "lifecycle_stage",
        "subscription_date",
        "next_renewal_date",
        "renewal_status",
        "package_revenue",
        "billed_amount",
        "outstanding_amount",
        "payment_status",
        "customer_location",
        "property_city",
        "property_area",
        "property_type",
        "property_status",
        "notes",
      ].join(", "),
    )
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) {
    return NextResponse.json(
      { error: `Failed to load customer: ${customerError.message}` },
      { status: 500 },
    );
  }

  if (!customerData) {
    return NextResponse.json(
      { error: `No customer found with id ${customerId}.` },
      { status: 404 },
    );
  }

  const customer = customerData as unknown as Customer;

  const notesResult = await loadCustomerNotesForCustomer(serviceClient, customerId);
  const notes = notesResult.notes;

  const propertyColumnsBase =
    "id, full_address, city, area, property_type, property_status, plan_type, subscription_date, next_renewal_date, package_revenue, property_sqft, property_bhk, property_furnishing";
  const propertyColumnsWithRental = `${propertyColumnsBase}, rental_value`;

  let properties: Record<string, unknown>[] = [];
  const propsWithRental = await serviceClient
    .from("customer_properties")
    .select(propertyColumnsWithRental)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  if (propsWithRental.error && /rental_value|schema cache/i.test(propsWithRental.error.message)) {
    const fallback = await serviceClient
      .from("customer_properties")
      .select(propertyColumnsBase)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });
    properties = (fallback.data ?? []).map((row) => ({ ...row, rental_value: null }));
  } else if (!propsWithRental.error) {
    properties = propsWithRental.data ?? [];
  }

  const { data: transactions } = await serviceClient
    .from("transactions")
    .select(
      "id, type, amount, description, date, customer_property_id, subscription_renewal_year, last_edit_reason",
    )
    .eq("customer_id", customerId)
    .order("date", { ascending: false });

  const propertyIds = properties.map((p) => String(p.id ?? "")).filter(Boolean);
  let renewalStatuses: {
    customer_property_id: string;
    subscription_year: number;
    is_paid: boolean;
    paid_source: string;
  }[] = [];
  if (propertyIds.length > 0) {
    const { data } = await serviceClient
      .from("property_renewal_year_status")
      .select("customer_property_id, subscription_year, is_paid, paid_source")
      .in("customer_property_id", propertyIds);
    renewalStatuses = (data ?? []) as typeof renewalStatuses;
  }

  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Customer");
  summarySheet.columns = [
    { header: "Field", key: "field", width: 26 },
    { header: "Value", key: "value", width: 50 },
  ];

  const summaryRows: { field: string; value: string | number | null }[] = [
    { field: "Customer ID", value: customer.id },
    { field: "Name", value: customer.name },
    { field: "Email", value: customer.email },
    { field: "Status", value: customer.status },
    { field: "Lifecycle stage", value: customer.lifecycle_stage },
    { field: "Plan type", value: customer.plan_type },
    { field: "Subscription date", value: customer.subscription_date },
    { field: "Next renewal date", value: customer.next_renewal_date },
    { field: "Renewal status", value: customer.renewal_status },
    {
      field: "Package revenue (₹)",
      value: customer.package_revenue ?? null,
    },
    {
      field: "Billed amount (₹)",
      value: customer.billed_amount ?? null,
    },
    {
      field: "Outstanding amount (₹)",
      value: customer.outstanding_amount ?? null,
    },
    {
      field: "Payment status",
      value: customer.payment_status,
    },
    { field: "Customer location", value: customer.customer_location },
    { field: "Legacy property city", value: customer.property_city },
    { field: "Legacy property area", value: customer.property_area },
    { field: "Property type", value: customer.property_type },
    { field: "Property status", value: customer.property_status },
    { field: "Internal notes (legacy)", value: customer.notes },
  ];

  summaryRows.forEach((row) => summarySheet.addRow(row));
  summarySheet.getRow(1).font = { bold: true };

  const notesSheet = workbook.addWorksheet("Notes");
  notesSheet.columns = [
    { header: "Created at", key: "created_at", width: 24 },
    { header: "Author", key: "author_email", width: 30 },
    { header: "Property ID", key: "customer_property_id", width: 38 },
    { header: "Visibility", key: "visibility", width: 16 },
    { header: "Body", key: "body", width: 80 },
  ];

  notes.forEach((note) => {
    notesSheet.addRow({
      created_at: note.created_at,
      author_email: note.author_email,
      customer_property_id: note.customer_property_id ?? "",
      visibility: note.is_customer_visible ? "Customer" : "Internal",
      body: note.body,
    });
  });
  notesSheet.getRow(1).font = { bold: true };

  const propertiesSheet = workbook.addWorksheet("Properties");
  propertiesSheet.columns = [
    { header: "Property ID", key: "id", width: 26 },
    { header: "Address", key: "full_address", width: 36 },
    { header: "City", key: "city", width: 16 },
    { header: "Area", key: "area", width: 16 },
    { header: "Type", key: "property_type", width: 14 },
    { header: "Status", key: "property_status", width: 14 },
    { header: "Plan type", key: "plan_type", width: 14 },
    { header: "Subscription date", key: "subscription_date", width: 16 },
    { header: "Next renewal date", key: "next_renewal_date", width: 18 },
    { header: "Package revenue (₹)", key: "package_revenue", width: 18 },
    { header: "Rental value (₹)", key: "rental_value", width: 16 },
    { header: "Sq ft", key: "property_sqft", width: 10 },
    { header: "BHK", key: "property_bhk", width: 8 },
    { header: "Furnishing", key: "property_furnishing", width: 14 },
  ];
  properties.forEach((prop) => {
    propertiesSheet.addRow({
      id: prop.id,
      full_address: prop.full_address,
      city: prop.city,
      area: prop.area,
      property_type: prop.property_type,
      property_status: prop.property_status,
      plan_type: prop.plan_type,
      subscription_date: prop.subscription_date,
      next_renewal_date: prop.next_renewal_date,
      package_revenue: prop.package_revenue ?? undefined,
      rental_value: prop.rental_value ?? undefined,
      property_sqft: prop.property_sqft,
      property_bhk: prop.property_bhk,
      property_furnishing: prop.property_furnishing,
    });
  });
  propertiesSheet.getRow(1).font = { bold: true };

  const transactionsSheet = workbook.addWorksheet("Transactions");
  transactionsSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Type", key: "type", width: 12 },
    { header: "Amount (₹)", key: "amount", width: 14 },
    { header: "Description", key: "description", width: 40 },
    { header: "Property ID", key: "customer_property_id", width: 26 },
    { header: "Subscription year", key: "subscription_renewal_year", width: 16 },
    { header: "Last edit reason", key: "last_edit_reason", width: 30 },
  ];
  (transactions ?? []).forEach((tx) => {
    transactionsSheet.addRow({
      date: tx.date,
      type: tx.type,
      amount: tx.amount ?? undefined,
      description: tx.description,
      customer_property_id: tx.customer_property_id ?? "",
      subscription_renewal_year: tx.subscription_renewal_year ?? "",
      last_edit_reason: tx.last_edit_reason,
    });
  });
  transactionsSheet.getRow(1).font = { bold: true };

  const renewalSheet = workbook.addWorksheet("Subscription years paid");
  renewalSheet.columns = [
    { header: "Property ID", key: "customer_property_id", width: 26 },
    { header: "Subscription year", key: "subscription_year", width: 16 },
    { header: "Paid", key: "is_paid", width: 10 },
    { header: "Source", key: "paid_source", width: 16 },
  ];
  (renewalStatuses ?? []).forEach((row) => {
    renewalSheet.addRow({
      customer_property_id: row.customer_property_id,
      subscription_year: row.subscription_year,
      is_paid: row.is_paid ? "Yes" : "No",
      paid_source: row.paid_source,
    });
  });
  renewalSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = customer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "customer";
  const filename = `relybricks-customer-${safeName.toLowerCase()}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

