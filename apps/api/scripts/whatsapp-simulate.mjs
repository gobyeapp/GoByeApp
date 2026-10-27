#!/usr/bin/env node
// Sends a signed, Meta-shaped WhatsApp webhook to a LOCAL or staging API, to try the quick-booking chat
// without Meta (D-064). Replies go to the simulated sender (WHATSAPP_PROVIDER=simulated) and show in the
// API's logs as "whatsapp.simulated" (type only), or in ops.jobs results.
//
//   export WHATSAPP_APP_SECRET=... WHATSAPP_PHONE_NUMBER_ID=...   (same values as the API)
//   node apps/api/scripts/whatsapp-simulate.mjs http://127.0.0.1:8080 2348030000101 pin 6.4474 3.4723 "Lekki Phase 1"
//   node apps/api/scripts/whatsapp-simulate.mjs http://127.0.0.1:8080 2348030000101 pin 6.6018 3.3515 "Ikeja City Mall"
//   node apps/api/scripts/whatsapp-simulate.mjs http://127.0.0.1:8080 2348030000101 tap ride:go
//   node apps/api/scripts/whatsapp-simulate.mjs http://127.0.0.1:8080 2348030000101 text CANCEL
//
// The API must accept unsigned origin requests (ORIGIN_AUTH_REQUIRED=false, development only), or be
// reached through the gateway.
import { createHmac, randomUUID } from 'node:crypto';

const [base, from, cmd, ...rest] = process.argv.slice(2);
const secret = process.env.WHATSAPP_APP_SECRET;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
if (!base || !/^\d{8,15}$/.test(from ?? '') || !['pin', 'tap', 'text'].includes(cmd) || !secret || !phoneNumberId) {
  console.error('Usage: whatsapp-simulate.mjs <api base> <wa number digits> pin <lat> <lng> [name] | tap <id> | text <message>\nNeeds WHATSAPP_APP_SECRET and WHATSAPP_PHONE_NUMBER_ID in the environment.');
  process.exit(64);
}
const message =
  cmd === 'pin'
    ? { type: 'location', location: { latitude: Number(rest[0]), longitude: Number(rest[1]), ...(rest[2] ? { name: rest.slice(2).join(' ') } : {}) } }
    : cmd === 'tap'
      ? { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: rest[0], title: rest[0] } } }
      : { type: 'text', text: { body: rest.join(' ') } };
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'SIMULATED', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, messages: [{ from, id: `wamid.SIM${randomUUID().replace(/-/g, '')}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }],
});
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const res = await fetch(`${base.replace(/\/+$/, '')}/v1/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
console.log(res.status, await res.text());
