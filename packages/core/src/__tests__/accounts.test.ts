import { consentsNeeded, CURRENT_CONSENTS, deletionDueAt, isNigerianPhone, toE164 } from '../accounts';

describe('account rules (Backend Phase 2)', () => {
  it('normalises phone numbers to E.164', () => {
    expect(toE164('0803 123 4567')).toBe('+2348031234567');
    expect(toE164('2348031234567')).toBe('+2348031234567');
    expect(toE164('+234 803-123-4567')).toBe('+2348031234567');
    expect(toE164('')).toBeNull();
  });
  it('accepts Nigerian mobile numbers only', () => {
    expect(isNigerianPhone(toE164('0803 123 4567'))).toBe(true);
    expect(isNigerianPhone('+2349011234567')).toBe(true);
    expect(isNigerianPhone('+447700900000')).toBe(false);
    expect(isNigerianPhone('+2346031234567')).toBe(false);
    expect(isNigerianPhone(null)).toBe(false);
  });
  it('asks for consents that are missing or out of date', () => {
    expect(consentsNeeded([]).map((c) => c.document).sort()).toEqual(['privacy', 'terms']);
    expect(consentsNeeded([{ document: 'terms', version: CURRENT_CONSENTS.terms }, { document: 'privacy', version: 'old' }])).toEqual([{ document: 'privacy', version: CURRENT_CONSENTS.privacy }]);
  });
  it('removes data 14 days after the request', () => {
    expect(deletionDueAt(0)).toBe(14 * 86_400_000);
  });
});
