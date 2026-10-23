import {
  canReceiveRequests,
  driverLocationReducer,
  initialDriverLocationState,
  isStale,
  shouldTrack,
  trackingIssues,
  updateProfileFor,
  UPDATE_PROFILES,
  type DriverLocationState,
} from '../driver/locationSession';
import { kobo, naira } from '../money';
import {
  DRIVER_ACCESS_PACKAGES,
  MOCK_PAYMENTS_CONFIG,
  enabledMethods,
  hasActiveAccess,
  paymentCharge,
  processingFee,
  subscribe,
  walletCovers,
} from '../payments';
import { MOCK_PRICING_CONFIG } from '../pricing/config';
import { driverEarnings } from '../pricing/fare';
import { MOCK_PAYMENT_METHODS } from '../mocks/data';

describe('payments (Q-001, Q-002)', () => {
  it('offers wallet and bank transfer at launch; cash stays disabled until decided', () => {
    expect(enabledMethods(MOCK_PAYMENT_METHODS).map((m) => m.type)).toEqual(['wallet', 'bank_transfer']);
    expect(MOCK_PAYMENTS_CONFIG.enabledMethods.cash).toBe(false);
  });

  it('charges 0% commission — the driver earns the full fare', () => {
    expect(driverEarnings(naira(3050), MOCK_PRICING_CONFIG)).toEqual({ commission: 0, earnings: naira(3050) });
  });

  it('keeps processing fees separate from the fare', () => {
    // Bank transfers go to the driver directly: GoBye adds no fee.
    expect(paymentCharge(naira(3050), 'bank_transfer')).toEqual({ fare: naira(3050), processingFee: 0, total: naira(3050) });
    const withFee = { ...MOCK_PAYMENTS_CONFIG, processingFees: { ...MOCK_PAYMENTS_CONFIG.processingFees, bank_transfer: { fixed: naira(50), percent: 0, bearer: 'passenger' as const } } };
    const transfer = paymentCharge(naira(3050), 'bank_transfer', withFee);
    expect(transfer.fare).toBe(naira(3050));
    expect(transfer.processingFee).toBe(naira(50));
    expect(transfer.total).toBe(naira(3100));
    const wallet = paymentCharge(naira(3050), 'wallet');
    expect(wallet).toEqual({ fare: naira(3050), processingFee: 0, total: naira(3050) });
  });

  it('applies percentage, cap and bearer rules', () => {
    const config = {
      ...MOCK_PAYMENTS_CONFIG,
      processingFees: {
        ...MOCK_PAYMENTS_CONFIG.processingFees,
        bank_transfer: { fixed: naira(10), percent: 0.015, cap: naira(40), bearer: 'passenger' as const },
        wallet: { fixed: naira(25), percent: 0, bearer: 'platform' as const },
      },
    };
    expect(processingFee(naira(1000), 'bank_transfer', config)).toBe(naira(25)); // 10 + 15
    expect(processingFee(naira(5000), 'bank_transfer', config)).toBe(naira(40)); // capped
    expect(paymentCharge(naira(1000), 'wallet', config).processingFee).toBe(0); // platform-borne → not added
  });

  it('checks the wallet covers the full charge', () => {
    expect(walletCovers(naira(3050), paymentCharge(naira(3050), 'wallet'))).toBe(true);
    expect(walletCovers(naira(3000), paymentCharge(naira(3050), 'wallet'))).toBe(false);
  });

  it('uses the confirmed driver packages: ₦2,000 for 24 hours, ₦60,000 for 30 days', () => {
    expect(DRIVER_ACCESS_PACKAGES.map((p) => [p.id, p.price, p.durationDays, p.provisional])).toEqual([
      ['daily', naira(2000), 1, false],
      ['monthly', naira(60000), 30, false],
    ]);
  });

  it('activates, expires and extends access packages', () => {
    const daily = DRIVER_ACCESS_PACKAGES[0];
    const day = 86_400_000;
    const sub = subscribe(daily, 0);
    expect(hasActiveAccess(sub, day - 1)).toBe(true);
    expect(hasActiveAccess(sub, day)).toBe(false);
    const extended = subscribe(daily, day / 2, sub);
    expect(extended.startsAt).toBe(day);
    expect(extended.expiresAt).toBe(2 * day);
    expect(hasActiveAccess(null, 0)).toBe(false);
    expect(kobo(0)).toBe(0);
  });
});

