import { readdir, readFile } from "fs/promises";
import path from "path";
import { extractStatementPeriodFromHeader, isLikelyTableHeaderLine } from "@/lib/bank-statement-pdf-focus";

export type ReconciliationFilters = {
  dateFrom?: string;
  dateTo?: string;
  flow?: "all" | "deposit" | "withdrawal";
  particulars?: string;
  amountEquals?: number;
  amountMin?: number;
  amountMax?: number;
  year?: number;
  month?: number;
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

function money(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(Number(n))) return 0;
  return Number(n);
}

/**
 * Fix wrong Withdrawal/Deposit when the PDF line order does not match [debit, credit, balance].
 * If balance increased vs the previous row, the txn amount must be a credit (deposit); if it decreased, a debit.
 */
function amountTolForBalanceCheck(movementApprox: number): number {
  const base = 1.5;
  /** Large statements: loosen absolute tolerance slightly so ₹40k deltas are not swallowed by rounding noise */
  const scale = Math.min(50, movementApprox * 0.00025);
  return base + scale;
}

/**
 * Ledger rule: Δbalance ≈ deposits − withdrawals (for one movement per row, prior balance trustworthy).
 */
function refineAmountsByBalanceDelta(
  previousBalance: number | null,
  assigned: { withdrawal: number | null; deposit: number | null; balance: number | null },
): { withdrawal: number | null; deposit: number | null; balance: number | null } {
  const bal = assigned.balance;
  if (previousBalance == null || bal == null || !Number.isFinite(previousBalance) || !Number.isFinite(bal)) {
    return assigned;
  }

  const delta = Math.round((money(bal) - money(previousBalance)) * 100) / 100;
  const wv = money(assigned.withdrawal);
  const dv = money(assigned.deposit);
  const tol = amountTolForBalanceCheck(Math.abs(delta));

  if (Math.abs(delta) < tol) return assigned;

  // Balance went up → net credit: lone withdrawal amount is misplaced
  if (delta > tol) {
    if (wv > tol && dv < tol) {
      return { withdrawal: null, deposit: Math.round(wv * 100) / 100, balance: bal };
    }
    return assigned;
  }

  // Balance went down → net debit: lone deposit amount should be withdrawal
  if (delta < -tol) {
    if (dv > tol && wv < tol) {
      return { withdrawal: Math.round(dv * 100) / 100, deposit: null, balance: bal };
    }
    return assigned;
  }

  return assigned;
}

/**
 * When only one leg is filled before balance delta and narration is ambiguous, choose debit vs credit from Δbalance.
 */
function inferSingleMovementFromBalances(
  previousBalance: number | null,
  amount: number,
  balanceAfter: number | null,
): { withdrawal: number | null; deposit: number | null } | null {
  if (previousBalance == null || balanceAfter == null || amount <= 0) return null;
  const delta = Math.round((money(balanceAfter) - money(previousBalance)) * 100) / 100;
  const tol = amountTolForBalanceCheck(amount);
  if (Math.abs(delta) < tol) return null;
  const need = Math.abs(delta);
  /** Movement must reconcile to the lone amount on the row (rounding / minor fee tolerance) */
  if (Math.abs(need - amount) > tol + 12) return null;
  if (delta > tol) return { withdrawal: null, deposit: Math.round(amount * 100) / 100 };
  return { withdrawal: Math.round(amount * 100) / 100, deposit: null };
}

/**
 * When we have no prior balance or weak delta, reduce false debits/credits from particulars.
 * (Does not override balance-delta when that already swapped columns.)
 */
function inferStrongOutboundTransfer(particulars: string): boolean {
  const l = particulars.toLowerCase();
  if (/\bcustomer induced\b/.test(l)) return true;
  if (/\bpsp\s*payments?\b|\bimps\s*merchant\b|\bmerchant\s*paid\b/i.test(particulars)) return false;
  /** P2A in Indian statements is usually payment-to-account outbound from the account holder when paired with IMPS/UPI */
  if (/\bp2a\b/.test(l) && /\b(imps|upi)\b/.test(l)) return true;
  /** Outbound IMPS phrasing */
  if (/\boutward\b.*\bimps\b|\bimps\b.*\boutward\b/.test(l)) return true;
  if (/\bimps\s*p2a\b|\bp2p\b.*\bdebit\b/.test(l)) return true;
  return /\bpayment\s*to\b|\bto\s+ac(count)?\s*[\d*]/i.test(particulars);
}

