import type { Kobo } from '../types';

/**
 * Payment gateway adapter contract (provider-independent, D-054).
 *
 * GoBye's backend talks to every payment provider through this interface, so choosing or switching a
 * provider (Q-042) means writing one adapter, not changing business logic. Adapters run ONLY on the
 * server: they hold secret keys read from the backend secret store, never from app or admin code,
 * `EXPO_PUBLIC_*` / `VITE_*` variables or plaintext settings.
 *
 * Status: interface + a SIMULATED adapter for tests and the admin prototype. No real adapter exists yet
 * because no provider has been selected.
 */

export type GatewayCapability =
  | 'collect_bank_transfer' // dedicated or dynamic virtual account / pay-by-transfer
  | 'collect_card'
  | 'payout_bank_transfer'
  | 'refund'
  | 'webhook_signature'
  | 'transaction_lookup' // verify a collection or transfer by our reference
  | 'bank_account_resolve'
  | 'settlement_report';

/** Capabilities GoBye needs before an adapter can carry live money. Cards are out of scope (D-023). */
export const REQUIRED_CAPABILITIES: readonly GatewayCapability[] = ['collect_bank_transfer', 'payout_bank_transfer', 'webhook_signature', 'transaction_lookup', 'bank_account_resolve'];

export type GatewayErrorClass =
  /** Safe to try again later (timeout before sending, 429, 5xx with a definite "not processed"). */
  | 'transient'
  /** Will fail the same way again until something changes (invalid account, insufficient balance, bad credentials). */
  | 'permanent'
  /** The request may have been processed (timeout after sending, connection cut). NEVER retry: look up by reference. */
  | 'unknown_outcome';

export interface GatewayError {
  class: GatewayErrorClass;
  code: string;
  message: string;
  /** Provider's own code, kept for support; never shown to riders or drivers. */
  providerCode?: string;
}

export type GatewayResult<T> = { ok: true; value: T } | { ok: false; error: GatewayError };

export interface CollectionRequest {
  /** Our reference; doubles as the idempotency key at the provider. */
  reference: string;
  purpose: 'wallet_funding' | 'package_purchase' | 'trip_payment';
  /** What the customer is asked to pay, after any customer-borne fees (from the fee quote). */
  amount: Kobo;
  customer: { id: string; name: string; email?: string; phone?: string };
  /** Pinned so the provider charge can be checked against the quote shown to the customer. */
  quoteId: string;
}

export interface CollectionInstructions {
  reference: string;
  method: 'bank_transfer';
  /** Account the customer transfers to (virtual account), when the provider gives one. */
  account?: { bankName: string; accountNumber: string; accountName: string; expiresAt?: number };
  checkoutUrl?: string;
}

export type ProviderTxnStatus = 'pending' | 'successful' | 'failed' | 'abandoned' | 'reversed';

export interface CollectionVerification {
  reference: string;
  status: ProviderTxnStatus;
  /** Amount the provider actually received from the customer. */
  amountReceived: Kobo;
  currency: string;
  /** What the provider kept. Unknown until the provider reports it. */
  providerCharge: Kobo | null;
  paidAt?: number;
  providerTransactionId?: string;
}

export interface TransferRequest {
  reference: string;
  amount: Kobo;
  bankAccount: { bankCode: string; accountNumber: string; accountName: string };
  narration: string;
}

export interface TransferStatus {
  reference: string;
  status: 'processing' | 'successful' | 'failed' | 'reversed';
  amount: Kobo;
  providerCharge: Kobo | null;
  completedAt?: number;
  failureReason?: string;
}

export interface WebhookInput {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

export interface NormalisedWebhookEvent {
  /** Provider event id: used to drop duplicate deliveries. */
  eventId: string;
  type: 'collection.successful' | 'collection.failed' | 'transfer.successful' | 'transfer.failed' | 'transfer.reversed' | 'refund.processed' | 'other';
  reference: string;
  receivedAt: number;
}

export interface PaymentGatewayAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: readonly GatewayCapability[];
  /** True only for the simulated adapter. The UI must label anything it produces as simulated. */
  readonly simulated: boolean;
  initializeCollection(req: CollectionRequest): Promise<GatewayResult<CollectionInstructions>>;
  /** Server-to-server lookup. The only thing that can confirm a payment (a webhook alone never does). */
  verifyCollection(reference: string): Promise<GatewayResult<CollectionVerification>>;
  createTransfer(req: TransferRequest): Promise<GatewayResult<TransferStatus>>;
  getTransfer(reference: string): Promise<GatewayResult<TransferStatus>>;
  /** Check the signature and turn the provider's payload into a normalised event. Unsigned → rejected. */
  parseWebhook(input: WebhookInput): GatewayResult<NormalisedWebhookEvent>;
}

export function missingCapabilities(adapter: Pick<PaymentGatewayAdapter, 'capabilities'>): GatewayCapability[] {
  return REQUIRED_CAPABILITIES.filter((c) => !adapter.capabilities.includes(c));
}

/* ---------- Simulated adapter (tests and prototype only) ---------- */

