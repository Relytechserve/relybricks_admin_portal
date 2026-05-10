import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

function tolFor(delta: number): number {
  return 1.5 + Math.min(50, Math.abs(delta) * 0.00025);
}

type Row = {
  id: number;
  source_file: string;
  tx_date: string;
  particulars: string;
  withdrawal: number | null;
  deposit: number | null;
  balance: number | null;
};

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local." },
      { status: 500 },
    );
  }

  const client = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const PAGE = 900;
  const all: Row[] = [];
  let offset = 0;
  while (offset < 5_500_000) {
    const { data, error } = await client
      .from("financial_reconciliation_transactions")
      .select("id, source_file, tx_date, particulars, withdrawal, deposit, balance")
      .order("source_file", { ascending: true })
      .order("tx_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    for (const row of data) {
      all.push({
        id: Number(row.id),
        source_file: String(row.source_file ?? ""),
        tx_date: String(row.tx_date ?? ""),
        particulars: String(row.particulars ?? ""),
        withdrawal: row.withdrawal != null ? Number(row.withdrawal) : null,
        deposit: row.deposit != null ? Number(row.deposit) : null,
        balance: row.balance != null ? Number(row.balance) : null,
      });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  type Anomaly = {
    transactionId: number;
    tx_date: string;
    particularsSnippet: string;
    issue: string;
    actualDeltaBalance: string;
    expectedNetDepositMinusWithdrawal: string;
  };

  const byFile = new Map<string, { anomalies: Anomaly[]; rowsChecked: number }>();

  let currentFile = "";
  let seq: Row[] = [];

  function processGroup(group: Row[]) {
    if (group.length === 0) return;
    const fileKey = group[0]!.source_file;
    const acc = byFile.get(fileKey) ?? { anomalies: [], rowsChecked: 0 };
    let prevBal: number | null = null;

    for (const r of group) {
      acc.rowsChecked += 1;
      const w = r.withdrawal != null && r.withdrawal > 0 ? r.withdrawal : 0;
      const d = r.deposit != null && r.deposit > 0 ? r.deposit : 0;
      const b = r.balance;

      if (prevBal != null && b != null && Number.isFinite(prevBal) && Number.isFinite(b)) {
        const actualDelta = Math.round((b - prevBal) * 100) / 100;
        const expectedNet = Math.round((d - w) * 100) / 100;
        const tol = tolFor(actualDelta);

        if (w <= 0 && d <= 0 && Math.abs(actualDelta) > tol) {
          acc.anomalies.push({
            transactionId: r.id,
            tx_date: r.tx_date,
            particularsSnippet: r.particulars.slice(0, 140),
            issue: "Balance changed but both withdrawal and deposit are empty on this row",
            actualDeltaBalance: String(actualDelta),
            expectedNetDepositMinusWithdrawal: "0",
          });
        } else if (Math.abs(actualDelta - expectedNet) > tol + 8) {
          acc.anomalies.push({
            transactionId: r.id,
            tx_date: r.tx_date,
            particularsSnippet: r.particulars.slice(0, 140),
            issue: "Running balance step does not match deposit − withdrawal (possible wrong column or PDF order)",
            actualDeltaBalance: String(actualDelta),
            expectedNetDepositMinusWithdrawal: String(expectedNet),
          });
        }
      }

      if (b != null && Number.isFinite(b)) prevBal = b;
    }

    byFile.set(fileKey, acc);
  }

  for (const r of all) {
    if (r.source_file !== currentFile) {
      if (seq.length) processGroup(seq);
      seq = [];
      currentFile = r.source_file;
    }
    seq.push(r);
  }
  if (seq.length) processGroup(seq);

  const files = Array.from(byFile.entries()).map(([file, v]) => ({
    file,
    rowsChecked: v.rowsChecked,
    anomalyCount: v.anomalies.length,
    anomalies: v.anomalies.slice(0, 80),
  }));

  const totalAnomalies = files.reduce((s, f) => s + f.anomalyCount, 0);

  return NextResponse.json(
    {
      summary: {
        totalRows: all.length,
        totalAnomalies,
        filesWithIssues: files.filter((f) => f.anomalyCount > 0).length,
        note: "Per source_file, rows ordered by tx_date then id. Large anomaly lists are truncated per file. Re-run statement scan after parser updates, then compare again.",
      },
      files,
    },
    { headers: NO_STORE },
  );
}
