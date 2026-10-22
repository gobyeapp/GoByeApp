import {
  canDrive,
  draftStatus,
  emptyApplication,
  nextOnboardingStep,
  onboardingProgress,
  submitApplication,
  validateAccountNumber,
  validateExpiry,
  validateIdentityNumber,
  validateLicenceNumber,
  validatePlate,
  validateVehicleYear,
  type DriverApplication,
} from '../driver/onboarding';
import {
  MAX_PIN_ATTEMPTS,
  REQUEST_TTL_SECONDS,
  cancelTrip,
  completeTrip,
  confirmPinAndStart,
  counterSuggestions,
  isRequestOpen,
  makeMockRequest,
  markArrived,
  mockPickupPin,
  mockTripHistory,
  noShowAvailableAt,
  startTripFromRequest,
  summariseEarnings,
  validateCounter,
  weeklyBreakdown,
} from '../driver/trips';
import { LAGOS_DEFAULT_LOCATION } from '../mocks/data';
import { kobo, naira } from '../money';
import { MOCK_PRICING_CONFIG } from '../pricing/config';

const NOW = Date.UTC(2026, 9, 22, 10, 0, 0);

const complete: DriverApplication = {
  status: 'in_progress',
  personal: { firstName: 'Musa', lastName: 'Bello', city: 'Lagos' },
  licence: { number: 'ABC12345AA12', expiry: '2028-01-31', photoUri: 'file://l.jpg' },
  identity: { type: 'nin', number: '12345678901', selfieUri: 'file://s.jpg' },
  vehicle: { category: 'go', make: 'Toyota', model: 'Corolla', year: 2015, colour: 'Silver', plate: 'KJA 123 AB' },
  documents: { registration: 'file://r.jpg', insurance: 'file://i.jpg', roadworthiness: 'file://w.jpg' },
};

describe('driver onboarding rules', () => {
  it('validates licence numbers, normalising case and spaces', () => {
    expect(validateLicenceNumber('abc 12345aa12')).toEqual({ ok: true, value: 'ABC12345AA12' });
    expect(validateLicenceNumber('12345').ok).toBe(false);
    expect(validateLicenceNumber('').ok).toBe(false);
  });

  it('accepts only real future expiry dates', () => {
    expect(validateExpiry('2027-02-28', NOW).ok).toBe(true);
    expect(validateExpiry('2027-02-30', NOW).ok).toBe(false);
    expect(validateExpiry('2026-10-22', NOW).ok).toBe(false); // expires today
    expect(validateExpiry('2025-01-01', NOW).ok).toBe(false);
    expect(validateExpiry('31/01/2028', NOW).ok).toBe(false);
  });

  it('checks identity number formats per document type', () => {
    expect(validateIdentityNumber('nin', '123 4567 8901').ok).toBe(true);
    expect(validateIdentityNumber('nin', '1234').ok).toBe(false);
    expect(validateIdentityNumber('passport', 'a12345678')).toEqual({ ok: true, value: 'A12345678' });
    expect(validateIdentityNumber('voters_card', '90F5B1234567890123A').ok).toBe(true);
  });

  it('normalises Nigerian plates and rejects other shapes', () => {
    expect(validatePlate('kja123ab')).toEqual({ ok: true, value: 'KJA 123 AB' });
    expect(validatePlate('KJA-123-AB')).toEqual({ ok: true, value: 'KJA 123 AB' });
    expect(validatePlate('AB 12 C').ok).toBe(false);
  });

  it('limits vehicle age', () => {
    expect(validateVehicleYear('2015', NOW)).toEqual({ ok: true, value: 2015 });
    expect(validateVehicleYear('2001', NOW).ok).toBe(false);
    expect(validateVehicleYear('2030', NOW).ok).toBe(false);
    expect(validateVehicleYear('15', NOW).ok).toBe(false);
  });

  it('walks the steps in order and only submits a complete application', () => {
    expect(nextOnboardingStep(emptyApplication)).toBe('personal');
    expect(draftStatus(emptyApplication)).toBe('not_started');
    const partial = { ...complete, documents: { registration: 'x' } };
    expect(nextOnboardingStep(partial)).toBe('documents');
    expect(draftStatus(partial)).toBe('in_progress');
    expect(onboardingProgress(partial)).toEqual({ done: 4, total: 5 });
    expect(submitApplication(partial, NOW).ok).toBe(false);
    const r = submitApplication(complete, NOW);
    expect(r.ok && r.value.status).toBe('pending_review');
    expect(r.ok && submitApplication(r.value, NOW).ok).toBe(false);
  });

  it('checks 10 digit account numbers', () => {
    expect(validateAccountNumber('012 345 6789')).toEqual({ ok: true, value: '0123456789' });
    expect(validateAccountNumber('12345').ok).toBe(false);
  });

  it('only approved drivers can drive', () => {
    expect(canDrive(complete)).toBe(false);
    expect(canDrive({ ...complete, status: 'approved' })).toBe(true);
    expect(canDrive({ ...complete, status: 'rejected' })).toBe(false);
  });
});

