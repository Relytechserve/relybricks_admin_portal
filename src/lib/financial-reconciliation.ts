import { readdir, readFile } from "fs/promises";
import path from "path";
import { extractStatementPeriodFromHeader } from "@/lib/bank-statement-pdf-focus";

export type ReconciliationFilters = {
  dateFrom?: string;
  dateTo?: string;
  flow?: "all" | "deposit" | "withdrawal";
  particulars?: string;
  amountEquals?: number;
  amountMin?: number;
  amountMax?: number;
};

export type ExtractedTransactionRow = {
  id: string;
  relativePath: string;
  pageNumber: number | null;
  lineIndex: number;
  date: string;
  particulars: string;
  chqRefNo: string | null;
  withdrawal: number | null;
  deposit: number | null;
  balance: number | null;
  transactionAmount: number | null;
  flow: "deposit" | "withdrawal" | "unknown";
  statementPeriod?: string | null;
};

const PDF_EXT = /\.pdf$/i;
const CSV_EXT = /\.csv$/i;

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

async function collectStatementFiles(rootDir: string, acc: string[]): Promise<void> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      await collectStatementFiles(full, acc);
    } else if (ent.isFile() && (PDF_EXT.test(ent.name) || CSV_EXT.test(ent.name))) {
      acc.push(full);
    }
  }
}

function safeRelativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function cleanCell(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

function parseAmount(v: string): number | null {
  const raw = cleanCell(v);
  if (!raw || raw === "-" || raw === "--") return null;
  const normalized = raw.replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!normalized) return null;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: string): string | null {
  const v = cleanCell(value);
  if (!v) return null;

  let m = v.match(/^(\d{1,2})[-/](\w{3})[-/](\d{2,4})$/i);
  if (m) {
    const d = Number(m[1]);
    if (!Number.isFinite(d) || d < 1 || d > 31) return null;
    const dd = String(d).padStart(2, "0");
    const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    if (mm) return `${yy}-${mm}-${dd}`;
  }

  m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (!Number.isFinite(d) || !Number.isFinite(mo) || d < 1 || d > 31 || mo < 1 || mo > 12) {
      return null;
    }
    const dd = String(d).padStart(2, "0");
    const mm = String(mo).padStart(2, "0");
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    return `${yy}-${mm}-${dd}`;
  }

  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const yy = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(yy) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

function detectFlow(withdrawal: number | null, deposit: number | null): "deposit" | "withdrawal" | "unknown" {
  if ((deposit ?? 0) > 0 && !(withdrawal && withdrawal > 0)) return "deposit";
  if ((withdrawal ?? 0) > 0 && !(deposit && deposit > 0)) return "withdrawal";
  return "unknown";
}

function looksLikeTransactionHeader(line: string): boolean {
  const l = line.toLowerCase();
  return (
    l.includes("date") &&
    l.includes("particular") &&
    (l.includes("withdraw") || l.includes("debit")) &&
    (l.includes("deposit") || l.includes("credit")) &&
    l.includes("balance")
  );
}