function inferCreditFromParticulars(particulars: string): boolean {
  const l = particulars.toLowerCase();
  if (inferStrongOutboundTransfer(particulars)) return false;
  if (/\b(dr\.?|debit|\/dr\/|upi\/.*\/dr\/|neft\/.*\/dr\/|imps\/.*\/dr\/)\b/.test(l)) return false;
  return (
    /\b(cr\.?|credit|salary|refund|interest|imps\/.*\/cr\/|neft\/.*\/cr\/)\b/.test(l) ||
    /\btransferwise\b/.test(l) ||
    /\b(neft|imps|rtgs)\b.*\b(c\/r|credit|cr)\b/i.test(l) ||
    /\breceived from|incoming transfer|credit\s+adv/i.test(l)
  );
}

function inferDebitFromParticulars(particulars: string): boolean {
  const l = particulars.toLowerCase();
  if (inferStrongOutboundTransfer(particulars)) return true;
  return (
    /\b(dr\.?|debit|upi\/.*\/dr\/|visa pos|atm|charges?|purchase|pos\s*purchase)\b/.test(l) ||
    /\bimps\b.*\/\s*p2a\s*\/|\bp2a\b.*\bimps\b/.test(l) ||
    /\bneft\/.*\/dr\/|payment\s*[\/]\s*dr|\/dr\/|\bimps\/.*\/dr\//.test(l) ||
    /\bstanding\s+instruction\b|\bsi\s+debit\b/.test(l) ||
    /\bcash\s*withdraw|self\s+cheque|chq\s*withdraw/i.test(particulars)
  );
}

function refineAmountsByParticulars(
  assigned: { withdrawal: number | null; deposit: number | null; balance: number | null },
  particulars: string,
): { withdrawal: number | null; deposit: number | null; balance: number | null } {
  const wv = money(assigned.withdrawal);
  const dv = money(assigned.deposit);
  const bal = assigned.balance;
  const strongOut = inferStrongOutboundTransfer(particulars);

  /** Customer/induced outbound: amount must leave via withdrawal column */
  if (strongOut && dv > 0.01 && wv < 0.01) {
    return { withdrawal: Math.round(dv * 100) / 100, deposit: null, balance: bal };
  }
  if (strongOut && wv > 0 && dv > 0) {
    /** Mis-split row: impose single debit bucket */
    if (dv >= wv) return { withdrawal: Math.round(dv * 100) / 100, deposit: null, balance: bal };
    return { withdrawal: Math.round(wv * 100) / 100, deposit: null, balance: bal };
  }
  if (!strongOut && wv > 0 && dv < 0.01 && inferCreditFromParticulars(particulars) && !inferDebitFromParticulars(particulars)) {
    return { withdrawal: null, deposit: Math.round(wv * 100) / 100, balance: bal };
  }
  if (dv > 0 && wv < 0.01 && inferDebitFromParticulars(particulars) && !inferCreditFromParticulars(particulars)) {
    return { withdrawal: Math.round(dv * 100) / 100, deposit: null, balance: bal };
  }
  return assigned;
}

function coerceLedgerDirectionFromBalances(
  previousBalance: number | null,
  assigned: { withdrawal: number | null; deposit: number | null; balance: number | null },
): { withdrawal: number | null; deposit: number | null; balance: number | null } {
  const bal = assigned.balance;
  if (previousBalance == null || bal == null) return assigned;
  const wv = money(assigned.withdrawal);
  const dv = money(assigned.deposit);
  /** Only reinterpret when exactly one ledger leg is nonzero */
  if ((wv <= 0 && dv <= 0) || (wv > 0 && dv > 0)) return assigned;
  const amt = wv > 0 ? wv : dv;
  const fromBalance = inferSingleMovementFromBalances(previousBalance, amt, bal);
  if (!fromBalance) return assigned;
  return { withdrawal: fromBalance.withdrawal, deposit: fromBalance.deposit, balance: bal };
}

