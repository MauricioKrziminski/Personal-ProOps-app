/** Payments may be out of order; the first pending number is the next installment. */
export function nextPendingInstallment(
  parcels: readonly { installment_no: number | null; status: string }[],
  total: number,
): number {
  const pending = parcels
    .filter((parcel) => parcel.status === 'pending' && parcel.installment_no != null)
    .map((parcel) => parcel.installment_no as number);
  return pending.length ? Math.min(...pending) : total;
}
