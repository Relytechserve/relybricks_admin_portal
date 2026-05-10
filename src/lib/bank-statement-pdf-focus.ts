/**
 * Restricts flattened bank-statement PDF text to:
 * 1) Header region (for statement period / "as on" dates)
 * 2) Transaction table rows (skips marketing, footnotes, certificate blocks when detectable)
 */

const DATE_IN_TEXT =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i;

function lineHasMoneyLikeAmount(line: string): boolean {
  return /(?:-?[\d,]+\.\d{2})\b/.test(line);
}

/** Row that looks like column titles for the transaction grid. */
export function isLikelyTableHeaderLine(line: string): boolean {
  const t = line.toLowerCase();
  let score = 0;
  if (/\bdate\b/.test(t)) score++;
  if (/\b(value\s*date|val\s*dt)\b/.test(t)) score++;
  if (/\b(narration|particulars|description|details|remarks|transaction\s+details)\b/.test(t)) score++;
  if (/\b(debit|credit|withdrawal|deposit|payment)\b/.test(t)) score++;
  if (/\b(balance|closing\s*balance|running\s*balance)\b/.test(t)) score++;
  if (/\b(chq|cheque|ref\.?|reference|instrument)\b/.test(t)) score++;
  if (/\b(withdrawal|deposit)s?\b/.test(t)) score++;
  if (/\bsl\.?\s*no\.?\b/.test(t)) score++;
  if (/\bamount\b/.test(t) && /\b(?:debit|credit|dr|cr)\b/.test(t)) score++;
  return score >= 2;
}

/** End of useful grid — footers, compliance, page chrome (not normal transaction narration). */
export function isStrongFooterOrBoilerplateLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (/^Page\s+\d+\s+of\s+\d+$/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+\s*$/i.test(t) && t.length < 16) return true;
  if (/\b(GSTIN|PAN|CIN|TAN)\s*[:.]?\s*[A-Z0-9]{5,}/i.test(t)) return true;
  if (/^(?:IFSC|MICR)\s*[:.]?\s*\w+/i.test(t)) return true;
  if (/Computer\s+generated|System\s+generated|electronically\s+generated/i.test(t)) return true;
  if (/This\s+is\s+(a\s+)?(computer|system)\s+generated/i.test(t)) return true;
  if (/^\s*www\.[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;
  if (/Terms\s+and\s+conditions|Disclaimer/i.test(t)) return true;
  if (/(?:Printed|Generated)\s+on\s*:?\s*\d/i.test(t)) return true;
  if (/Customer\s+(Care|ID|Unique|Service)\s*:/i.test(t)) return true;
  if (/^\*{3,}.+\*{3,}$/.test(t) && t.length < 80) return true;
  return false;
}

export function extractStatementPeriodFromHeader(headerText: string): string | null {
  const flat = headerText.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const dateToken = "(?:\\d{1,2}[\\/.\\-](?:\\d{1,2}|[A-Za-z]{3,})[\\/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})";

  let m = flat.match(
    new RegExp(`(?:from|between)\\s*[:\\s]*(${dateToken})\\s*(?:to|[-–]|through)\\s*(${dateToken})`, "i"),
  );
  if (m) return `${m[1]} → ${m[2]}`;

  m = flat.match(
    new RegExp(`(?:statement|period)\\s+(?:from|for)?\\s*[:\\s]*(${dateToken})\\s*(?:to|[-–])\\s*(${dateToken})`, "i"),
  );
  if (m) return `${m[1]} → ${m[2]}`;

  m = flat.match(/\b(?:as\s+on|for\s+(?:the\s+)?date)\s*[:\s]*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (m) return m[1];

  m = flat.match(new RegExp(`(${dateToken})\\s*(?:to|[-–])\\s*(${dateToken})`, "i"));
  if (m) return `${m[1]} → ${m[2]}`;

  return null;
}

function findFirstTableHeaderIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isLikelyTableHeaderLine(lines[i])) return i;
  }
  return -1;
}

function findTableExclusiveEndIndex(lines: string[], tableStart: number): number {
  for (let i = Math.max(tableStart, 0); i < lines.length; i++) {
    if (isStrongFooterOrBoilerplateLine(lines[i])) return i;
  }
  return lines.length;
}

/**
 * If we cannot find a column header row, use early lines as header and start data from
 * the first line that looks like a dated amount row.
 */
function fallbackSlice(lines: string[]): { headerLines: string[]; tableLines: string[] } {
  const headerCap = Math.min(45, lines.length);
  const headerCandidate = lines.slice(0, headerCap);
  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (DATE_IN_TEXT.test(lines[i]) && lineHasMoneyLikeAmount(lines[i])) {
      dataStart = i;
      break;
    }
  }
  if (dataStart <= 0) {
    return {
      headerLines: headerCandidate,
      tableLines: lines.slice(headerCap),
    };
  }
  return {
    headerLines: lines.slice(0, dataStart),
    tableLines: lines.slice(dataStart),
  };
}

