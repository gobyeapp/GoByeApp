import type { FeeSchedule } from '../gateway/fees';
import { seedVendors, type Budget, type Expense, type Vendor } from '../costs';
import { emptySubscriptionState, planForAmount, recordPassPayment, subscriptionTimelineResponse, voidPass, type SubscriptionState } from '../subscriptions';
import type { AutomationRun } from '../automation/runs';
import { simulatedAutomationRuns, simulatedFeeSchedules, simulatedSettingChanges } from '../automation/simulate';
import type { AutomationSettingChange } from '../automation/settings';
import { naira } from '../money';
import { seededRandom } from '../mocks/data';
import type { Kobo } from '../types';
import { chargeTripFromWallet, creditWalletFunding, postJournal, releaseWithdrawal, reserveWithdrawal, settleWithdrawal } from './ledger';
import type { StaffMember } from './permissions';
import type {
  Actor,
  Announcement,
  ApprovalRequest,
  AuditEvent,
  CaseRecord,
  CityId,
  CollectionRecord,
  ConfigVersion,
  DriverDocument,
  DriverRecord,
  DriverVerification,
  EventPartnership,
  IntegrationRecord,
  LedgerEntry,
  NegotiationStep,
  NegotiationHistory,
  PassengerRecord,
  PromoCampaign,
  RefundRecord,
  SettlementRecord,
  TripRecord,
  TripStatus,
  WithdrawalRecord,
} from './types';

/**
 * TEST DATA for the management prototype. Deterministic (seeded) so screenshots and tests are stable.
 * Names, phone numbers, bank details and references are invented; nothing here is a real person,
 * account or transaction. The admin UI labels every screen built on this as test data.
 */
