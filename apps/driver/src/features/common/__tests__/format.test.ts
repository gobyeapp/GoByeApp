import { formatRemaining, passName } from '../format';

describe('driver formatting', () => {
  it('describes time left on an access pass', () => {
    expect(formatRemaining(42 * 60_000)).toBe('42 min');
    expect(formatRemaining(13 * 3_600_000 + 20 * 60_000)).toBe('13 h 20 min');
    expect(formatRemaining(24 * 3_600_000)).toBe('24 h');
    expect(formatRemaining(5 * 86_400_000 + 1000)).toBe('5 days');
    expect(formatRemaining(-5)).toBe('0 min');
  });

  it('names the pass', () => {
    expect(passName(null)).toBe('No access pass');
    expect(passName({ packageId: 'monthly', startsAt: 0, expiresAt: 1 })).toBe('Monthly access');
  });
});