/** Repeated column header on the next PDF page — drop if it has no date and no amount. */
export function isRepeatedColumnHeaderRow(line: string): boolean {
  return isLikelyTableHeaderLine(line) && !DATE_IN_TEXT.test(line) && !lineHasMoneyLikeAmount(line);
}

export type FocusedPdfContent = {
  headerText: string;
  /** Lines to treat as transactions (may still include repeated header rows; filter downstream). */
  tableLines: string[];
  statementPeriod: string | null;
};

export type FocusedPdfRow = {
  pageNumber: number;
  line: string;
};

export type FocusedPdfPagesContent = {
  statementPeriod: string | null;
  rows: FocusedPdfRow[];
};

/**
 * Keeps header text for period parsing and limits "table" lines to the transaction grid region.
 */
export function focusBankStatementPdfLines(allLines: string[]): FocusedPdfContent {
  if (allLines.length === 0) {
    return { headerText: "", tableLines: [], statementPeriod: null };
  }

  const headerIdx = findFirstTableHeaderIndex(allLines);
  if (headerIdx === -1) {
    const { headerLines, tableLines } = fallbackSlice(allLines);
    const headerText = headerLines.join("\n");
    return {
      headerText,
      tableLines,
      statementPeriod: extractStatementPeriodFromHeader(headerText),
    };
  }

  const headerLines = allLines.slice(0, headerIdx);
  const tableEnd = findTableExclusiveEndIndex(allLines, headerIdx);
  const rawTable = allLines.slice(headerIdx, tableEnd);

  const headerText = headerLines.join("\n");
  const periodHint = `${headerText}\n${rawTable.slice(0, 2).join("\n")}`;
  return {
    headerText,
    tableLines: rawTable,
    statementPeriod: extractStatementPeriodFromHeader(periodHint),
  };
}

function normalizeSplitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

function isLikelyDataRow(line: string): boolean {
  return DATE_IN_TEXT.test(line) && lineHasMoneyLikeAmount(line);
}

function tableSignalCount(lines: string[]): number {
  let score = 0;
  for (const line of lines) {
    if (isLikelyTableHeaderLine(line)) score += 2;
    if (isLikelyDataRow(line)) score += 2;
    if (lineHasMoneyLikeAmount(line)) score += 1;
  }
  return score;
}

function looksLikeTransactionPage(lines: string[], previousWasTransactionPage: boolean): boolean {
  const headerHits = lines.filter((line) => isLikelyTableHeaderLine(line)).length;
  const dataHits = lines.filter((line) => isLikelyDataRow(line)).length;
  const signal = tableSignalCount(lines);

  if (headerHits > 0 && dataHits >= 2) return true;
  if (headerHits > 0 && signal >= 6) return true;

  // Continuation pages often drop the header row; keep if dense in date+amount rows.
  if (previousWasTransactionPage && dataHits >= 3) return true;
  if (dataHits >= 4) return true;
  return false;
}

function extractTableRowsFromPage(lines: string[]): string[] {
  const headerIdx = findFirstTableHeaderIndex(lines);
  const start = headerIdx >= 0 ? headerIdx : lines.findIndex((line) => isLikelyDataRow(line));
  if (start < 0) return [];
  const end = findTableExclusiveEndIndex(lines, start);
  return lines
    .slice(start, end)
    .filter((line) => !isStrongFooterOrBoilerplateLine(line))
    .filter((line) => !isRepeatedColumnHeaderRow(line));
}

/**
 * Page-aware PDF focus:
 * - Chooses only pages that likely contain transaction history
 * - Extracts rows from the transaction table area of those pages
 * - Uses early non-table pages to infer statement period from header text
 */
export function focusBankStatementPdfPages(pageTexts: string[]): FocusedPdfPagesContent {
  if (pageTexts.length === 0) {
    return { statementPeriod: null, rows: [] };
  }

  const pages = pageTexts.map((text, idx) => ({
    pageNumber: idx + 1,
    lines: normalizeSplitLines(text),
  }));

  let previousSelected = false;
  const selectedPageRows: FocusedPdfRow[] = [];
  const headerCandidates: string[] = [];

  for (const page of pages) {
    const isTxnPage = looksLikeTransactionPage(page.lines, previousSelected);
    if (isTxnPage) {
      const rows = extractTableRowsFromPage(page.lines);
      for (const line of rows) {
        selectedPageRows.push({ pageNumber: page.pageNumber, line });
      }
      previousSelected = rows.length > 0;
    } else {
      // Useful for statement date / period extraction.
      headerCandidates.push(page.lines.slice(0, 24).join("\n"));
      previousSelected = false;
    }
  }

  const statementPeriod = extractStatementPeriodFromHeader(headerCandidates.join("\n"));
  return {
    statementPeriod,
    rows: selectedPageRows,
  };
}
