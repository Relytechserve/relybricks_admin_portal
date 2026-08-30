/** Inputs for deriving list-level paid / not paid from property subscription data and transactions. */
export type PaymentStatusInputs = {
  propertyRows: { id: string; customer_id: string }[];
  renewalStatusRows: {
    customer_property_id: string;
    subscription_year: number;
    is_paid: boolean;
  }[];
  transactions: {
    customer_id: string;
    customer_property_id: string | null;
    type: string;
    amount: number | null;
    subscription_renewal_year: number | null;
  }[];
};

/**
 * Customer is "paid" when any of:
 * - a property subscription year is marked paid (status row or renewal txn),
 * - a payment/renewal transaction has amount > 0,
 * - legacy billed_amount > 0 on the customer row.
 */
export function buildPaidCustomerIds(inputs: PaymentStatusInputs): Set<string> {
  const paid = new Set<string>();
  const statusByPropYear = new Map<string, boolean>();

  for (const row of inputs.renewalStatusRows) {
    statusByPropYear.set(
      `${row.customer_property_id}|${row.subscription_year}`,
      row.is_paid,
    );
    if (row.is_paid) {
      const prop = inputs.propertyRows.find((p) => p.id === row.customer_property_id);
      if (prop) paid.add(prop.customer_id);
    }
  }

  for (const txn of inputs.transactions) {
    if (!txn.customer_id) continue;
    const amount = txn.amount != null ? Number(txn.amount) : 0;

    if (
      txn.type === "renewal" &&
      txn.customer_property_id &&
      txn.subscription_renewal_year != null
    ) {
      const key = `${txn.customer_property_id}|${txn.subscription_renewal_year}`;
      const explicit = statusByPropYear.get(key);
      if (explicit === undefined || explicit === true) {
        paid.add(txn.customer_id);
      }
      continue;
    }

    if ((txn.type === "payment" || txn.type === "renewal") && amount > 0) {
      paid.add(txn.customer_id);
    }
  }

  return paid;
}

export function getCustomerListPaymentStatus(
  customer: { id: string; billed_amount: number | null },
  paidCustomerIds: Set<string>,
): "paid" | "unpaid" {
  if (paidCustomerIds.has(customer.id)) return "paid";
  const billed = customer.billed_amount;
  if (billed != null && Number(billed) > 0) return "paid";
  return "unpaid";
}
