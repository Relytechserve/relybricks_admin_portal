#!/usr/bin/env node
/**
 * Truncate financial reconciliation data via RPC (or fallback), then print row counts for verification.
 *
 * Usage:
 *   node scripts/frt-reset-verify.mjs
 *
 * Requires .env.local (or env): NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TABLE = "financial_reconciliation_transactions";

function loadEnvLocal() {
  const p = resolve(__dirname, "../.env.local");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function fallbackReset(client) {
  const delLinks = await client
    .from("invoice_transaction_links")
    .delete()
    .lte("created_at", "2999-12-31T23:59:59Z");
  if (delLinks.error) return { ok: false, message: delLinks.error.message };

  const clearLines = await client
    .from("invoice_line_items")
    .update({ source_transaction_id: null })
    .not("source_transaction_id", "is", null);
  if (clearLines.error) return { ok: false, message: clearLines.error.message };

  const delTx = await client.from(TABLE).delete().gte("tx_date", "1900-01-01");
  if (delTx.error) return { ok: false, message: delTx.error.message };

  return { ok: true };
}

async function resetWithFallback(client) {
  const rpc = await client.rpc("reset_financial_reconciliation_transactions");
  if (!rpc.error) {
    console.log("reset: RPC reset_financial_reconciliation_transactions() succeeded.");
    return { ok: true };
  }

  console.warn(
    "reset: RPC failed — trying fallback deletes (invoice_transaction_links, line items FK, financial_reconciliation_transactions):",
    rpc.error.message ?? String(rpc.error),
  );

  const fb = await fallbackReset(client);
  if (!fb.ok) {
    console.error("Fallback failed:", fb.message);
    return { ok: false, message: fb.message };
  }
  console.log("reset: Fallback succeeded.");
  return { ok: true };
}

async function countFrt(client) {
  const r = await client.from(TABLE).select("*", { count: "exact", head: true });
  return { count: r.count ?? null, error: r.error };
}

async function countLinks(client) {
  const r = await client.from("invoice_transaction_links").select("*", { count: "exact", head: true });
  return { count: r.count ?? null, error: r.error };
}

async function countLineItemsLinked(client) {
  const r = await client
    .from("invoice_line_items")
    .select("*", { count: "exact", head: true })
    .not("source_transaction_id", "is", null);
  return { count: r.count ?? null, error: r.error };
}

function printCounts(label, frt, links, lined) {
  console.log("");
  console.log(`${label}`);
  console.log(`financial_reconciliation_transactions count: ${frt}`);
  console.log(`invoice_transaction_links count: ${links}`);
  console.log(`invoice_line_items with source_transaction_id set: ${lined}`);
}

loadEnvLocal();

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const beforeFrt = await countFrt(client);
const beforeLinks = await countLinks(client);
const beforeLined = await countLineItemsLinked(client);
if (beforeFrt.error) {
  console.error("Count frt:", beforeFrt.error.message);
  process.exit(1);
}
printCounts("(before)", beforeFrt.count, beforeLinks.count, beforeLined.count);

const resetResult = await resetWithFallback(client);
if (!resetResult.ok) {
  console.error("Reset failed:", resetResult.message);
  process.exit(1);
}

const afterFrt = await countFrt(client);
const afterLinks = await countLinks(client);
const afterLined = await countLineItemsLinked(client);
if (afterFrt.error) {
  console.error("Count frt after:", afterFrt.error.message);
  process.exit(1);
}

printCounts("(after reset)", afterFrt.count, afterLinks.count, afterLined.count);

const ok =
  Number(afterFrt.count) === 0 &&
  Number(afterLinks.count) === 0 &&
  Number(afterLined.count) === 0;

if (!ok) {
  console.warn("\nWarning: Expected all three counts to be 0.");
  process.exit(2);
}

console.log("\nAll counts zero — truncation confirmed.");
