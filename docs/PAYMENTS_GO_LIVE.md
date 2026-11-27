# Switching money on

Money is built (D-101) and off. Nothing below is done yet. Do the steps in order; each has a check.

| # | Step | Who | Check |
|---|---|---|---|
| 1 | Choose the provider (Paystack has an adapter; another provider needs one written) and open the business account (needs the CAC documents) | Owner | Test keys issued |
| 2 | Set `PAYMENTS_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY=sk_test_…`, `WALLET_ENABLED=true`, `PAYMENTS_RETURN_URL` on **staging** (server secret store, never git) | Developer | `GET /v1/wallet` shows `enabled: true` |
| 3 | In the provider's dashboard set the webhook to `https://<api>/v1/webhooks/payments/paystack` | Owner | A test payment's webhook answers 200 |
| 4 | Run the adapter against the provider's test mode: a card top-up, a transfer top-up, an abandoned payment, a wrong-amount case, a payout, a failed payout | Developer | Each ends in the expected state; the ledger integrity report stays clean |
| 5 | Turn off "transfer OTP" for API payouts at the provider (the adapter refuses OTP mode) | Owner | A test payout goes through without a code |
| 6 | Finance reviews the chart of accounts and the journals for each case in step 4 | Finance | Signed off |
| 7 | Reconcile a day of test payments against the provider's settlement report | Finance | No unexplained difference |
| 8 | Independent security test of the money routes | Outside tester | Report with no open high findings |
| 9 | Decide fees (none are charged today; GoBye absorbs the provider's charge), the refund policy, and whether drivers must hold a pass (`DRIVER_PASS_REQUIRED`) | Owner | Recorded in DECISIONS |
| 10 | Production: live key (the server refuses a test key in production and a live key anywhere else), webhook URL, then `WALLET_ENABLED=true` | Developer with owner approval | First real ₦100 top-up credited and visible in Finance |

Dedicated account numbers per rider (so a transfer needs no reference) are a provider feature that needs a
registered business; the wallet screen keeps its "Test" label until then.
