#!/usr/bin/env node
/**
 * Import customer_location from Excel: column A = email, column B = location (e.g. country).
 *
 * Usage:
 *   node scripts/import-customer-location.mjs /path/to/file.xlsx
 *   node scripts/import-customer-location.mjs ./data.xlsx --dry-run
 *
 * Requires in environment (e.g. export or .env.local loaded by your shell):
 *   NEXT_PUBLIC_SUPABASE_URL  or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (required for unrestricted updates by email)
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const filePath = paths[0];
  return { filePath, dryRun };
}

async function main() {
  loadEnvLocal();
  const { filePath, dryRun } = parseArgs(process.argv.slice(2));

  if (!filePath) {
    console.error(
      "Usage: node scripts/import-customer-location.mjs <file.xlsx> [--dry-run]",
    );
    process.exit(1);
  }

  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const url =
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !key) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: allCustomers, error: loadErr } = await supabase
    .from("customers")
    .select("id, email");

  if (loadErr) {
    console.error("Failed to load customers:", loadErr.message);
    process.exit(1);
  }

  /** @type {Map<string, { id: string; email: string }[]>} */
  const byEmailLower = new Map();
  for (const c of allCustomers ?? []) {
    const k = (c.email ?? "").trim().toLowerCase();
    if (!k) continue;
    if (!byEmailLower.has(k)) byEmailLower.set(k, []);
    byEmailLower.get(k).push(c);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolved);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    console.error("No worksheet found in file.");
    process.exit(1);
  }

  let updated = 0;
  let skippedEmpty = 0;
  let notFound = 0;
  let headerSkipped = false;
  const notFoundEmails = [];

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    const emailCell = row.getCell(1);
    const locCell = row.getCell(2);
    const email =
      typeof emailCell.value === "object" && emailCell.value && "text" in emailCell.value
        ? String(emailCell.value.text).trim()
        : emailCell.text?.trim() ??
          (emailCell.value != null ? String(emailCell.value).trim() : "");
    const location =
      typeof locCell.value === "object" && locCell.value && "text" in locCell.value
        ? String(locCell.value.text).trim()
        : locCell.text?.trim() ??
          (locCell.value != null ? String(locCell.value).trim() : "");

    if (rowNumber === 1 && /email/i.test(email)) {
      headerSkipped = true;
      return;
    }

    if (!email) {
      skippedEmpty++;
      return;
    }

    rows.push({ email, location: location || null, rowNumber });
  });

  if (headerSkipped) {
    console.log("Skipped row 1 as header (email column detected).");
  }

  for (const { email, location, rowNumber } of rows) {
    if (!location) {
      skippedEmpty++;
      continue;
    }

    const emailKey = email.toLowerCase();
    const list = byEmailLower.get(emailKey) ?? [];
    if (list.length === 0) {
      notFound++;
      notFoundEmails.push({ rowNumber, email });
      continue;
    }
    if (list.length > 1) {
      console.warn(
        `Row ${rowNumber}: multiple customers share email (case-insensitive) "${email}" (${list.length}); updating all.`,
      );
    }

    if (dryRun) {
      console.log(
        `[dry-run] row ${rowNumber} would set customer_location="${location}" for ${list.length} row(s): ${email}`,
      );
      updated += list.length;
      continue;
    }

    for (const row of list) {
      const { error: uErr } = await supabase
        .from("customers")
        .update({ customer_location: location })
        .eq("id", row.id);

      if (uErr) {
        console.error(`Row ${rowNumber} update error (${row.id}):`, uErr.message);
        continue;
      }
      updated++;
    }
  }

  console.log("");
  console.log(dryRun ? "Dry run complete." : "Import complete.");
  console.log(`  Updated: ${updated}`);
  console.log(`  Not found (no matching email): ${notFound}`);
  console.log(`  Skipped (empty email or empty location): ${skippedEmpty}`);
  if (notFoundEmails.length > 0 && notFoundEmails.length <= 30) {
    console.log("  Not found details:");
    for (const { rowNumber, email } of notFoundEmails) {
      console.log(`    row ${rowNumber}: ${email}`);
    }
  } else if (notFoundEmails.length > 30) {
    console.log(`  (${notFoundEmails.length} unmatched emails; first 10 shown)`);
    for (const { rowNumber, email } of notFoundEmails.slice(0, 10)) {
      console.log(`    row ${rowNumber}: ${email}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