export interface SimulatedGatewayOptions {
  /** Provider charge the simulation reports, in basis points of the amount (test value, not a real price). */
  chargeBps?: number;
  now?: () => number;
  /** Force the next calls to fail with this class (to exercise retry and escalation paths). */
  failNext?: GatewayErrorClass[];
  webhookSecret?: string;
}

/**
 * In-memory adapter. Transfers and collections are recorded by reference, so calling twice with the
 * same reference returns the first result (idempotent like a real provider should be). Every value it
 * returns is SIMULATED.
 */
export function createSimulatedGateway(opts: SimulatedGatewayOptions = {}): PaymentGatewayAdapter & {
  /** Test helper: the customer "pays" a pending collection. */
  simulatePayment(reference: string, amount: Kobo): void;
  /** Test helper: build a signed webhook body. */
  signedWebhook(e: Omit<NormalisedWebhookEvent, 'receivedAt'>): WebhookInput;
  calls: { createTransfer: number; initializeCollection: number };
} {
  const now = opts.now ?? Date.now;
  const bps = opts.chargeBps ?? 0;
  const failQueue = [...(opts.failNext ?? [])];
  const secret = opts.webhookSecret ?? 'simulated-webhook-secret';
  const collections = new Map<string, { req: CollectionRequest; paid?: { amount: Kobo; at: number } }>();
  const transfers = new Map<string, TransferStatus>();
  const calls = { createTransfer: 0, initializeCollection: 0 };
  const charge = (a: Kobo) => Math.round((a * bps) / 10_000) as Kobo;
  const failure = (): GatewayError | null => {
    const c = failQueue.shift();
    if (!c) return null;
    const code = c === 'transient' ? 'provider_unavailable' : c === 'permanent' ? 'invalid_account' : 'timeout_after_send';
    return { class: c, code, message: `Simulated ${c} failure` };
  };
  const sign = (body: string) => `sim-${secret.length}-${body.length}`;

  return {
    key: 'simulated',
    displayName: 'Simulated gateway (test only)',
    capabilities: ['collect_bank_transfer', 'payout_bank_transfer', 'refund', 'webhook_signature', 'transaction_lookup', 'bank_account_resolve', 'settlement_report'],
    simulated: true,
    calls,
    async initializeCollection(req) {
      calls.initializeCollection += 1;
      const f = failure();
      if (f) return { ok: false, error: f };
      if (!collections.has(req.reference)) collections.set(req.reference, { req });
      return { ok: true, value: { reference: req.reference, method: 'bank_transfer', account: { bankName: 'Simulated Bank', accountNumber: '0000000000', accountName: 'GoBye (simulated)' } } };
    },
    async verifyCollection(reference) {
      const c = collections.get(reference);
      if (!c) return { ok: false, error: { class: 'permanent', code: 'not_found', message: 'No collection with this reference' } };
      return {
        ok: true,
        value: c.paid
          ? { reference, status: 'successful', amountReceived: c.paid.amount, currency: 'NGN', providerCharge: charge(c.paid.amount), paidAt: c.paid.at, providerTransactionId: `sim_${reference}` }
          : { reference, status: 'pending', amountReceived: 0 as Kobo, currency: 'NGN', providerCharge: null },
      };
    },
    async createTransfer(req) {
      calls.createTransfer += 1;
      const existing = transfers.get(req.reference);
      if (existing) return { ok: true, value: existing }; // idempotent by reference
      const f = failure();
      if (f) {
        // An unknown outcome means the provider DID receive it in this simulation: a blind retry would be a duplicate payout.
        if (f.class === 'unknown_outcome') transfers.set(req.reference, { reference: req.reference, status: 'processing', amount: req.amount, providerCharge: null });
        return { ok: false, error: f };
      }
      const t: TransferStatus = { reference: req.reference, status: 'processing', amount: req.amount, providerCharge: null };
      transfers.set(req.reference, t);
      return { ok: true, value: t };
    },
    async getTransfer(reference) {
      const t = transfers.get(reference);
      return t ? { ok: true, value: t } : { ok: false, error: { class: 'permanent', code: 'not_found', message: 'No transfer with this reference' } };
    },
    parseWebhook(input) {
      const sig = input.headers['x-simulated-signature'];
      if (!sig || sig !== sign(input.rawBody)) return { ok: false, error: { class: 'permanent', code: 'bad_signature', message: 'Webhook signature does not match' } };
      try {
        const e = JSON.parse(input.rawBody) as Omit<NormalisedWebhookEvent, 'receivedAt'>;
        return { ok: true, value: { ...e, receivedAt: now() } };
      } catch {
        return { ok: false, error: { class: 'permanent', code: 'bad_payload', message: 'Webhook body is not valid JSON' } };
      }
    },
    simulatePayment(reference, amount) {
      const c = collections.get(reference);
      if (c) c.paid = { amount, at: now() };
    },
    signedWebhook(e) {
      const rawBody = JSON.stringify(e);
      return { rawBody, headers: { 'x-simulated-signature': sign(rawBody) } };
    },
  };
}