export interface PlatformDataset {
  generatedAt: number;
  staff: StaffMember[];
  passengers: PassengerRecord[];
  drivers: DriverRecord[];
  trips: TripRecord[];
  cases: CaseRecord[];
  ledger: LedgerEntry[];
  collections: CollectionRecord[];
  withdrawals: WithdrawalRecord[];
  refunds: RefundRecord[];
  settlements: SettlementRecord[];
  integrations: IntegrationRecord[];
  configVersions: ConfigVersion[];
  campaigns: PromoCampaign[];
  announcements: Announcement[];
  approvals: ApprovalRequest[];
  events: EventPartnership[];
  audit: AuditEvent[];
  /** Wallet funding and withdrawal fee schedules (D-054). Test data: every fee is "Not set". */
  feeSchedules: FeeSchedule[];
  /** SIMULATED automation run history (D-055). No job runner exists yet. */
  automationRuns: AutomationRun[];
  automationChanges: AutomationSettingChange[];
  /** Infrastructure and operating costs (D-057): real plan status, no invented bills. */
  vendors: Vendor[];
  expenses: Expense[];
  budgets: Budget[];
  /** Authoritative pass timelines per driver (D-058). `DriverRecord.access` is derived from these. */
  subscriptions: SubscriptionState[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const FIRST = ['Adaeze', 'Tunde', 'Chiamaka', 'Ibrahim', 'Funke', 'Emeka', 'Zainab', 'Segun', 'Ngozi', 'Musa', 'Kemi', 'Obinna', 'Halima', 'Bayo', 'Amaka', 'Yusuf', 'Bisi', 'Chidi', 'Aisha', 'Femi'];
const LAST = ['Okafor', 'Adeyemi', 'Bello', 'Eze', 'Ogunleye', 'Abubakar', 'Nwosu', 'Balogun', 'Okonkwo', 'Danjuma', 'Afolabi', 'Umar'];
const PLACES: Record<CityId, string[]> = {
  lagos: ['Lekki Phase 1', 'Ikeja City Mall', 'Yaba', 'Victoria Island', 'Surulere', 'Murtala Muhammed Airport', 'Ajah', 'Festac Town', 'Ikoyi', 'Maryland'],
  abuja: ['Wuse 2', 'Garki', 'Maitama', 'Nnamdi Azikiwe Airport', 'Jabi Lake Mall', 'Gwarinpa', 'Asokoro', 'Utako', 'Central Business District', 'Kubwa'],
};
const VEHICLES = [
  { make: 'Toyota', model: 'Corolla', colour: 'Silver' },
  { make: 'Honda', model: 'Accord', colour: 'Black' },
  { make: 'Hyundai', model: 'Elantra', colour: 'White' },
  { make: 'Toyota', model: 'Camry', colour: 'Grey' },
  { make: 'Kia', model: 'Rio', colour: 'Blue' },
];
const PROVIDER = 'Paystack (test)';

/** Fare conversation for a Negotiate trip. Uses its own random stream so the rest of the test data is unchanged. */
function negotiationFor(t: TripRecord, drivers: DriverRecord[], rnd: () => number): NegotiationHistory {
  const n5 = (k: number) => (Math.round(k / 5000) * 5000) as Kobo;
  const riderOffer = n5(t.suggestedFare * (0.75 + rnd() * 0.2));
  const offeredAt = t.requestedAt;
  const expiresAt = offeredAt + 120_000;
  const events: NegotiationStep[] = [{ at: offeredAt, by: 'rider', kind: 'offer', amount: riderOffer }];
  const pool = [...drivers].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
  const target = t.agreedFare;
  pool.forEach((d, k) => {
    const at = offeredAt + (15 + k * 20 + Math.floor(rnd() * 15)) * 1000;
    const amount = k === 0 && target ? target : rnd() < 0.4 ? riderOffer : n5(riderOffer * (1.05 + rnd() * 0.2));
    events.push({ at, by: 'driver', kind: amount === riderOffer ? 'accept' : 'counter', amount, driverId: d.id, driverName: d.name });
  });
  if (target && t.driverId) {
    const chosen = drivers.find((d) => d.id === t.driverId);
    const firstDriver = events.find((e) => e.by === 'driver');
    if (firstDriver && chosen) {
      firstDriver.driverId = chosen.id;
      firstDriver.driverName = chosen.name;
      firstDriver.kind = target === riderOffer ? 'accept' : 'counter';
    }
    const agreedAt = Math.max(...events.map((e) => e.at)) + 8_000;
    events.push({ at: agreedAt, by: 'rider', kind: 'select', amount: target, driverId: t.driverId, driverName: chosen?.name });
    return { riderOffer, offeredAt, expiresAt, events, outcome: 'agreed', agreedAt };
  }
  if (t.status === 'searching') return { riderOffer, offeredAt, expiresAt, events, outcome: 'open' };
  events.push({ at: expiresAt, by: 'system', kind: 'expired', amount: riderOffer });
  return { riderOffer, offeredAt, expiresAt, events, outcome: 'expired' };
}

export function createPlatformDataset(now: number = Date.UTC(2026, 9, 21, 20, 0)): PlatformDataset {
  const r = seededRandom(20261021);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const id = (p: string, i: number) => `${p}-${String(i + 1).padStart(4, '0')}`;
  const phone = () => `+234 80${int(1, 9)} ${int(100, 999)} ${int(1000, 9999)}`;
  const name = () => `${pick(FIRST)} ${pick(LAST)}`;
  const sys = (n: string): Actor => ({ kind: 'system', name: n });

  // ---------- Staff (permission groups; one person may hold several) ----------
  const staff: StaffMember[] = [
    { id: 'stf-owner', name: 'Akorede (Owner)', email: 'owner@example.test', roles: ['owner'], cities: [], status: 'active' },
    { id: 'stf-admin', name: 'Ifeoma Admin', email: 'admin@example.test', roles: ['admin'], cities: [], status: 'active' },
    { id: 'stf-ops', name: 'Kunle Dispatch', email: 'ops@example.test', roles: ['operations'], cities: ['lagos'], status: 'active' },
    { id: 'stf-ops-abj', name: 'Hauwa Dispatch', email: 'ops.abj@example.test', roles: ['operations', 'onboarding'], cities: ['abuja'], status: 'active' },
    { id: 'stf-onb', name: 'Tobi Onboarding', email: 'onboarding@example.test', roles: ['onboarding'], cities: [], status: 'active' },
    { id: 'stf-care', name: 'Ruth Care', email: 'care@example.test', roles: ['care'], cities: [], status: 'active' },
    { id: 'stf-safety', name: 'Daniel Safety', email: 'safety@example.test', roles: ['safety'], cities: [], status: 'active' },
    { id: 'stf-fin', name: 'Grace Finance', email: 'finance@example.test', roles: ['finance'], cities: [], status: 'active' },
    { id: 'stf-fin2', name: 'Uche Finance', email: 'finance2@example.test', roles: ['finance'], cities: [], status: 'active' },
    { id: 'stf-mkt', name: 'Lola Marketing', email: 'marketing@example.test', roles: ['marketing'], cities: [], status: 'active' },
    { id: 'stf-dev', name: 'Sani Developer', email: 'dev@example.test', roles: ['developer'], cities: [], status: 'active' },
    { id: 'stf-audit', name: 'External Auditor', email: 'audit@example.test', roles: ['auditor'], cities: [], status: 'active' },
    { id: 'stf-new', name: 'Pending Invite', email: 'new.hire@example.test', roles: ['care'], cities: ['lagos'], status: 'invited' },
  ];
  const actor = (sid: string): Actor => {
    const s = staff.find((x) => x.id === sid)!;
    return { kind: 'staff', id: s.id, name: s.name };
  };

  // ---------- Passengers ----------
  const passengers: PassengerRecord[] = Array.from({ length: 48 }, (_, i) => {
    const city: CityId = r() < 0.65 ? 'lagos' : 'abuja';
    const restricted = i === 7 || i === 31;
    return {
      id: id('pas', i),
      name: name(),
      phone: phone(),
      email: r() < 0.6 ? `rider${i + 1}@example.test` : undefined,
      city,
      joinedAt: now - int(2, 120) * DAY,
      status: restricted ? 'restricted' : 'active',
      restriction: restricted ? { reason: i === 7 ? 'Repeated no-shows' : 'Payment dispute under review', by: 'Ruth Care' } : undefined,
      trips: 0,
      rating: Math.round((4.2 + r() * 0.8) * 10) / 10,
    };
  });

  // ---------- Drivers ----------
  const verifications: DriverVerification[] = ['approved', 'approved', 'approved', 'approved', 'approved', 'in_review', 'documents_pending', 'applied', 'rejected', 'suspended'];
  const docKinds: DriverDocument['kind'][] = ['licence', 'vehicle_registration', 'insurance', 'roadworthiness', 'id_card', 'photo'];
  const drivers: DriverRecord[] = Array.from({ length: 36 }, (_, i) => {
    const city: CityId = r() < 0.6 ? 'lagos' : 'abuja';
    const verification = i < 22 ? 'approved' : pick(verifications);
    const v = pick(VEHICLES);
    const documents: DriverDocument[] = docKinds.map((kind) => {
      if (verification === 'applied') return { kind, status: kind === 'photo' ? 'submitted' : 'missing' };
      if (verification === 'documents_pending' && (kind === 'insurance' || kind === 'roadworthiness')) return { kind, status: 'missing' };
      if (verification === 'rejected' && kind === 'licence') return { kind, status: 'rejected', note: 'Licence photo unreadable' };
      const expiresAt = kind === 'photo' || kind === 'id_card' ? undefined : now + int(-10, 300) * DAY;
      const status = expiresAt !== undefined && expiresAt < now ? 'expired' : verification === 'in_review' ? 'submitted' : 'accepted';
      return { kind, status, expiresAt };
    });
    const hasAccess = verification === 'approved' && r() < 0.8;
    const packageId = r() < 0.5 ? 'daily' : 'monthly';
    return {
      id: id('drv', i),
      name: name(),
      phone: phone(),
      city,
      appliedAt: now - int(1, 200) * DAY,
      verification,
      rejectionReason: verification === 'rejected' ? 'Licence photo unreadable; resubmission invited' : undefined,
      documents,
      vehicle: { ...v, year: int(2010, 2021), plate: `${pick(['KJA', 'LND', 'ABC', 'FKJ', 'GWA', 'BWR'])} ${int(100, 999)} ${pick(['AB', 'KJ', 'XA', 'BG'])}`, category: 'go' },
      access: hasAccess ? { packageId, expiresAt: now + (packageId === 'daily' ? int(-1, 1) * DAY + 6 * HOUR : int(-3, 28) * DAY) } : null,
      online: hasAccess && r() < 0.5,
      rating: Math.round((4.3 + r() * 0.7) * 100) / 100,
      trips: 0,
      acceptanceRate: Math.round((0.7 + r() * 0.29) * 100) / 100,
      bankAccount: verification === 'approved' ? { bankName: pick(['GTBank', 'Access Bank', 'Zenith Bank', 'Opay', 'Moniepoint']), accountNumberMasked: `******${int(1000, 9999)}`, accountName: '', verified: r() < 0.9 } : undefined,
    };
  });
  drivers.forEach((d) => d.bankAccount && (d.bankAccount.accountName = d.name.toUpperCase()));
  const activeDrivers = drivers.filter((d) => d.verification === 'approved');

  // ---------- Ledger: wallet fundings first ----------
  let ledger: LedgerEntry[] = [];
  const collections: CollectionRecord[] = [];
  const post = (res: { ok: boolean; entries?: LedgerEntry[] } | { ok: false }) => {
    if (res.ok && 'entries' in res && res.entries) ledger = res.entries;
    return res.ok;
  };
  passengers.forEach((p, i) => {
    const n = int(0, 3);
    for (let k = 0; k < n; k++) {
      const amount = naira(pick([2000, 5000, 5000, 10000, 15000, 20000]));
      const at = now - int(1, 40) * DAY - int(0, 20) * HOUR;
      const reference = `GB-FUND-${i}-${k}-${int(1000, 9999)}`;
      const failed = r() < 0.08;
      collections.push({
        id: `col-f-${i}-${k}`,
        purpose: 'wallet_funding',
        payerType: 'passenger',
        payerId: p.id,
        amount,
        fee: Math.round(amount * 0.015) as Kobo,
        provider: PROVIDER,
        reference,
        status: failed ? 'failed' : 'successful',
        createdAt: at,
        verifiedAt: failed ? undefined : at + 40_000,
        events: failed ? [{ at: at + 60_000, event: 'charge.failed' }] : [{ at: at + 40_000, event: 'charge.success' }, ...(r() < 0.15 ? [{ at: at + 95_000, event: 'charge.success', duplicate: true }] : [])],
      });
      if (!failed) {
        post(creditWalletFunding(ledger, { passengerId: p.id, amount, provider: PROVIDER, reference, now: at }));
        // The provider's fee on the funding is GoBye's processing cost (the passenger is credited in full).
        const fee = Math.round(amount * 0.015) as Kobo;
        post(postJournal(ledger, { lines: [{ account: { kind: 'processing_costs' }, amount: -fee as Kobo }, { account: { kind: 'provider_clearing', provider: PROVIDER }, amount: fee }], kind: 'processing_fee', description: 'Provider fee on wallet funding', by: { kind: 'provider', name: PROVIDER }, now: at, reference: `${reference}-fee`, provider: PROVIDER }));
      }
    }
  });
  // Two fundings still pending at the provider (shown as pending, never credited).
  for (let k = 0; k < 2; k++) {
    const p = passengers[k * 5 + 2];
    collections.push({ id: `col-pend-${k}`, purpose: 'wallet_funding', payerType: 'passenger', payerId: p.id, amount: naira(10000), fee: naira(150), provider: PROVIDER, reference: `GB-FUND-P${k}`, status: 'pending', createdAt: now - (k + 1) * 20 * 60_000, events: [] });
  }

  // ---------- Driver package purchases (company revenue) ----------
  // Purchases follow the stacking rule (D-058): a driver renews either a few hours before their access ends
  // (the new pass queues after it) or after a gap. Drivers listed with access end up covered now; others lapsed.
  let duplicateRef: string | null = null;
  activeDrivers.forEach((d, i) => {
    const wantsAccess = !!d.access;
    const plans: { at: number; monthly: boolean }[] = [];
    let at = now - int(12, 45) * DAY - int(0, 20) * HOUR;
    let end = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < 8 && at < now; k++) {
      const monthly = (k === 0 ? d.access?.packageId === 'monthly' : false) || r() < 0.25;
      const passEnd = Math.max(at + 30_000, end) + (monthly ? 30 : 1) * DAY;
      if (!wantsAccess && passEnd > now) break;
      plans.push({ at, monthly });
      end = passEnd;
      at = end + (r() < 0.45 ? -int(1, 6) * HOUR : int(1, 60) * HOUR);
    }
    if (wantsAccess && end <= now) plans.push({ at: now - int(1, 20) * HOUR, monthly: d.access!.packageId === 'monthly' });
    if (!plans.length) plans.push({ at: now - int(3, 30) * DAY, monthly: false });
    // One driver paid twice by mistake a few minutes apart; the second pass queues and is refunded below.
    if (wantsAccess && !duplicateRef) {
      const last = plans[plans.length - 1]!;
      plans.push({ at: last.at + 4 * 60_000, monthly: last.monthly });
      duplicateRef = `GB-PKG-${i}-${plans.length - 1}`;
    }
    plans.forEach(({ at, monthly }, k) => {
      const amount = naira(monthly ? 60000 : 2000);
      const reference = `GB-PKG-${i}-${k}`;
      collections.push({ id: `col-p-${i}-${k}`, purpose: 'package_purchase', payerType: 'driver', payerId: d.id, amount, fee: Math.round(amount * 0.015) as Kobo, provider: PROVIDER, reference, status: 'successful', createdAt: at, verifiedAt: at + 30_000, events: [{ at: at + 30_000, event: 'charge.success' }] });
      post(postJournal(ledger, { lines: [{ account: { kind: 'company_revenue' }, amount }, { account: { kind: 'provider_clearing', provider: PROVIDER }, amount: -amount as Kobo }], kind: 'package_purchase', description: `${monthly ? 'Monthly' : 'Daily'} access package`, by: { kind: 'provider', name: PROVIDER }, now: at, reference, provider: PROVIDER }));
      const fee = Math.round(amount * 0.015) as Kobo;
      post(postJournal(ledger, { lines: [{ account: { kind: 'processing_costs' }, amount: -fee as Kobo }, { account: { kind: 'provider_clearing', provider: PROVIDER }, amount: fee }], kind: 'processing_fee', description: 'Provider fee on package purchase', by: { kind: 'provider', name: PROVIDER }, now: at, reference: `${reference}-fee`, provider: PROVIDER }));
    });
  });

  // ---------- Trips ----------
  const trips: TripRecord[] = [];
  const statusPool: TripStatus[] = ['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'cancelled', 'no_driver', 'completed', 'completed'];
  for (let i = 0; i < 160; i++) {
    const passenger = pick(passengers);
    const city = passenger.city;
    const cityDrivers = activeDrivers.filter((d) => d.city === city);
    const driver = cityDrivers.length ? pick(cityDrivers) : undefined;
    const recent = i >= 148;
    const status: TripStatus = recent ? pick(['searching', 'matched', 'en_route', 'arrived', 'in_progress', 'payment_pending', 'in_progress'] as const) : pick(statusPool);
    const requestedAt = recent ? now - int(2, 40) * 60_000 : now - int(0, 30) * DAY - int(0, 23) * HOUR;
    const suggested = naira(Math.round((1200 + r() * 9000) / 50) * 50);
    const mode = r() < 0.3 ? 'negotiate' : 'quick_match';
    const agreed = mode === 'negotiate' ? (Math.round((suggested * (0.85 + r() * 0.3)) / 5000) * 5000) as Kobo : suggested;
    const method = r() < 0.6 ? 'wallet' : 'bank_transfer';
    const places = PLACES[city];
    const pickupPlace = pick(places);
    let dest = pick(places);
    if (dest === pickupPlace) dest = places[(places.indexOf(dest) + 1) % places.length];
    const tripId = id('trp', i);
    const t: TripRecord = {
      id: tripId,
      ref: `#${tripId.slice(-4)}${String.fromCharCode(65 + (i % 26))}${int(1, 9)}`,
      city,
      passengerId: passenger.id,
      driverId: status === 'searching' || status === 'no_driver' ? undefined : driver?.id,
      pickup: pickupPlace,
      destination: dest,
      requestedAt,
      status,
      mode,
      suggestedFare: suggested,
      agreedFare: status === 'searching' || status === 'no_driver' ? undefined : agreed,
      paymentMethod: method,
      payment: 'not_due',
      timeline: [{ at: requestedAt, label: 'Requested' }],
    };
    if (mode === 'negotiate') t.negotiation = negotiationFor(t, cityDrivers, seededRandom(9100 + i));
    if (t.driverId) t.timeline.push({ at: requestedAt + 40_000, label: 'Driver matched' });
    if (status === 'en_route' && r() < 0.6) t.pickupDelaySeconds = int(180, 900);
    if (status === 'no_driver') t.timeline.push({ at: requestedAt + 180_000, label: 'No driver found' });
    if (status === 'cancelled') {
      const by = r() < 0.6 ? 'passenger' : 'driver';
      t.cancellation = { by, reason: by === 'passenger' ? pick(['Driver too far', 'Changed plans', 'Found another ride']) : pick(['Passenger not at pickup', 'Vehicle problem']), fee: by === 'passenger' && r() < 0.3 ? naira(500) : (0 as Kobo) };
      t.timeline.push({ at: requestedAt + 300_000, label: `Cancelled by ${by}` });
    }
    if (status === 'payment_pending') {
      t.completedAt = now - int(1, 10) * 60_000;
      t.payment = r() < 0.5 ? 'pending' : 'processing';
      t.timeline.push({ at: t.completedAt, label: 'Trip completed' }, { at: t.completedAt + 5_000, label: t.payment === 'processing' ? 'Payment confirming' : 'Payment due' });
    }
    if (status === 'completed' && driver && t.agreedFare) {
      t.completedAt = requestedAt + int(15, 70) * 60_000;
      t.timeline.push({ at: requestedAt + 6 * 60_000, label: 'Driver arrived' }, { at: requestedAt + 9 * 60_000, label: 'Trip started' }, { at: t.completedAt, label: 'Trip completed' });
      if (method === 'wallet') {
        const ok = post(chargeTripFromWallet(ledger, { passengerId: passenger.id, driverId: driver.id, tripId, fare: t.agreedFare, now: t.completedAt + 20_000 }));
        t.payment = ok ? 'paid' : 'failed';
        if (!ok) t.paymentMethod = 'bank_transfer';
      }
      if (t.paymentMethod === 'bank_transfer') {
        // Bank transfer collected through the provider's collection account, then credited to earnings.
        // A direct transfer to the driver's own account is recorded only (never credited twice).
        t.directToDriver = r() < 0.25;
        t.payment = 'paid';
        if (!t.directToDriver) {
          const reference = `GB-TRIP-${tripId}`;
          collections.push({ id: `col-t-${i}`, purpose: 'trip_payment', payerType: 'passenger', payerId: passenger.id, amount: t.agreedFare, fee: 0 as Kobo, provider: PROVIDER, reference, status: 'successful', createdAt: t.completedAt + 60_000, verifiedAt: t.completedAt + 120_000, events: [{ at: t.completedAt + 120_000, event: 'charge.success' }] });
          post(postJournal(ledger, { lines: [{ account: { kind: 'driver_earnings', ownerId: driver.id }, amount: t.agreedFare }, { account: { kind: 'provider_clearing', provider: PROVIDER }, amount: -t.agreedFare as Kobo }], kind: 'driver_trip_earning', description: 'Trip paid by transfer (collection account)', by: { kind: 'provider', name: PROVIDER }, now: t.completedAt + 120_000, reference, provider: PROVIDER, links: { tripId } }));
        }
      }
      t.timeline.push({ at: t.completedAt + 120_000, label: t.directToDriver ? 'Paid directly to driver (recorded only)' : 'Payment confirmed' });
      passenger.trips += 1;
      passenger.lastTripAt = t.completedAt;
      driver.trips += 1;
    }
    trips.push(t);
  }

  // ---------- Withdrawals ----------
  const withdrawals: WithdrawalRecord[] = [];
  const wdStatuses = ['successful', 'successful', 'successful', 'processing', 'requested', 'under_review', 'failed', 'reversed', 'rejected'] as const;
  activeDrivers.filter((d) => d.bankAccount?.verified).slice(0, 16).forEach((d, i) => {
    const status = wdStatuses[i % wdStatuses.length];
    const bal = ledger.reduce((s, e) => (e.account.kind === 'driver_earnings' && e.account.ownerId === d.id ? s + e.amount : s), 0);
    const amount = (Math.floor((bal * (0.4 + r() * 0.5)) / 100_00) * 100_00) as Kobo;
    if (amount <= 0) return;
    const wid = id('wdr', i);
    const at = now - int(0, 9) * DAY - int(1, 20) * HOUR;
    const by: Actor = { kind: 'driver', id: d.id, name: d.name };
    if (!post(reserveWithdrawal(ledger, { driverId: d.id, withdrawalId: wid, amount, now: at, by }))) return;
    const history: WithdrawalRecord['history'] = [{ at, status: 'requested', by }];
    const fin = actor('stf-fin');
    const reference = `TRF_${wid.toUpperCase()}`;
    if (status !== 'requested') {
      if (status === 'under_review' || status === 'rejected' || amount >= naira(100_000)) history.push({ at: at + HOUR, status: 'under_review', by: fin, note: 'Above review threshold' });
    }
    if (status === 'rejected') {
      history.push({ at: at + 2 * HOUR, status: 'rejected', by: fin, note: 'Bank account name does not match driver' });
      post(releaseWithdrawal(ledger, { driverId: d.id, withdrawalId: wid, amount, now: at + 2 * HOUR, by: fin, reason: 'Rejected in review' }));
    }
    if (['processing', 'successful', 'failed', 'reversed'].includes(status)) history.push({ at: at + 3 * HOUR, status: 'processing', by: fin, note: 'Transfer submitted' });
    if (status === 'successful' || status === 'reversed') {
      history.push({ at: at + 3 * HOUR + 120_000, status: 'successful', by: { kind: 'provider', name: PROVIDER }, note: 'transfer.success' });
      post(settleWithdrawal(ledger, { driverId: d.id, withdrawalId: wid, amount, provider: PROVIDER, reference, now: at + 3 * HOUR + 120_000 }));
    }
    if (status === 'failed') {
      history.push({ at: at + 3 * HOUR + 180_000, status: 'failed', by: { kind: 'provider', name: PROVIDER }, note: 'transfer.failed: account could not be credited' });
      post(releaseWithdrawal(ledger, { driverId: d.id, withdrawalId: wid, amount, now: at + 3 * HOUR + 180_000, by: { kind: 'provider', name: PROVIDER }, reason: 'transfer.failed' }));
    }
    if (status === 'reversed') {
      history.push({ at: at + DAY, status: 'reversed', by: { kind: 'provider', name: PROVIDER }, note: 'transfer.reversed by receiving bank' });
      post(postJournal(ledger, { lines: [{ account: { kind: 'driver_earnings', ownerId: d.id }, amount }, { account: { kind: 'provider_clearing', provider: PROVIDER }, amount: -amount as Kobo }], kind: 'reversal', description: 'Payout reversed by bank: earnings returned', by: { kind: 'provider', name: PROVIDER }, now: at + DAY, reference: `${reference}-rev`, reason: 'transfer.reversed', links: { withdrawalId: wid } }));
    }
    withdrawals.push({ id: wid, driverId: d.id, amount, bankAccount: { bankName: d.bankAccount!.bankName, accountNumberMasked: d.bankAccount!.accountNumberMasked, accountName: d.bankAccount!.accountName }, status, requestedAt: at, provider: ['processing', 'successful', 'failed', 'reversed'].includes(status) ? PROVIDER : undefined, transferReference: ['processing', 'successful', 'failed', 'reversed'].includes(status) ? reference : undefined, history });
  });

  // ---------- Cases ----------
  const completed = trips.filter((t) => t.status === 'completed');
  const careSubjects: [CaseRecord['category'], string, CaseRecord['priority']][] = [
    ['payment', 'Charged but trip shows unpaid', 'high'],
    ['fare', 'Driver asked for more than agreed fare', 'high'],
    ['lost_item', 'Left a phone in the car', 'normal'],
    ['driver_conduct', 'Driver was rude at pickup', 'normal'],
    ['app_problem', 'Map would not load', 'low'],
    ['payment', 'Wallet top up not showing', 'high'],
    ['account', 'Cannot change phone number', 'low'],
    ['lost_item', 'Bag left in boot', 'normal'],
    ['passenger_conduct', 'Passenger damaged seat', 'normal'],
    ['fare', 'Cancellation fee disputed', 'normal'],
  ];
  const caseStatuses: CaseRecord['status'][] = ['new', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed'];
  const cases: CaseRecord[] = careSubjects.map(([category, subject, priority], i) => {
    const t = completed[i * 7];
    const p = passengers.find((x) => x.id === t.passengerId)!;
    const status = caseStatuses[i % caseStatuses.length];
    const openedAt = now - int(1, 72) * HOUR;
    const opener: Actor = category === 'passenger_conduct' ? { kind: 'driver', id: t.driverId!, name: drivers.find((d) => d.id === t.driverId)!.name } : { kind: 'passenger', id: p.id, name: p.name };
    return {
      id: id('cas', i),
      ref: `C-${2400 + i}`,
      team: 'care',
      category,
      priority,
      status,
      subject,
      ownerId: status === 'new' ? undefined : 'stf-care',
      openedAt,
      openedBy: opener,
      city: t.city,
      links: { passengerId: p.id, driverId: t.driverId, tripId: t.id },
      messages: [
        { id: `m-${i}-1`, at: openedAt, channel: 'customer', author: opener, body: subject + '. Please help.' },
        ...(status !== 'new' ? [{ id: `m-${i}-2`, at: openedAt + HOUR, channel: 'internal' as const, author: actor('stf-care'), body: 'Checked trip timeline and payment record.' }] : []),
        ...(status === 'waiting' || status === 'resolved' || status === 'closed' ? [{ id: `m-${i}-3`, at: openedAt + 2 * HOUR, channel: 'customer' as const, author: actor('stf-care'), body: 'Thanks for waiting. We are looking into this now.' }] : []),
      ],
      actions: status === 'new' ? [] : [{ at: openedAt + HOUR, by: actor('stf-care'), label: 'Assigned to Ruth Care' }, ...(status === 'escalated' ? [{ at: openedAt + 3 * HOUR, by: actor('stf-care'), label: 'Escalated to Finance' }] : [])],
      resolution: status === 'resolved' || status === 'closed' ? { at: openedAt + 5 * HOUR, summary: 'Explained the charge; no refund due.', followUpAt: status === 'resolved' ? now + DAY : undefined } : undefined,
    };
  });
  // Safety cases: own queue, restricted location data, escalation timeline.
  const safetyTrips = trips.filter((t) => t.status === 'in_progress' || t.status === 'completed').slice(0, 3);
  safetyTrips.forEach((t, i) => {
    const p = passengers.find((x) => x.id === t.passengerId)!;
    const openedAt = now - (i === 0 ? 6 * 60_000 : int(2, 30) * HOUR);
    const status: CaseRecord['status'] = i === 0 ? 'new' : i === 1 ? 'escalated' : 'resolved';
    cases.push({
      id: id('saf', i),
      ref: `S-${310 + i}`,
      team: 'safety',
      category: 'safety',
      priority: 'urgent',
      status,
      subject: i === 0 ? 'SOS pressed during trip' : i === 1 ? 'Driver went off route' : 'Passenger felt unsafe at drop off',
      ownerId: i === 0 ? undefined : 'stf-safety',
      openedAt,
      openedBy: { kind: 'passenger', id: p.id, name: p.name },
      city: t.city,
      links: { passengerId: p.id, driverId: t.driverId, tripId: t.id },
      messages: [{ id: `sm-${i}`, at: openedAt, channel: 'customer', author: { kind: 'system', name: 'Safety alert' }, body: 'Safety alert raised from the passenger app.' }],
      actions: [
        { at: openedAt, by: sys('Safety alert'), label: 'Case created from in-app alert; responders notified' },
        ...(i > 0 ? [{ at: openedAt + 4 * 60_000, by: actor('stf-safety'), label: 'Called passenger' }] : []),
        ...(i === 1 ? [{ at: openedAt + 15 * 60_000, by: actor('stf-safety'), label: 'Escalated to safety lead; driver restricted pending review' }] : []),
      ],
      resolution: i === 2 ? { at: openedAt + 2 * HOUR, summary: 'Passenger reached destination safely; driver coached.' } : undefined,
      safetyContext: { lastLocation: `${t.destination}, ${t.city === 'lagos' ? 'Lagos' : 'Abuja'} (approximate)`, sharedAt: openedAt, responders: ['Daniel Safety', 'Safety lead on call'] },
    });
  });

  // ---------- Refunds ----------
  const refunds: RefundRecord[] = [
    { id: 'ref-0001', tripId: cases[0].links.tripId, caseId: cases[0].id, passengerId: cases[0].links.passengerId!, amount: naira(1500), reason: 'Charged twice by provider (simulated)', destination: 'wallet', status: 'requested', requestedBy: actor('stf-care'), requestedAt: now - 3 * HOUR },
    { id: 'ref-0002', tripId: cases[5].links.tripId, caseId: cases[5].id, passengerId: cases[5].links.passengerId!, amount: naira(2000), reason: 'Driver did not complete trip', destination: 'wallet', status: 'completed', requestedBy: actor('stf-care'), approvedBy: actor('stf-fin'), requestedAt: now - 2 * DAY, providerResult: 'Credited to wallet' },
    { id: 'ref-0003', passengerId: passengers[3].id, amount: naira(5000), reason: 'Wallet funding failed but bank debited', destination: 'original_method', status: 'processing', requestedBy: actor('stf-care'), approvedBy: actor('stf-fin'), requestedAt: now - DAY },
  ];
  // The completed wallet refund is in the ledger (company absorbs it as a promotions/goodwill cost here).
  post(postJournal(ledger, { lines: [{ account: { kind: 'passenger_wallet', ownerId: refunds[1].passengerId }, amount: refunds[1].amount }, { account: { kind: 'promotions_expense' }, amount: -refunds[1].amount as Kobo }], kind: 'refund', description: 'Refund to wallet', by: actor('stf-fin'), now: now - 2 * DAY + HOUR, reference: 'refund:ref-0002', links: { refundId: 'ref-0002', caseId: cases[5].id } }));

  // Referral rewards (promotional spend).
  passengers.slice(0, 6).forEach((p, i) => post(postJournal(ledger, { lines: [{ account: { kind: 'passenger_wallet', ownerId: p.id }, amount: naira(500) }, { account: { kind: 'promotions_expense' }, amount: -naira(500) as Kobo }], kind: 'referral_reward', description: 'Referral reward', by: sys('referrals'), now: now - int(1, 20) * DAY, reference: `ref-reward-${i}` })));

  // ---------- Settlements (provider collected, fees, settled; difference vs ledger) ----------
  const settlements: SettlementRecord[] = [0, 1, 2, 3].map((w) => {
    const periodEnd = now - w * 7 * DAY;
    const periodStart = periodEnd - 7 * DAY;
    const inPeriod = collections.filter((c) => c.status === 'successful' && c.createdAt >= periodStart && c.createdAt < periodEnd);
    const collected = inPeriod.reduce((s, c) => s + c.amount, 0) as Kobo;
    const fees = inPeriod.reduce((s, c) => s + c.fee, 0) as Kobo;
    // One week is deliberately off by a small amount so the reconciliation view has something to explain.
    const ledgerTotal = (w === 1 ? collected - naira(1500) : collected) as Kobo;
    return { id: `stl-${w}`, provider: PROVIDER, periodStart, periodEnd, collected, fees, settled: (collected - fees) as Kobo, settledAt: w === 0 ? undefined : periodEnd + DAY, bankReference: w === 0 ? undefined : `STL-${periodEnd.toString(36).toUpperCase()}`, ledgerTotal };
  });

  // ---------- Integrations: prototype by default; nothing here is live ----------
  const integ = (x: Partial<IntegrationRecord> & Pick<IntegrationRecord, 'id' | 'area' | 'provider' | 'state' | 'owner'>): IntegrationRecord => ({ environment: 'test', capabilities: [], checks: [], failures: [], dependsOn: [], usedBy: [], ...x });
  const integrations: IntegrationRecord[] = [
    integ({ id: 'int-pay-test', area: 'payments', provider: 'Paystack', environment: 'test', state: 'tested', owner: 'Sani Developer', capabilities: ['Bank transfer collection', 'Dedicated virtual accounts', 'Transfers (payouts)', 'Refunds'], credentialHint: 'sk_test_••••7f2a', credentialRotatedAt: now - 20 * DAY, lastSuccessfulTestAt: now - 2 * HOUR, checks: [{ name: 'API key valid', passed: true, at: now - 2 * HOUR }, { name: 'Webhook URL reachable', passed: true, at: now - 2 * HOUR }, { name: 'Webhook signature verified', passed: true, at: now - 2 * HOUR }, { name: 'Test charge verified server side', passed: true, at: now - 2 * HOUR }, { name: 'Test transfer to test account', passed: true, at: now - 2 * HOUR }], failures: [{ at: now - 3 * DAY, message: 'Webhook signature mismatch (wrong secret). Fixed by rotating the secret.', resolved: true }], dependsOn: ['Database', 'Background jobs'], usedBy: ['Wallet funding', 'Trip payments', 'Driver packages', 'Withdrawals', 'Refunds'] }),
    integ({ id: 'int-pay-live', area: 'payments', provider: 'Paystack', environment: 'live', state: 'prototype', owner: 'Sani Developer', capabilities: ['Bank transfer collection', 'Transfers (payouts)'], checks: [{ name: 'Business verification complete', passed: false, detail: 'Waiting on owner (CAC documents)' }, { name: 'Settlement account confirmed', passed: false }, { name: 'Live webhook configured', passed: false }], usedBy: ['Wallet funding', 'Trip payments', 'Withdrawals'] }),
    integ({ id: 'int-email', area: 'email', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', usedBy: ['Receipts', 'Staff invites', 'Announcements'] }),
    integ({ id: 'int-sms', area: 'sms', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', usedBy: ['Phone sign in (OTP)', 'Announcements'], checks: [{ name: 'Sender ID approved', passed: false }] }),
    integ({ id: 'int-push', area: 'push', provider: 'Expo push (proposed)', state: 'configured', owner: 'Sani Developer', capabilities: ['iOS and Android push'], checks: [{ name: 'iOS credentials', passed: false }, { name: 'Android credentials', passed: true, at: now - 5 * DAY }], usedBy: ['Trip updates', 'Announcements'] }),
    integ({ id: 'int-maps', area: 'maps', provider: 'Google Maps Platform (proposed)', state: 'prototype', owner: 'Sani Developer', capabilities: ['Places search', 'Routes', 'Maps SDK'], usedBy: ['Search', 'Pricing', 'Live trip map'] }),
    integ({ id: 'int-auth', area: 'auth', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', capabilities: ['Phone and OTP sign in'], usedBy: ['Rider app', 'Driver app', 'Admin'] }),
    integ({ id: 'int-db', area: 'database', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', usedBy: ['Everything'] }),
    integ({ id: 'int-storage', area: 'storage', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', usedBy: ['Driver documents', 'Avatars', 'Receipts'] }),
    integ({ id: 'int-mon', area: 'monitoring', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', usedBy: ['Crash and error reports'] }),
    integ({ id: 'int-jobs', area: 'jobs', provider: 'Not chosen', state: 'prototype', owner: 'Sani Developer', usedBy: ['Scheduled announcements', 'Reconciliation', 'Package expiry'] }),
    integ({ id: 'int-idv', area: 'identity', provider: 'Not chosen (optional)', state: 'prototype', owner: 'Tobi Onboarding', usedBy: ['Driver verification'] }),
  ];

  // ---------- Configuration versions (effective dated, attributable) ----------
  const configVersions: ConfigVersion[] = [
    { id: 'cfg-fares-1', key: 'fares', version: 1, value: { base: 500, perKm: 180, perMin: 25, minimum: 1200 }, status: 'superseded', effectiveFrom: now - 60 * DAY, createdBy: actor('stf-admin'), createdAt: now - 61 * DAY, approvedBy: actor('stf-owner'), note: 'Launch fares (placeholder)' },
    { id: 'cfg-fares-2', key: 'fares', version: 2, value: { base: 500, perKm: 190, perMin: 25, minimum: 1200 }, status: 'active', effectiveFrom: now - 10 * DAY, createdBy: actor('stf-admin'), createdAt: now - 12 * DAY, approvedBy: actor('stf-owner'), note: 'Fuel price change' },
    { id: 'cfg-fares-3', key: 'fares', version: 3, value: { base: 500, perKm: 200, perMin: 28, minimum: 1300 }, status: 'pending_approval', effectiveFrom: now + 5 * DAY, createdBy: actor('stf-admin'), createdAt: now - 4 * HOUR, note: 'Proposed December rates' },
    { id: 'cfg-pkg-1', key: 'packages', version: 1, value: { daily: 2000, monthly: 60000 }, status: 'active', effectiveFrom: now - 60 * DAY, createdBy: actor('stf-admin'), createdAt: now - 61 * DAY, approvedBy: actor('stf-owner'), note: 'Confirmed prices: daily ₦2,000 for 24 hours, monthly ₦60,000 for 30 days (confirmed by the owner, 23 Oct 2026)' },
    { id: 'cfg-ref-1', key: 'referrals', version: 1, value: { reward: 500, maxRewarded: 10, qualifying: 'first paid trip' }, status: 'active', effectiveFrom: now - 40 * DAY, createdBy: actor('stf-mkt'), createdAt: now - 41 * DAY, approvedBy: actor('stf-owner'), note: 'Referral launch' },
    { id: 'cfg-cat-1', key: 'categories', version: 1, value: { enabled: ['GoBye Car'] }, status: 'active', effectiveFrom: now - 60 * DAY, createdBy: actor('stf-admin'), createdAt: now - 61 * DAY, approvedBy: actor('stf-owner'), note: 'One car category at launch' },
    { id: 'cfg-can-1', key: 'cancellation', version: 1, value: { freeMinutes: 2, fee: 500, waitingFreeMinutes: 5 }, status: 'active', effectiveFrom: now - 60 * DAY, createdBy: actor('stf-admin'), createdAt: now - 61 * DAY, approvedBy: actor('stf-owner'), note: 'Launch rules' },
    { id: 'cfg-area-1', key: 'service_areas', version: 1, value: { cities: ['Lagos', 'Abuja'] }, status: 'active', effectiveFrom: now - 60 * DAY, createdBy: actor('stf-admin'), createdAt: now - 61 * DAY, approvedBy: actor('stf-owner'), note: 'Lagos and Abuja' },
  ];

  // ---------- Growth ----------
  const campaigns: PromoCampaign[] = [
    { id: 'referral', title: 'Earn ₦500 per friend', body: 'When a friend takes their first paid trip.', art: 'gift', ctaLabel: 'Invite friends', ctaRoute: '/account/rewards', placements: ['home', 'wallet'], audience: { type: 'passenger', cities: ['lagos', 'abuja'] }, startsAt: now - 40 * DAY, sortOrder: 1, status: 'active', budget: naira(500_000), spent: naira(3000), impressions: 18420, opens: 912 },
    { id: 'wallet-topup', title: 'Pay in one tap', body: 'Add money to your wallet before your ride.', art: 'wallet', ctaLabel: 'Add money', ctaRoute: '/(tabs)/wallet?add=1', placements: ['home', 'wallet'], audience: { type: 'passenger', cities: ['lagos', 'abuja'] }, startsAt: now - 20 * DAY, sortOrder: 2, status: 'active', spent: 0 as Kobo, impressions: 15100, opens: 640 },
    { id: 'book-for-others', title: 'Book for someone else', body: 'Send a ride to family or friends.', art: 'sedan', ctaLabel: 'Book a ride', ctaRoute: '/(tabs)', placements: ['home'], audience: { type: 'passenger', cities: ['lagos'] }, startsAt: now - 10 * DAY, sortOrder: 3, status: 'active', spent: 0 as Kobo, impressions: 9200, opens: 210 },
    { id: 'detty-december', title: 'Rides to the concert', body: 'Pickup zones at the venue gates.', art: 'destination', ctaLabel: 'See pickup zones', ctaRoute: '/(tabs)', placements: ['home'], audience: { type: 'passenger', cities: ['lagos'], eventId: 'evt-0001' }, startsAt: now + 30 * DAY, endsAt: now + 33 * DAY, sortOrder: 4, status: 'draft', spent: 0 as Kobo, impressions: 0, opens: 0 },
  ];
  const zero = { attempted: 0, delivered: 0, failed: 0 };
  const announcements: Announcement[] = [
    { id: 'ann-0001', title: 'Welcome to GoBye', body: 'Ride at the suggested fare, or offer your own.', audience: { type: 'passenger', cities: ['lagos', 'abuja'] }, channels: ['inbox'], status: 'sent', createdBy: actor('stf-mkt'), approvedBy: actor('stf-owner'), sentVersion: { title: 'Welcome to GoBye', body: 'Ride at the suggested fare, or offer your own.', at: now - 30 * DAY }, audienceSize: 48, delivery: { inbox: { attempted: 48, delivered: 48, failed: 0 }, push: zero, email: zero, sms: zero } },
    { id: 'ann-0002', title: 'Daily pass price', body: 'Daily access stays ₦2,000 this month.', audience: { type: 'driver', cities: ['lagos', 'abuja'], statuses: ['approved'] }, channels: ['inbox', 'push', 'sms'], status: 'partly_failed', createdBy: actor('stf-mkt'), approvedBy: actor('stf-owner'), sentVersion: { title: 'Daily pass price', body: 'Daily access stays ₦2,000 this month.', at: now - 2 * DAY }, audienceSize: 22, delivery: { inbox: { attempted: 22, delivered: 22, failed: 0 }, push: { attempted: 22, delivered: 19, failed: 3 }, sms: { attempted: 22, delivered: 0, failed: 22 }, email: zero } },
    { id: 'ann-0003', title: 'Abuja airport pickups', body: 'Meet your driver at the Arrivals car park.', audience: { type: 'passenger', cities: ['abuja'] }, channels: ['inbox', 'push'], status: 'pending_approval', scheduledFor: now + DAY, createdBy: actor('stf-mkt'), audienceSize: 17, delivery: { inbox: zero, push: zero, email: zero, sms: zero } },
    { id: 'ann-0004', title: 'New: share your trip', body: 'Send your live trip to a friend.', audience: { type: 'passenger', cities: ['lagos'] }, channels: ['inbox'], status: 'draft', createdBy: actor('stf-mkt'), audienceSize: 31, delivery: { inbox: zero, push: zero, email: zero, sms: zero } },
  ];
  const events: EventPartnership[] = [
    { id: 'evt-0001', name: 'Lagos December concert', partner: 'Example Promotions Ltd', venue: 'Eko Atlantic (example venue)', city: 'lagos', startsAt: now + 30 * DAY, endsAt: now + 31 * DAY, pickupZones: ['Gate A', 'Gate C', 'Car park 2'], sponsorship: naira(250_000), status: 'planned', bookings: 0 },
    { id: 'evt-0002', name: 'Abuja tech summit', partner: 'Example Events', venue: 'Central Business District (example venue)', city: 'abuja', startsAt: now - 5 * DAY, endsAt: now - 4 * DAY, pickupZones: ['Main entrance'], status: 'ended', bookings: 64 },
  ];

  // ---------- Approvals waiting ----------
  const pendingWd = withdrawals.find((w) => w.status === 'under_review');
  const approvals: ApprovalRequest[] = [
    { id: 'apr-0001', kind: 'config_publish', title: 'Publish fares v3 (effective in 5 days)', requestedBy: actor('stf-admin'), requestedAt: now - 4 * HOUR, target: { type: 'config', id: 'cfg-fares-3', label: 'Fares v3' }, status: 'pending', approverRoles: ['owner'] },
    { id: 'apr-0002', kind: 'refund', title: 'Refund ₦1,500 to wallet', requestedBy: actor('stf-care'), requestedAt: now - 3 * HOUR, target: { type: 'refund', id: 'ref-0001', label: 'Refund ref-0001' }, amount: naira(1500), status: 'pending', approverRoles: ['finance', 'owner'] },
    { id: 'apr-0003', kind: 'announcement', title: 'Send "Abuja airport pickups" to 17 passengers', requestedBy: actor('stf-mkt'), requestedAt: now - 6 * HOUR, target: { type: 'announcement', id: 'ann-0003', label: 'Abuja airport pickups' }, status: 'pending', approverRoles: ['owner', 'admin'] },
    { id: 'apr-0004', kind: 'payments_activation', title: 'Switch Paystack to live', requestedBy: actor('stf-dev'), requestedAt: now - DAY, target: { type: 'integration', id: 'int-pay-live', label: 'Paystack (live)' }, status: 'pending', approverRoles: ['owner'], note: 'Blocked until live checks pass' },
    ...(pendingWd ? [{ id: 'apr-0005', kind: 'withdrawal' as const, title: 'Review driver withdrawal', requestedBy: { kind: 'driver' as const, id: pendingWd.driverId, name: drivers.find((d) => d.id === pendingWd.driverId)!.name }, requestedAt: pendingWd.requestedAt, target: { type: 'withdrawal' as const, id: pendingWd.id, label: `Withdrawal ${pendingWd.id}` }, amount: pendingWd.amount, status: 'pending' as const, approverRoles: ['finance' as const] }] : []),
  ];

  // ---------- Audit trail ----------
  const audit: AuditEvent[] = [
    { id: 'aud-1', at: now - 10 * DAY, actor: actor('stf-owner'), action: 'config.published', target: { type: 'config', id: 'cfg-fares-2', label: 'Fares v2' }, summary: 'Published fares v2', diff: [{ field: 'Per km', from: '₦180', to: '₦190' }], reason: 'Fuel price change' },
    { id: 'aud-2', at: now - 3 * DAY, actor: actor('stf-dev'), action: 'integration.credential_rotated', target: { type: 'integration', id: 'int-pay-test', label: 'Paystack (test)' }, summary: 'Rotated test secret key', diff: [{ field: 'Secret key', from: '••••91c0', to: '••••7f2a' }] },
    { id: 'aud-3', at: now - 2 * DAY, actor: actor('stf-fin'), action: 'refund.approved', target: { type: 'refund', id: 'ref-0002', label: 'Refund ref-0002' }, summary: 'Approved ₦2,000 refund to wallet' },
    { id: 'aud-4', at: now - 2 * DAY, actor: actor('stf-owner'), action: 'announcement.approved', target: { type: 'announcement', id: 'ann-0002', label: 'Daily pass price' }, summary: 'Approved driver announcement' },
    { id: 'aud-5', at: now - DAY, actor: actor('stf-onb'), action: 'driver.rejected', target: { type: 'driver', id: drivers.find((d) => d.verification === 'rejected')?.id ?? 'drv-0001', label: 'Driver application' }, summary: 'Rejected application', reason: 'Licence photo unreadable' },
    { id: 'aud-6', at: now - 5 * HOUR, actor: actor('stf-owner'), action: 'staff.invited', target: { type: 'staff', id: 'stf-new', label: 'Pending Invite' }, summary: 'Invited new care agent (Lagos)' },
  ];

  // ---------- Driver pass timelines (D-058): built from verified package payments by the shared calculation ----------
  const subscriptions: SubscriptionState[] = [];
  for (const d of drivers) {
    let st = emptySubscriptionState(d.id);
    for (const c of collections.filter((x) => x.purpose === 'package_purchase' && x.payerId === d.id && x.status === 'successful' && x.verifiedAt)) {
      const plan = planForAmount(c.amount);
      if (!plan) continue;
      const r = recordPassPayment(st, { paymentRef: c.reference, driverId: d.id, plan, amount: c.amount, confirmedAt: c.verifiedAt! });
      if (r.ok) st = r.state;
    }
    subscriptions.push(st);
  }
  // One honest example of a refund: the duplicate purchase above, refunded before it started.
  {
    const st = subscriptions.find((s) => s.passes.some((p) => p.paymentRef === duplicateRef));
    const queued = st?.passes.find((p) => p.paymentRef === duplicateRef);
    if (st && queued) {
      const r = voidPass(st, { paymentRef: queued.paymentRef, kind: 'refunded', at: now - 2 * HOUR, reason: 'Bought twice by mistake; refunded to the driver', by: 'Grace Finance' });
      if (r.ok) subscriptions[subscriptions.indexOf(st)] = r.state;
    }
  }
  // Driver records show the timeline's answer, never a separate calculation.
  for (const d of drivers) {
    const tl = subscriptionTimelineResponse(subscriptions.find((s) => s.driverId === d.id)!, now);
    const last = tl.passes.find((p) => p.accessEndsAt > p.startsAt);
    d.access = tl.access.active ? { packageId: tl.access.currentPlan!, expiresAt: tl.access.activeUntil! } : last ? { packageId: last.plan, expiresAt: last.accessEndsAt } : null;
    if (!tl.access.active) d.online = false;
  }

  const feeSchedules = simulatedFeeSchedules(now, { id: 'stf-fin', name: 'Grace Finance' });
  const automationRuns = simulatedAutomationRuns({ collections, withdrawals, drivers, cases }, now);
  const automationChanges = simulatedSettingChanges(now, { mkt: { id: 'stf-mkt', name: 'Lola Marketing' }, owner: { id: 'stf-owner', name: 'Akorede (Owner)' }, care: { id: 'stf-care', name: 'Ruth Care' } });
  approvals.push({ id: 'apr-0006', kind: 'automation_config', title: 'Daily package reminder: 2 → 3 hours before', requestedBy: actor('stf-mkt'), requestedAt: now - 5 * HOUR, target: { type: 'automation', id: 'subscription.reminder', label: 'Package renewal reminders' }, status: 'pending', approverRoles: ['owner', 'admin'], note: 'asc-0001' });

  return { generatedAt: now, staff, passengers, drivers, trips, cases, ledger, collections, withdrawals, refunds, settlements, integrations, configVersions, campaigns, announcements, approvals, events, audit, feeSchedules, automationRuns, automationChanges, vendors: seedVendors(), expenses: [], budgets: [], subscriptions };
}
