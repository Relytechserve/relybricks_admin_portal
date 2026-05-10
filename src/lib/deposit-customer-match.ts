/** Match bank `particulars` text against customer `name` (single field: first only, last only, both, or full phrase). */

const MIN_TOKEN_CHARS = 2;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match only (ASCII `\b`; typical English names in narration). */
export function particularsContainsToken(particulars: string, token: string): boolean {
  const t = token.trim();
  if (t.length < MIN_TOKEN_CHARS) return false;
  return new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(particulars.trim());
}

export type CustomerMatchRef = { id: string; name: string };

export type BestDepositCustomerMatch =
  | {
      customer: CustomerMatchRef;
      /** Human-readable hint for how the row was matched */
      matchKind: string;
    }
  /** No confident customer reference in particulars */
  | null;

type Scored = { customer: CustomerMatchRef; score: number; matchKind: string };

/**
 * Picks one customer whose name best explains text in `particulars`:
 * prefers full contiguous name, then first+last tokens as words, single-word name, first-only, last-only.
 */
export function bestCustomerMatchForParticulars(
  particulars: string,
  customers: ReadonlyArray<CustomerMatchRef>,
): BestDepositCustomerMatch {
  const p = particulars.trim();
  const pLower = p.toLowerCase();
  let best: Scored | null = null;

  /** Prefer higher score; on tie prefer longer recorded name then lower id */
  function pickWinner(candidate: Scored, current: Scored | null): Scored {
    if (!current || candidate.score > current.score) return candidate;
    if (candidate.score < current.score) return current;
    if (candidate.customer.name.length > current.customer.name.length) return candidate;
    if (
      candidate.customer.name.length === current.customer.name.length &&
      candidate.customer.id < current.customer.id
    ) {
      return candidate;
    }
    return current;
  }

  for (const c of customers) {
    const raw = c.name.trim();
    if (!raw) continue;

    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    let score = 0;
    let kind = "";

    if (tokens.length === 1) {
      const t0 = tokens[0]!;
      if (particularsContainsToken(p, t0)) {
        score = 25;
        kind = "Customer name (single token)";
      }
    } else {
      const first = tokens[0]!;
      const last = tokens[tokens.length - 1]!;
      const same = first.localeCompare(last, undefined, { sensitivity: "accent" }) === 0;
      let hasPhrase = false;
      const phrase = tokens.join(" ").toLowerCase();
      if (phrase.length >= 5 && pLower.includes(phrase)) {
        score = 45;
        kind = "Full customer name";
        hasPhrase = true;
      }

      const hasFirst = particularsContainsToken(p, first);
      const hasLast = particularsContainsToken(p, last);

      if (!hasPhrase && same && hasFirst) {
        score = Math.max(score, 24);
        kind = "Customer name (repeated tokens)";
      } else if (!hasPhrase && hasFirst && hasLast) {
        score = Math.max(score, 38);
        kind = "First and last name (words)";
      } else if (!hasPhrase && hasFirst) {
        score = Math.max(score, 20);
        kind = "First name only";
      } else if (!hasPhrase && hasLast) {
        score = Math.max(score, 18);
        kind = "Last name only";
      }
    }

    if (score > 0) best = pickWinner({ customer: { id: c.id, name: raw }, score, matchKind: kind }, best);
  }

  if (!best) return null;
  return { customer: best.customer, matchKind: best.matchKind };
}