describe('driver location session (Q-012)', () => {
  const precise: DriverLocationState = { ...initialDriverLocationState, permission: 'when_in_use_precise', backgroundCapable: true };
  const fix = (at: number, accuracyMeters = 10) => ({ latitude: 9.06, longitude: 7.49, accuracyMeters, at });

  it('does not track while offline with no trip', () => {
    expect(shouldTrack(precise)).toBe(false);
    expect(updateProfileFor('offline')).toBeNull();
  });

  it('starts a session only when the driver explicitly goes online with When In Use + precise + access', () => {
    expect(driverLocationReducer(initialDriverLocationState, { type: 'GO_ONLINE', now: 0, hasAccess: true }).error).toBe('permission_required');
    expect(driverLocationReducer({ ...precise, permission: 'when_in_use_approximate' }, { type: 'GO_ONLINE', now: 0, hasAccess: true }).error).toBe('precise_required');
    expect(driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: false }).error).toBe('no_access_package');
    const r = driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: true });
    expect(r.error).toBeUndefined();
    expect(r.state.sessionActive).toBe(true);
    expect(r.state.activity).toBe('available');
  });

  it('does not require Always permission', () => {
    const online = driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: true }).state;
    const withFix = driverLocationReducer(online, { type: 'FIX', fix: fix(1000) }).state;
    expect(canReceiveRequests(withFix, 2000).ok).toBe(true);
  });

  it('adapts update frequency to activity', () => {
    expect(updateProfileFor('to_pickup')!.intervalMs).toBeLessThan(updateProfileFor('available')!.intervalMs);
    expect(updateProfileFor('on_trip')).toEqual(UPDATE_PROFILES.on_trip);
  });

  it('keeps tracking through pickup and trip, and blocks going offline mid-trip', () => {
    let s = driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: true }).state;
    s = driverLocationReducer(s, { type: 'TRIP_ASSIGNED' }).state;
    expect(s.activity).toBe('to_pickup');
    expect(driverLocationReducer(s, { type: 'GO_OFFLINE' }).error).toBe('finish_trip_first');
    s = driverLocationReducer(s, { type: 'PASSENGER_PICKED_UP' }).state;
    expect(shouldTrack(s)).toBe(true);
    s = driverLocationReducer(s, { type: 'TRIP_ENDED' }).state;
    expect(s.activity).toBe('available');
    s = driverLocationReducer(s, { type: 'GO_OFFLINE' }).state;
    expect(s.sessionActive).toBe(false);
    expect(shouldTrack(s)).toBe(false);
  });

  it('flags stale positions and pauses matching', () => {
    let s = driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: true }).state;
    s = driverLocationReducer(s, { type: 'FIX', fix: fix(1000) }).state;
    const staleAt = 1000 + UPDATE_PROFILES.available.staleAfterMs + 1;
    expect(isStale(s, staleAt)).toBe(true);
    expect(canReceiveRequests(s, staleAt)).toEqual({ ok: false, issues: ['stale_position'] });
  });

  it('pauses matching when permission is lost or the session is interrupted', () => {
    let s = driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: true }).state;
    s = driverLocationReducer(s, { type: 'FIX', fix: fix(500) }).state;
    const lost = driverLocationReducer(s, { type: 'PERMISSION_CHANGED', permission: 'denied', backgroundCapable: false }).state;
    expect(lost.interrupted).toBe(true);
    expect(canReceiveRequests(lost, 1000).issues).toEqual(expect.arrayContaining(['permission_missing', 'session_interrupted']));
    const interrupted = driverLocationReducer(s, { type: 'SESSION_INTERRUPTED' }).state;
    expect(canReceiveRequests(interrupted, 1000).ok).toBe(false);
    const resumed = driverLocationReducer(interrupted, { type: 'FIX', fix: fix(1100) }).state;
    expect(canReceiveRequests(resumed, 1200).ok).toBe(true);
  });

  it('flags low GPS accuracy', () => {
    let s = driverLocationReducer(precise, { type: 'GO_ONLINE', now: 0, hasAccess: true }).state;
    s = driverLocationReducer(s, { type: 'FIX', fix: fix(500, 250) }).state;
    expect(trackingIssues(s, 600)).toContain('low_accuracy');
  });
});