function parseAmountsFromTail(line: string): number[] {
  const matches = line.match(/-?[\d,]+\.\d{2}/g) ?? [];
  return matches
    .map((m) => Number.parseFloat(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

function isDateLeadingLine(line: string): boolean {
  return /^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/.test(
    cleanCell(line),
  );
}

function inferCreditFromParticulars(particulars: string): boolean {
  const l = particulars.toLowerCase();
  return /\b(cr\.?|credit|deposit|salary|refund|interest|imps\/.*\/cr\/|neft\/.*\/cr\/)\b/.test(
    l,
  );
}

function inferDebitFromParticulars(particulars: string): boolean {
  const l = particulars.toLowerCase();
  return /\b(dr\.?|debit|upi\/.*\/dr\/|visa pos|atm|charges?|payment|purchase|neft\/.*\/dr\/)\b/.test(
    l,
  );
}

function assignAmountsFromLine(
  amounts: number[],
  particulars: string,
): { withdrawal: number | null; deposit: number | null; balance: number | null } {
  if (amounts.length === 0) return { withdrawal: null, deposit: null, balance: null };
  if (amounts.length >= 3) {
    return { withdrawal: amounts[0], deposit: amounts[1], balance: amounts[2] };
  }
  if (amounts.length === 2) {
    const amount = amounts[0];
    const balance = amounts[1];
    if (inferDebitFromParticulars(particulars)) return { withdrawal: amount, deposit: null, balance };
    if (inferCreditFromParticulars(particulars)) return { withdrawal: null, deposit: amount, balance };
    return { withdrawal: null, deposit: amount, balance };
  }
  // Single amount lines are usually opening/closing balance lines.
  return { withdrawal: null, deposit: null, balance: amounts[0] };
}

async function extractFromPdf(
  root: string,
  absPath: string,
  password: string | undefined,
): Promise<Omit<ExtractedTransactionRow, "id">[]> {
  const { PDFParse } = await import("pdf-parse");
  const buf = await readFile(absPath);
  const parser = new PDFParse({
    data: new Uint8Array(buf),
    ...(password ? { password } : {}),
    disableFontFace: true,
  });

  try {
    const textResult = await parser.getText({
      lineEnforce: true,
      pageJoiner: "",
      cellSeparator: "\t",
    });

    const relativePath = safeRelativePath(root, absPath);
    const firstPageText = (textResult.pages?.[0]?.text ?? "").trim();
    const statementPeriod = extractStatementPeriodFromHeader(firstPageText);
    const rows: Omit<ExtractedTransactionRow, "id">[] = [];
    let rowIdx = 0;

    let tableSeen = false;
    for (const page of textResult.pages ?? []) {
      const pageNum = page.num ?? 0;
      const pageLines = (page.text ?? "")
        .split(/\r?\n/)
        .map((l) => cleanCell(l))
        .filter((l) => l.length > 0);
      const hasTableHeader = pageLines.some((line) => looksLikeTransactionHeader(line));
      const hasDateRows = pageLines.filter((line) => isDateLeadingLine(line)).length >= 3;
      if (hasTableHeader) tableSeen = true;
      if (!tableSeen && !hasDateRows) continue;

      let currentDate: string | null = null;
      let currentParts: string[] = [];

      const flushIfPossible = (amounts?: number[]) => {
        if (!currentDate || currentParts.length === 0) return;
        const particulars = currentParts.join(" ").replace(/\s+/g, " ").trim();
        if (!particulars || /brought\s+forward|carried\s+forward/i.test(particulars)) {
          currentDate = null;
          currentParts = [];
          return;
        }
        const parsedAmounts = amounts ?? [];
        const assigned = assignAmountsFromLine(parsedAmounts, particulars);
        const record: Omit<ExtractedTransactionRow, "id"> = {
          relativePath,
          pageNumber: pageNum,
          lineIndex: rowIdx++,
          date: currentDate,
          particulars,
          chqRefNo: null,
          withdrawal: assigned.withdrawal,
          deposit: assigned.deposit,
          balance: assigned.balance,
          transactionAmount: assigned.deposit ?? assigned.withdrawal,
          flow: detectFlow(assigned.withdrawal, assigned.deposit),
          statementPeriod,
        };
        rows.push(record);
        currentDate = null;
        currentParts = [];
      };

      for (const line of pageLines) {
        if (looksLikeTransactionHeader(line)) continue;
        if (/^\d+\s+of\s+\d+$/i.test(line)) continue;
        if (/^statement of customer$/i.test(line)) continue;

        const dateMatch = line.match(
          /^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(.*)$/,
        );
        if (dateMatch) {
          // Previous row never found amount line; save minimal row.
          flushIfPossible();
          currentDate = parseDate(dateMatch[1]);
          currentParts = [];
          const rest = cleanCell(dateMatch[2]);
          if (rest) currentParts.push(rest);
          continue;
        }

        if (!currentDate) continue;
        const amounts = parseAmountsFromTail(line);
        if (amounts.length >= 2) {
          flushIfPossible(amounts);
        } else {
          currentParts.push(line);
        }
      }

      flushIfPossible();
    }

    return rows;
  } finally {
    await parser.destroy();
  }
}

async function extractFromCsv(
  root: string,
  absPath: string,
): Promise<Omit<ExtractedTransactionRow, "id">[]> {
  const text = await readFile(absPath, "utf8");
  const relativePath = safeRelativePath(root, absPath);
  const rows: Omit<ExtractedTransactionRow, "id">[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let rowIdx = 0;

  for (const line of lines) {
    const cols = line.split(",").map((c) => cleanCell(c));
    if (cols.length < 6) continue;
    const date = parseDate(cols[0]);
    if (!date) continue;
    const withdrawal = parseAmount(cols[3] ?? "");
    const deposit = parseAmount(cols[4] ?? "");
    const balance = parseAmount(cols[5] ?? "");
    rows.push({
      relativePath,
      pageNumber: null,
      lineIndex: rowIdx++,
      date,
      particulars: cols[1] ?? "",
      chqRefNo: cols[2] || null,
      withdrawal,
      deposit,
      balance,
      transactionAmount: deposit ?? withdrawal,
      flow: detectFlow(withdrawal, deposit),
      statementPeriod: null,
    });
  }
  return rows;
}

function matchesFilters(row: Omit<ExtractedTransactionRow, "id">, filters: ReconciliationFilters): boolean {
  const mode = filters.flow ?? "deposit";
  if (mode === "deposit" && row.flow !== "deposit") return false;
  if (mode === "withdrawal" && row.flow !== "withdrawal") return false;
  if (filters.dateFrom && row.date < filters.dateFrom) return false;
  if (filters.dateTo && row.date > filters.dateTo) return false;
  return true;
}

export async function scanStatements(
  rootDir: string,
  filters: ReconciliationFilters,
  password: string | undefined,
): Promise<{ rows: ExtractedTransactionRow[]; filesScanned: number; errors: { file: string; message: string }[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const files: string[] = [];
  await collectStatementFiles(resolvedRoot, files);
  files.sort();

  const rows: ExtractedTransactionRow[] = [];
  const errors: { file: string; message: string }[] = [];
  let id = 0;

  for (const file of files) {
    try {
      const extracted = PDF_EXT.test(file)
        ? await extractFromPdf(resolvedRoot, file, password)
        : await extractFromCsv(resolvedRoot, file);
      for (const row of extracted) {
        if (!matchesFilters(row, filters)) continue;
        rows.push({ id: `row-${++id}`, ...row });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ file: safeRelativePath(resolvedRoot, file), message });
    }
  }

  return { rows, filesScanned: files.length, errors };
}