function looksLikeTransactionHeader(line: string): boolean {
  const l = line.toLowerCase();
  return (
    l.includes("date") &&
    (l.includes("particular") || l.includes("narration")) &&
    (l.includes("withdraw") || l.includes("debit")) &&
    (l.includes("deposit") || l.includes("credit")) &&
    (l.includes("balance") || l.includes("closing"))
  );
}

/** Split PDF header/table lines into coarse cells — tabs preserved by pdf-parse preferred. */
function splitTableCells(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((s) => cleanCell(s));
  }
  return line
    .split(/\s{2,}/)
    .map((s) => cleanCell(s))
    .filter((s) => s.length > 0);
}

/** 0-based column indices from a table header (when detectable). */
export type StatementColumnIndices = {
  withdrawal: number;
  deposit: number;
  balance: number;
};

function detectStatementColumnIndicesFromHeader(headerLine: string): StatementColumnIndices | null {
  const seg = splitTableCells(headerLine).map((s) => cleanCell(s).toLowerCase());
  if (seg.length < 3) return null;
  let wi = -1;
  let di = -1;
  let bi = -1;
  for (let i = 0; i < seg.length; i++) {
    const t = seg[i];
    const withdrawalLike =
      /\bwithdrawal\b|\bwithdrawals\b|\bdebits?\b/.test(t) ||
      /^dr\.?$|^debit$/i.test(t.trim()) ||
      (/\bdb\b/.test(t) && !/\bdb\s*t\b/.test(t));
    const depositLike = /\bdeposit(s)?\b|\bcredits?\b/.test(t) || /^cr\.?$|^credit$/i.test(t.trim());
    const balanceLike = /\bbalance\b|\bclosing\b|\brunning\b/.test(t);
    if (withdrawalLike && wi < 0) wi = i;
    if (depositLike && di < 0) di = i;
    if (balanceLike && bi < 0) bi = i;
  }
  if (wi >= 0 && di >= 0 && bi >= 0 && new Set([wi, di, bi]).size === 3) {
    return { withdrawal: wi, deposit: di, balance: bi };
  }
  return null;
}

function withdrawalBeforeDepositFromIndices(layout: StatementColumnIndices | null): boolean {
  if (!layout) return true;
  return layout.withdrawal < layout.deposit;
}

