import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatDistance, formatDuration, formatNaira, type Kobo, type PaymentMethod, type PaymentStatus, type Place, type DriverSummary } from '@gobye/core';

/** Data needed for a receipt — works for an active (unfinished) booking or a stored TripReceipt. */
export interface ReceiptData {
  bookingId: string;
  fare: Kobo;
  processingFee: Kobo;
  total: Kobo;
  paymentMethod: PaymentMethod;
  paymentStatusLabel: string;
  pickup: Place;
  destination: Place;
  driver?: DriverSummary;
  categoryName: string;
  completedAt: number;
  distanceMeters: number;
  durationSeconds: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export function receiptHtml(d: ReceiptData): string {
  const date = new Date(d.completedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  const v = d.driver?.vehicle;
  const row = (k: string, val: string, bold = false) =>
    `<tr><td style="padding:6px 0;color:#666666">${esc(k)}</td><td style="padding:6px 0;text-align:right;${bold ? 'font-weight:700' : ''}">${esc(val)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#171717;padding:32px}
    h1{font-size:22px;margin:0}.muted{color:#666666;font-size:12px}
    .total{font-size:32px;font-weight:700;margin:12px 0}
    table{width:100%;border-collapse:collapse;font-size:14px}hr{border:none;border-top:1px solid #E8E8E8;margin:16px 0}
    .note{margin-top:24px;padding:12px;background:#F7F7F7;color:#666666;border-radius:8px;font-size:12px}
  </style></head><body>
    <h1>GoBye trip receipt</h1>
    <div class="muted">${esc(date)} · Ref ${esc(d.bookingId)}</div>
    <div class="total">${esc(formatNaira(d.total))}</div>
    <div class="muted">Payment status: <b>${esc(d.paymentStatusLabel)}</b> · ${esc(d.paymentMethod.label)}</div>
    <hr/>
    <table>
      ${row('From', `${d.pickup.title}, ${d.pickup.subtitle}`)}
      ${row('To', `${d.destination.title}, ${d.destination.subtitle}`)}
      ${row('Distance / time (estimated)', `${formatDistance(d.distanceMeters)} · ${formatDuration(d.durationSeconds)}`)}
      ${row('Service', d.categoryName)}
      ${d.driver ? row('Driver', [d.driver.firstName, d.driver.lastName].filter(Boolean).join(' ')) : ''}
      ${v ? row('Vehicle', `${v.colour} ${v.make} ${v.model} · ${v.plate}`) : ''}
    </table>
    <hr/>
    <table>
      ${row('Agreed trip fare', formatNaira(d.fare))}
      ${d.processingFee > 0 ? row(`${d.paymentMethod.label} fee (separate from fare)`, formatNaira(d.processingFee)) : ''}
      ${row('Total', formatNaira(d.total), true)}
    </table>
    <div class="note">Preview build: this receipt is from a simulated trip and payment. It is not a tax invoice.</div>
  </body></html>`;
}

/** Create a PDF and open the system share sheet (save to Files, send, print). */
export async function shareReceiptPdf(d: ReceiptData): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(d) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'GoBye receipt', UTI: 'com.adobe.pdf' });
  }
}

export function receiptStatusLabel(status: PaymentStatus | undefined, completed: boolean): string {
  if (completed || status === 'paid') return 'Paid';
  if (status === 'failed') return 'Payment failed, still outstanding';
  if (status === 'reversed') return 'Reversed, still outstanding';
  if (status === 'processing') return 'Processing';
  return 'Outstanding';
}
