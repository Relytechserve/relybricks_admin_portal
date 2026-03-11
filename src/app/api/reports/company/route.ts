import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { PostgrestError } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

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
  outstanding_amount: number | null;
  property_city: string | null;
  property_area: string | null;
  property_type: string | null;
  property_status: string | null;
  created_at: string | null;
  updated_at?: string | null;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  const fromDate = fromStr ? new Date(fromStr) : null;
  const toDate = toStr ? new Date(toStr) : null;

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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
    "outstanding_amount",
    "property_city",
    "property_area",
    "property_type",
    "property_status",
    "created_at",
  ];
  const optionalColumns = [
    "source",
    "segment",
    "lifecycle_stage",
    "payment_status",
    "updated_at",
  ];
  const allColumns = [...baseColumns, ...optionalColumns];

  let customers: CustomerRow[] | null = null;

  const { data: fullData, error: fullError } = await serviceClient
    .from("customers")
    .select(allColumns.join(", "));

  if (fullError) {
    const { data: fallbackData, error: fallbackError } = await serviceClient
      .from("customers")
      .select(baseColumns.join(", "));
    if (fallbackError) {
      const message =
        (fallbackError as PostgrestError).message ?? "Failed to load customers for report.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    customers = (fallbackData ?? []) as unknown as CustomerRow[];
  } else {
    customers = (fullData ?? []) as unknown as CustomerRow[];
  }

  const inRange = (createdAt: string | null) => {
    if (!fromDate && !toDate) return true;
    const created = parseDate(createdAt);
    if (!created) return false;
    if (fromDate && created < fromDate) return false;
    if (toDate) {
      const endOfDay = new Date(toDate);
      endOfDay.setHours(23, 59, 59, 999);
      if (created > endOfDay) return false;
    }
    return true;
  };

  const filtered = (customers ?? []).filter((c) => inRange(c.subscription_date ?? c.created_at));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Company insights");

  sheet.columns = [
    { header: "Customer ID", key: "id", width: 26 },
    { header: "Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 30 },
    { header: "Status", key: "status", width: 14 },
    { header: "Lifecycle stage", key: "lifecycle_stage", width: 18 },
    { header: "Plan type", key: "plan_type", width: 16 },
    { header: "Source", key: "source", width: 16 },
    { header: "Segment", key: "segment", width: 16 },
    { header: "Subscription date", key: "subscription_date", width: 16 },
    { header: "Next renewal date", key: "next_renewal_date", width: 18 },
    { header: "Renewal status", key: "renewal_status", width: 16 },
    { header: "Package revenue (₹)", key: "package_revenue", width: 18 },
    { header: "Billed amount (₹)", key: "billed_amount", width: 18 },
    { header: "Outstanding amount (₹)", key: "outstanding_amount", width: 20 },
    { header: "Payment status", key: "payment_status", width: 16 },
    { header: "Property city", key: "property_city", width: 18 },
    { header: "Property area", key: "property_area", width: 18 },
    { header: "Property type", key: "property_type", width: 16 },
    { header: "Property status", key: "property_status", width: 16 },
    { header: "Created at", key: "created_at", width: 20 },
    { header: "Last updated", key: "updated_at", width: 20 },
  ];

  filtered.forEach((c) => {
    sheet.addRow({
      id: c.id,
      name: c.name,
      email: c.email,
      status: c.status,
      lifecycle_stage: c.lifecycle_stage,
      plan_type: c.plan_type,
      source: c.source,
      segment: c.segment,
      subscription_date: c.subscription_date,
      next_renewal_date: c.next_renewal_date,
      renewal_status: c.renewal_status,
      package_revenue: c.package_revenue ?? undefined,
      billed_amount: c.billed_amount ?? undefined,
      outstanding_amount: c.outstanding_amount ?? undefined,
      payment_status: c.payment_status,
      property_city: c.property_city,
      property_area: c.property_area,
      property_type: c.property_type,
      property_status: c.property_status,
      created_at: c.created_at,
      updated_at: c.updated_at ?? null,
    });
  });

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `relybricks-company-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

