/** Derive lifecycle_stage from customer status and payment fields (matches list filter values). */
export function computeLifecycleStage(value: {
  status: string | null;
  payment_status: string | null;
  outstanding_amount: number | null;
  lifecycle_stage?: string | null;
}): string | null {
  const status = value.status;
  const paymentStatus = value.payment_status;
  const outstanding = value.outstanding_amount ?? 0;

  if (status === "Active") return "active";
  if (status === "Prospect") return "prospect";
  if (status === "Inactive") {
    if (paymentStatus === "overdue" || outstanding > 0) return "churn_risk";
    return "churned";
  }
  return value.lifecycle_stage ?? null;
}
