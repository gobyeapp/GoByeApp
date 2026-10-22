import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { naira, walletSummary, type DepositInstructions, type Kobo, type WalletTransaction } from '@gobye/core';
import { useServices } from './services';

/**
 * Wallet state (brief §10). The wallet service (simulated) is the source of truth: deposits stay
 * `pending` until confirmed; trip payments are recorded by the payment service.
 */
type LoadState = 'loading' | 'ready' | 'error';

interface WalletValue {
  state: LoadState;
  transactions: WalletTransaction[];
  available: Kobo;
  reserved: Kobo;
  pendingIn: Kobo;
  refresh(): Promise<void>;
  startDeposit(amount: Kobo): Promise<DepositInstructions>;
  /** Ask whether a pending deposit has been confirmed. */
  checkDeposit(transactionId: string): Promise<WalletTransaction['status']>;
}

const WalletContext = createContext<WalletValue | null>(null);

export const DEPOSIT_OPTIONS: Kobo[] = [naira(2000), naira(5000), naira(10000)];

export function WalletProvider({ children }: { children: ReactNode }) {
  const { wallet } = useServices();
  const [state, setState] = useState<LoadState>('loading');
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setState((s) => (s === 'ready' ? 'ready' : 'loading'));
    try {
      const list = await wallet.listTransactions();
      if (mounted.current) {
        setTransactions(list);
        setState('ready');
      }
    } catch {
      if (mounted.current) setState('error');
    }
  }, [wallet]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const value = useMemo<WalletValue>(() => {
    const s = walletSummary(transactions);
    return {
      state,
      transactions,
      available: s.available as Kobo,
      reserved: s.reserved as Kobo,
      pendingIn: s.pendingIn as Kobo,
      refresh,
      async startDeposit(amount) {
        const instructions = await wallet.requestDeposit(amount);
        await refresh();
        return instructions;
      },
      async checkDeposit(id) {
        const status = await wallet.checkDeposit(id);
        await refresh();
        return status;
      },
    };
  }, [state, transactions, refresh, wallet]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletValue {
  const w = useContext(WalletContext);
  if (!w) throw new Error('useWallet must be used inside <WalletProvider>');
  return w;
}