function parseAmountsFromTail(line: string): number[] {
  const matches = line.match(/-?[\d,]+\.\d{2}/g) ?? [];
  return matches
    .map((m) => Number.parseFloat(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** Single cell from a tab-aligned row — maps to Withdrawal / Deposit / Balance PDF columns when indices are known. */
function parseMoneyCellStrict(cell: string | undefined): number | null {
  return parseAmount(cell ?? "");
}

function tryAssignAmountsFromTabLine(
  line: string,
  columns: StatementColumnIndices | null,
): { withdrawal: number | null; deposit: number | null; balance: number | null } | null {
  if (!columns || !line.includes("\t")) return null;
  const cells = line.split("\t");
  const maxIdx = Math.max(columns.withdrawal, columns.deposit, columns.balance);
  if (cells.length <= maxIdx) return null;
  const w = parseMoneyCellStrict(cells[columns.withdrawal]);
  const d = parseMoneyCellStrict(cells[columns.deposit]);
  const b = parseMoneyCellStrict(cells[columns.balance]);
  if (b == null) return null;
  /** Row must reflect at least one ledger movement beside balance. */
  if ((w == null || w <= 0) && (d == null || d <= 0)) return null;
  return {
    withdrawal: w != null && w > 0 ? w : null,
    deposit: d != null && d > 0 ? d : null,
    balance: b,
  };
}

function isDateLeadingLine(line: string): boolean {
  return /^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/.test(
    cleanCell(line),
  );
}

/**
 * Map regex-ordered money amounts to DB columns. Convention: the last value on a row is **balance**;
 * the preceding values are debit/credit in **left-to-right PDF column order**, which we align with
 * withdrawal/deposit using the detected header (many statements use Deposit before Withdrawal).
 */
function assignAmountsFromLine(
  amounts: number[],
  particulars: string,
  columnOrder: StatementColumnIndices | null,
): { withdrawal: number | null; deposit: number | null; balance: number | null } {
  const wFirst = withdrawalBeforeDepositFromIndices(columnOrder);
  const n = amounts.length;
  if (n === 0) return { withdrawal: null, deposit: null, balance: null };

  if (n >= 2) {
    /** Bank statements place running balance in the last column. */
    const balance = amounts[n - 1]!;
    const rest = amounts.slice(0, n - 1);
    if (rest.length === 1) {
      const amount = rest[0]!;
      if (inferDebitFromParticulars(particulars)) return { withdrawal: amount, deposit: null, balance };
      if (inferCreditFromParticulars(particulars)) return { withdrawal: null, deposit: amount, balance };
      return { withdrawal: null, deposit: amount, balance };
    }
    // Two+ values before balance: use the first two as withdrawal/deposit (extra tokens are rare OCR noise).
    if (rest.length >= 2) {
      const a0 = rest[0]!;
      const a1 = rest[1]!;
      if (wFirst) return { withdrawal: a0, deposit: a1, balance };
      return { withdrawal: a1, deposit: a0, balance };
    }
  }

  // Single amount: statement opening/closing or continuation line with balance only.
  return { withdrawal: null, deposit: null, balance: amounts[0]! };
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
    /** Running ledger balance from the prior flushed row (same PDF); drives debit/credit correction. */
    let lastBalance: number | null = null;
    /** From table header: maps PDF withdrawal / deposit / balance columns to tab cell indices. */
    let columnIndices: StatementColumnIndices | null = null;

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

      const flushIfPossible = (amounts?: number[], amountLine?: string) => {
        if (!currentDate || currentParts.length === 0) return;
        const particulars = currentParts.join(" ").replace(/\s+/g, " ").trim();
        if (!particulars || /brought\s+forward|carried\s+forward/i.test(particulars)) {
          currentDate = null;
          currentParts = [];
          return;
        }
        const parsedAmounts = amounts ?? [];
        let assigned =
          (amountLine != null && amountLine !== ""
            ? tryAssignAmountsFromTabLine(amountLine, columnIndices)
            : null) ?? assignAmountsFromLine(parsedAmounts, particulars, columnIndices);
        assigned = coerceLedgerDirectionFromBalances(lastBalance, assigned);
        assigned = refineAmountsByBalanceDelta(lastBalance, assigned);
        assigned = refineAmountsByParticulars(assigned, particulars);
        if (assigned.balance != null && Number.isFinite(Number(assigned.balance))) {
          lastBalance = Number(assigned.balance);
        }
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
        if (looksLikeTransactionHeader(line) || isLikelyTableHeaderLine(line)) {
          const idx = detectStatementColumnIndicesFromHeader(line);
          if (idx) columnIndices = idx;
          continue;
        }
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
          flushIfPossible(amounts, line);
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
  let lastBalance: number | null = null;

  for (const line of lines) {
    const cols = line.split(",").map((c) => cleanCell(c));
    if (cols.length < 6) continue;
    const date = parseDate(cols[0]);
    if (!date) continue;
    const particulars = cols[1] ?? "";
    let assigned = {
      withdrawal: parseAmount(cols[3] ?? ""),
      deposit: parseAmount(cols[4] ?? ""),
      balance: parseAmount(cols[5] ?? ""),
    };
    assigned = coerceLedgerDirectionFromBalances(lastBalance, assigned);
    assigned = refineAmountsByBalanceDelta(lastBalance, assigned);
    assigned = refineAmountsByParticulars(assigned, particulars);
    if (assigned.balance != null && Number.isFinite(Number(assigned.balance))) {
      lastBalance = Number(assigned.balance);
    }
    rows.push({
      relativePath,
      pageNumber: null,
      lineIndex: rowIdx++,
      date,
      particulars,
      chqRefNo: cols[2] || null,
      withdrawal: assigned.withdrawal,
      deposit: assigned.deposit,
      balance: assigned.balance,
      transactionAmount: assigned.deposit ?? assigned.withdrawal,
      flow: detectFlow(assigned.withdrawal, assigned.deposit),
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
