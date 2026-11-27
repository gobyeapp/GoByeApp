/**
 * A rider's own wallet account number (D-092): one fixed bank account per rider, so adding money is
 * "send to this number" from any bank app. The real number comes from the payment provider's dedicated
 * virtual accounts once payments are connected. Until then this gives a stable TEST number for the
 * account: 10 digits starting 99 (not a range Nigerian banks issue to customers), always marked simulated.
 */
export interface WalletAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
  isSimulated: boolean;
}

export function simulatedWalletAccount(userId: string, fullName: string): WalletAccount {
  // FNV-1a over the user id: the same rider always gets the same number.
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return {
    bankName: 'GoBye Demo Bank',
    accountNumber: `99${String(h % 100_000_000).padStart(8, '0')}`,
    accountName: `GoBye / ${fullName.trim() || 'Rider'}`,
    isSimulated: true,
  };
}
