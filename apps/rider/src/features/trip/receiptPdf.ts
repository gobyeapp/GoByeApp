import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { RECEIPT_LOGO } from './receiptLogo';
import { PAYMENT_METHOD_LABELS, formatDistance, formatDuration, formatNaira, receiptReference, type Kobo, type PaymentMethod, type PaymentStatus, type Place, type DriverSummary } from '@gobye/core';

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
  /** Pickup time (falls back to the completion time when unknown). */
  startedAt?: number;
  completedAt: number;
  distanceMeters: number;
  durationSeconds: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Branded PDF receipt, matching the in-app ticket: aubergine header with the GoBye mark, the total and
 * payment status, a perforated tear line, the journey timeline (ink pickup, tangerine drop-off), trip
 * facts, driver and vehicle, the fare breakdown with the 0% commission note, and the reference.
 * Inter is requested from Google Fonts; offline it falls back to the system sans serif.
 */
export function receiptHtml(d: ReceiptData): string {
  const day = new Date(d.completedAt).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const t = (ms: number) => new Date(ms).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  const v = d.driver?.vehicle;
  const driverName = d.driver ? [d.driver.firstName, d.driver.lastName].filter(Boolean).join(' ') : '';
  const paid = d.paymentStatusLabel === 'Paid';
  const method = PAYMENT_METHOD_LABELS[d.paymentMethod.type] ?? d.paymentMethod.label;
  const line = (k: string, val: string, hint = '') =>
    `<div class="line"><div><div class="k">${esc(k)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div><div class="v">${esc(val)}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <style>
    @page{margin:28px}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,-apple-system,'Helvetica Neue',Arial,sans-serif;color:#171717;background:#F4F4F4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .wrap{max-width:520px;margin:24px auto}
    .ticket{background:#FFFFFF;border-radius:24px;overflow:hidden;border:1px solid #EAEAEA}
    .band{background:#351A40;color:#FFFFFF;padding:22px 28px 20px}
    .band-top{display:flex;align-items:center;justify-content:space-between}
    .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:-0.02em}
    .brand img{width:28px;height:28px}
    .label{font-size:11px;font-weight:600;letter-spacing:0.14em;opacity:.85}
    .date{margin-top:6px;font-size:13px;opacity:.8}
    .amount{text-align:center;padding:28px 28px 20px}
    .amount .cap{font-size:13px;color:#6B6B6B}
    .amount .num{font-size:44px;font-weight:700;letter-spacing:-0.03em;margin:4px 0 10px;font-variant-numeric:tabular-nums}
    .chips{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}
    .chip{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:#F1F1F1;color:#4D4D4D}
    .chip.ok{background:#E6F4EA;color:#1E7A3A}.chip.wait{background:#FFF4D6;color:#8A5A00}
    .tear{position:relative;height:18px}
    .tear:before,.tear:after{content:'';position:absolute;top:0;width:18px;height:18px;border-radius:50%;background:#F4F4F4}
    .tear:before{left:-9px}.tear:after{right:-9px}
    .tear i{position:absolute;left:18px;right:18px;top:8px;border-top:1.5px dashed #DADADA}
    .sec{padding:18px 28px}
    .stop{display:flex;gap:14px;align-items:flex-start}
    .dot{width:10px;height:10px;border-radius:50%;margin-top:6px;flex:none}
    .sq{border-radius:2px}
    .rail{width:2px;height:16px;background:#E2E2E2;margin:2px 0 2px 4px}
    .stop .t{font-weight:600;font-size:15px}.stop .s{font-size:12px;color:#6B6B6B}
    .stop .time{margin-left:auto;font-size:12px;color:#6B6B6B;font-variant-numeric:tabular-nums}
    .facts{display:flex;margin:0 28px;padding:14px 0;border-top:1px solid #EDEDED;border-bottom:1px solid #EDEDED}
    .fact{flex:1}.fact+.fact{border-left:1px solid #EDEDED;padding-left:14px}
    .fact .k{font-size:11px;color:#6B6B6B}.fact .v{font-size:14px;font-weight:600}
    .driver{display:flex;align-items:center;gap:12px;margin:0 28px;padding:14px 0;border-bottom:1px solid #EDEDED}
    .avatar{width:40px;height:40px;border-radius:50%;background:#EFEFEF;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
    .driver .n{font-weight:600;font-size:14px}.driver .m{font-size:12px;color:#6B6B6B}
    .plate{margin-left:auto;border:1.5px solid #171717;border-radius:6px;padding:2px 8px;font-weight:700;font-size:12px}
    .line{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:14px}
    .line .k{color:#6B6B6B}.line .hint{font-size:11px;color:#8A8A8A}.line .v{font-weight:500;font-variant-numeric:tabular-nums}
    .line.total .k{color:#171717;font-weight:600;font-size:15px}.line.total .v{font-weight:700;font-size:18px}
    .rule{height:1px;background:#EDEDED;margin:6px 0}
    .zero{margin-top:12px;padding:10px 12px;border-radius:12px;background:#F6F6F6;font-size:12px;color:#5C5C5C;display:flex;gap:8px;align-items:center}
    .zero b{color:#FF751F}
    .ref{display:flex;justify-content:space-between;align-items:flex-end;padding:16px 28px 22px}
    .ref .k{font-size:11px;color:#6B6B6B}.ref .v{font-weight:700;font-size:15px;letter-spacing:.08em}
    .ref .svc{font-size:11px;color:#8A8A8A;text-align:right}
    .foot{text-align:center;font-size:11px;color:#8A8A8A;margin-top:14px;line-height:1.5}
  </style></head><body><div class="wrap">
    <div class="ticket">
      <div class="band">
        <div class="band-top"><div class="brand"><img src="${RECEIPT_LOGO}" alt=""/>GoBye</div><div class="label">TRIP RECEIPT</div></div>
        <div class="date">${esc(day)}</div>
      </div>
      <div class="amount">
        <div class="cap">${paid ? 'Total paid' : 'Total'}</div>
        <div class="num">${esc(formatNaira(d.total))}</div>
        <div class="chips"><span class="chip ${paid ? 'ok' : 'wait'}">${esc(d.paymentStatusLabel)}</span><span class="chip">${esc(method)}</span></div>
      </div>
      <div class="tear"><i></i></div>
      <div class="sec">
        <div class="stop"><div class="dot" style="background:#171717"></div><div><div class="t">${esc(d.pickup.title)}</div><div class="s">${esc(d.pickup.subtitle)}</div></div><div class="time">${esc(t(d.startedAt ?? d.completedAt))}</div></div>
        <div class="rail"></div>
        <div class="stop"><div class="dot sq" style="background:#FF751F"></div><div><div class="t">${esc(d.destination.title)}</div><div class="s">${esc(d.destination.subtitle)}</div></div><div class="time">${esc(t(d.completedAt))}</div></div>
      </div>
      <div class="facts">
        <div class="fact"><div class="k">Distance</div><div class="v">${esc(formatDistance(d.distanceMeters))}</div></div>
        <div class="fact"><div class="k">Duration</div><div class="v">${esc(formatDuration(d.durationSeconds))}</div></div>
        <div class="fact"><div class="k">Service</div><div class="v">${esc(d.categoryName)}</div></div>
      </div>
      ${
        d.driver
          ? `<div class="driver"><div class="avatar">${esc((d.driver.firstName[0] ?? '') + (d.driver.lastName?.[0] ?? ''))}</div><div><div class="n">${esc(driverName)}</div><div class="m">★ ${esc(d.driver.rating.toFixed(1))}${v ? ` · ${esc(`${v.colour} ${v.make} ${v.model}`)}` : ''}</div></div>${v ? `<div class="plate">${esc(v.plate)}</div>` : ''}</div>`
          : ''
      }
      <div class="sec">
        ${line('Agreed trip fare', formatNaira(d.fare))}
        ${d.processingFee > 0 ? line(`${method} fee`, formatNaira(d.processingFee), 'Separate from the fare') : ''}
        <div class="rule"></div>
        <div class="line total"><div class="k">Total</div><div class="v">${esc(formatNaira(d.total))}</div></div>
        <div class="zero"><b>♥</b> GoBye takes no commission. Your driver keeps the whole fare.</div>
      </div>
      <div class="tear"><i></i></div>
      <div class="ref"><div><div class="k">Reference</div><div class="v">${esc(receiptReference(d.bookingId))}</div></div><div class="svc">Lagos · Abuja</div></div>
    </div>
    <div class="foot">Preview build: this receipt is from a simulated trip and payment. It is not a tax invoice.</div>
  </div></body></html>`;
}

/** Create a PDF and open the system share sheet (save to Files, send, print). */
export async function shareReceiptPdf(d: ReceiptData): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(d) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `GoBye receipt ${receiptReference(d.bookingId)}`, UTI: 'com.adobe.pdf' });
  }
}

export function receiptStatusLabel(status: PaymentStatus | undefined, completed: boolean): string {
  if (completed || status === 'paid') return 'Paid';
  if (status === 'failed') return 'Payment failed, still outstanding';
  if (status === 'reversed') return 'Reversed, still outstanding';
  if (status === 'processing') return 'Processing';
  return 'Outstanding';
}
