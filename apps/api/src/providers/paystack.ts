import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CollectionVerification, GatewayError, GatewayResult, Kobo, NormalisedWebhookEvent, PaymentGatewayAdapter, TransferStatus } from '@gobye/core';

/**
 * Paystack adapter (D-101), written from Paystack's public API documentation and exercised here against
 * a stand-in server only. It has NOT been run against Paystack: test-mode keys and the checks in
 * docs/PAYMENTS_GO_LIVE.md come first.
 *
 * - Collections: POST /transaction/initialize → the customer pays on Paystack's own page (card or bank
 *   transfer). GoBye never sees a card number.
 * - Proof of payment: GET /transaction/verify/{reference} only.
 * - Payouts: POST /transferrecipient then POST /transfer with our reference; the same reference is
 *   never sent as a new transfer. GET /transfer/verify/{reference} to look one up.
 * - Webhooks: X-Paystack-Signature = HMAC-SHA512(raw body, secret key).
 * Amounts are kobo on both sides. The secret key is never logged or returned.
 */

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface Envelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

export function paystackGateway(o: { secretKey: string; fetch?: FetchLike; timeoutMs?: number; baseUrl?: string; now?: () => number }): PaymentGatewayAdapter {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const base = (o.baseUrl ?? 'https://api.paystack.co').replace(/\/+$/, '');
  const now = o.now ?? Date.now;

  async function call<T>(method: 'GET' | 'POST', path: string, body: object | undefined, sent: 'write' | 'read'): Promise<GatewayResult<T>> {
    let res;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${o.secretKey}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
    } catch {
      // A write that timed out may have reached Paystack: never retry it blindly, look it up.
      return { ok: false, error: { class: sent === 'write' ? 'unknown_outcome' : 'transient', code: 'network', message: 'The payment provider did not answer.' } };
    }
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (res.ok && json?.status && json.data !== undefined) return { ok: true, value: json.data };
    const error: GatewayError =
      res.status === 429 || res.status >= 500
        ? { class: sent === 'write' && res.status >= 500 ? 'unknown_outcome' : 'transient', code: `http_${res.status}`, message: 'The payment provider is busy. Try again shortly.' }
        : { class: 'permanent', code: res.status === 404 ? 'not_found' : `http_${res.status}`, message: 'The payment provider refused the request.', providerCode: typeof json?.message === 'string' ? json.message.slice(0, 120) : undefined };
    return { ok: false, error };
  }

  const collectionStatus = (s: string): CollectionVerification['status'] => (s === 'success' ? 'successful' : s === 'failed' ? 'failed' : s === 'abandoned' ? 'abandoned' : s === 'reversed' ? 'reversed' : 'pending');
  const transferStatus = (s: string): TransferStatus['status'] => (s === 'success' ? 'successful' : s === 'failed' || s === 'abandoned' || s === 'rejected' || s === 'blocked' ? 'failed' : s === 'reversed' ? 'reversed' : 'processing');
  const toTransfer = (reference: string, d: { status: string; amount: number; fee_charged?: number | null; transferred_at?: string | null; updatedAt?: string | null; reason?: string | null; gateway_response?: string | null }): TransferStatus => ({
    reference,
    status: transferStatus(d.status),
    amount: d.amount as Kobo,
    providerCharge: typeof d.fee_charged === 'number' ? (d.fee_charged as Kobo) : null,
    completedAt: d.transferred_at ? Date.parse(d.transferred_at) : undefined,
    failureReason: transferStatus(d.status) === 'failed' ? (d.gateway_response ?? 'Transfer failed') : undefined,
  });

  return {
    key: 'paystack',
    displayName: 'Paystack',
    capabilities: ['collect_bank_transfer', 'collect_card', 'payout_bank_transfer', 'refund', 'webhook_signature', 'transaction_lookup', 'bank_account_resolve'],
    simulated: false,

    async initializeCollection(req) {
      if (!req.customer.email) return { ok: false, error: { class: 'permanent', code: 'email_required', message: 'Add an email address to your profile first.' } };
      const r = await call<{ authorization_url: string; reference: string }>(
        'POST',
        '/transaction/initialize',
        {
          email: req.customer.email,
          amount: req.amount,
          currency: 'NGN',
          reference: req.reference,
          channels: [req.channel === 'card' ? 'card' : 'bank_transfer'],
          ...(req.returnUrl ? { callback_url: req.returnUrl } : {}),
          metadata: { purpose: req.purpose, customer_id: req.customer.id },
        },
        'write',
      );
      if (!r.ok) return r;
      if (!/^https:\/\/([a-z0-9-]+\.)*paystack\.com\//.test(r.value.authorization_url)) return { ok: false, error: { class: 'permanent', code: 'bad_checkout_url', message: 'The payment provider returned an unexpected page.' } };
      return { ok: true, value: { reference: req.reference, method: req.channel === 'card' ? 'card' : 'bank_transfer', checkoutUrl: r.value.authorization_url } };
    },

    async verifyCollection(reference) {
      const r = await call<{ status: string; amount: number; currency: string; fees?: number | null; paid_at?: string | null; id?: number; reference: string }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`, undefined, 'read');
      if (!r.ok) return r;
      const d = r.value;
      return {
        ok: true,
        value: {
          reference: d.reference,
          status: collectionStatus(d.status),
          amountReceived: (collectionStatus(d.status) === 'successful' ? d.amount : 0) as Kobo,
          currency: d.currency,
          providerCharge: typeof d.fees === 'number' ? (d.fees as Kobo) : null,
          paidAt: d.paid_at ? Date.parse(d.paid_at) : undefined,
          providerTransactionId: d.id !== undefined ? String(d.id) : undefined,
        },
      };
    },

    async createTransfer(req) {
      const rcp = await call<{ recipient_code: string }>('POST', '/transferrecipient', { type: 'nuban', name: req.bankAccount.accountName, account_number: req.bankAccount.accountNumber, bank_code: req.bankAccount.bankCode, currency: 'NGN' }, 'read');
      if (!rcp.ok) return rcp;
      const r = await call<{ status: string; amount: number; fee_charged?: number | null; transferred_at?: string | null }>('POST', '/transfer', { source: 'balance', amount: req.amount, recipient: rcp.value.recipient_code, reason: req.narration.slice(0, 100), reference: req.reference, currency: 'NGN' }, 'write');
      if (!r.ok) return r;
      // "otp" means the Paystack account still asks a person to approve transfers: nothing was sent.
      if (r.value.status === 'otp') return { ok: false, error: { class: 'permanent', code: 'otp_required', message: 'Transfers need approval in the Paystack dashboard. Turn off the transfer OTP for API payouts.' } };
      return { ok: true, value: toTransfer(req.reference, r.value) };
    },

    async getTransfer(reference) {
      const r = await call<{ status: string; amount: number; fee_charged?: number | null; transferred_at?: string | null; gateway_response?: string | null }>('GET', `/transfer/verify/${encodeURIComponent(reference)}`, undefined, 'read');
      return r.ok ? { ok: true, value: toTransfer(reference, r.value) } : r;
    },

    parseWebhook(input) {
      const sig = input.headers['x-paystack-signature'];
      const want = createHmac('sha512', o.secretKey).update(input.rawBody).digest();
      let got: Buffer;
      try {
        got = Buffer.from(sig ?? '', 'hex');
      } catch {
        got = Buffer.alloc(0);
      }
      if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, error: { class: 'permanent', code: 'bad_signature', message: 'Webhook signature does not match' } };
      let e: { event?: string; data?: { id?: number | string; reference?: string; transfer_code?: string } };
      try {
        e = JSON.parse(input.rawBody);
      } catch {
        return { ok: false, error: { class: 'permanent', code: 'bad_payload', message: 'Webhook body is not valid JSON' } };
      }
      const reference = e.data?.reference;
      if (!e.event || typeof reference !== 'string') return { ok: false, error: { class: 'permanent', code: 'bad_payload', message: 'Webhook has no event or reference' } };
      const type: NormalisedWebhookEvent['type'] =
        e.event === 'charge.success' ? 'collection.successful' : e.event === 'transfer.success' ? 'transfer.successful' : e.event === 'transfer.failed' ? 'transfer.failed' : e.event === 'transfer.reversed' ? 'transfer.reversed' : e.event === 'refund.processed' ? 'refund.processed' : 'other';
      return { ok: true, value: { eventId: `${e.event}:${e.data?.id ?? e.data?.transfer_code ?? reference}`, type, reference, receivedAt: now() } };
    },
  };
}
