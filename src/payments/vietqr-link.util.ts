/**
 * VietQR Kit Quick Link format documented at https://www.vietqr.io/qr-dong.
 * The public image service receives the destination account, amount and order
 * reference because those values are encoded into the displayed transfer QR.
 */
export function createVietQrQuickLink(input: {
  bankBin: string;
  accountNumber: string;
  amount: number;
  reference: string;
  accountName: string;
}): string {
  if (!/^\d{6}$/.test(input.bankBin)) {
    throw new Error('Invalid VietQR bank BIN');
  }
  if (!/^[A-Za-z0-9]{6,19}$/.test(input.accountNumber)) {
    throw new Error('Invalid VietQR account number');
  }
  if (
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 9_999_999_999_999
  ) {
    throw new Error('Invalid VietQR amount');
  }
  if (!/^[A-Z0-9]{8,24}$/.test(input.reference)) {
    throw new Error('Invalid VietQR transfer reference');
  }
  if (!input.accountName || input.accountName.length > 100) {
    throw new Error('Invalid VietQR account name');
  }

  const query = new URLSearchParams({
    amount: String(input.amount),
    addInfo: input.reference,
    accountName: input.accountName,
  });
  return `https://img.vietqr.io/image/${input.bankBin}-${input.accountNumber}-qr_only.svg?${query.toString()}`;
}