describe('driver requests and counteroffers', () => {
  const req = makeMockRequest(42, LAGOS_DEFAULT_LOCATION, NOW, 'go', 'negotiate');

  it('builds reproducible simulated requests that expire', () => {
    expect(makeMockRequest(42, LAGOS_DEFAULT_LOCATION, NOW, 'go', 'negotiate')).toEqual(req);
    expect(req.isSimulated).toBe(true);
    expect(isRequestOpen(req, NOW + (REQUEST_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(isRequestOpen(req, NOW + REQUEST_TTL_SECONDS * 1000)).toBe(false);
    expect(req.amount).toBeLessThanOrEqual(req.maxCounter);
  });

  it('suggests counters above the offer, on the step, within the maximum', () => {
    const s = counterSuggestions(req);
    expect(s.length).toBeGreaterThan(0);
    for (const a of s) {
      expect(a).toBeGreaterThan(req.amount);
      expect(a).toBeLessThanOrEqual(req.maxCounter);
      expect(a % MOCK_PRICING_CONFIG.negotiation.stepKobo).toBe(0);
    }
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });

  it('rejects counters at or below the offer and above the maximum', () => {
    expect(validateCounter(req.amount, req).ok).toBe(false);
    expect(validateCounter(kobo(req.maxCounter + 100), req).ok).toBe(false);
    expect(validateCounter(kobo(req.amount + naira(50)), req).ok).toBe(req.amount + naira(50) <= req.maxCounter);
  });
});

describe('driver trip stages and pickup PIN', () => {
  const req = makeMockRequest(7, LAGOS_DEFAULT_LOCATION, NOW, 'go', 'quick_match');
  const trip = startTripFromRequest(req, req.amount, NOW, '4821');

  it('goes to pickup → arrived → PIN → in progress → completed with payment pending', () => {
    expect(trip.stage).toBe('to_pickup');
    expect(confirmPinAndStart(trip, '4821', NOW).ok).toBe(false); // must arrive first
    const arrived = markArrived(trip, NOW + 60_000);
    if (!arrived.ok) throw new Error('arrive');
    const started = confirmPinAndStart(arrived.value, '4821', NOW + 90_000);
    if (!started.ok) throw new Error('start');
    expect(started.value.stage).toBe('in_progress');
    const done = completeTrip(started.value, NOW + 900_000);
    expect(done.ok && done.value.paymentStatus).toBe('pending');
  });

  it('locks after too many wrong PINs', () => {
    const arrived = markArrived(trip, NOW);
    if (!arrived.ok) throw new Error('arrive');
    let t = arrived.value;
    for (let i = 1; i <= MAX_PIN_ATTEMPTS; i++) {
      const r = confirmPinAndStart(t, '0000', NOW);
      if (r.ok) throw new Error('should fail');
      t = r.error.trip;
      expect(r.error.error).toBe(i < MAX_PIN_ATTEMPTS ? 'pin_wrong' : 'pin_locked');
    }
    const after = confirmPinAndStart(t, '4821', NOW);
    expect(!after.ok && after.error.error).toBe('pin_locked');
  });

  it('asks for all 4 digits without spending an attempt', () => {
    const arrived = markArrived(trip, NOW);
    if (!arrived.ok) throw new Error('arrive');
    const r = confirmPinAndStart(arrived.value, '48', NOW);
    expect(!r.ok && r.error.error).toBe('pin_required');
    expect(!r.ok && r.error.trip.pinAttempts).toBe(0);
  });

  it('allows a no show only after the waiting time', () => {
    const arrived = markArrived(trip, NOW);
    if (!arrived.ok) throw new Error('arrive');
    const at = noShowAvailableAt(arrived.value)!;
    expect(at).toBe(NOW + MOCK_PRICING_CONFIG.cancellation.waitSeconds * 1000);
    expect(cancelTrip(arrived.value, 'rider_no_show', at - 1).ok).toBe(false);
    expect(cancelTrip(arrived.value, 'rider_no_show', at).ok).toBe(true);
    expect(cancelTrip(trip, 'driver_cancelled', NOW).ok).toBe(true);
  });

  it('gives the same 4 digit pin for the same seed', () => {
    expect(mockPickupPin(3)).toMatch(/^\d{4}$/);
    expect(mockPickupPin(3)).toBe(mockPickupPin(3));
  });
});

describe('driver earnings (0% commission)', () => {
  const history = mockTripHistory(NOW);

  it('sums completed trips only and keeps the full fare', () => {
    const s = summariseEarnings(history, 0);
    const completed = history.filter((t) => t.stage === 'completed');
    expect(s.trips).toBe(completed.length);
    expect(s.total).toBe(completed.reduce((a, t) => a + t.fare, 0));
    expect(s.byMethod.wallet + s.byMethod.bank_transfer + s.byMethod.cash).toBe(s.total);
    expect(s.pending).toBe(0);
  });

  it('counts unconfirmed payments as pending', () => {
    const t = { ...history.find((h) => h.stage === 'completed')!, paymentStatus: 'pending' as const };
    expect(summariseEarnings([t], 0).pending).toBe(t.fare);
  });

  it('splits the week into 7 days that add up to the week total', () => {
    const week = weeklyBreakdown(history, NOW);
    expect(week).toHaveLength(7);
    expect(week[0].day).toBe('Mon');
  });
});
