import { AppError } from './errors';

/**
 * A small per-person cap for routes that cost money each time (map lookups, prices). It lives in this
 * process only: with several API instances each one counts separately, so the gateway's per-caller limit
 * is the hard limit and this is the second line.
 */
export class Meter {
  private readonly used = new Map<string, { minute: number; n: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number,
  ) {}

  hit(key: string): void {
    const minute = Math.floor(this.now() / 60_000);
    const u = this.used.get(key);
    if (!u || u.minute !== minute) {
      if (this.used.size > 20_000) this.used.clear();
      this.used.set(key, { minute, n: 1 });
      return;
    }
    if (++u.n > this.perMinute) throw new AppError(429, 'rate_limited', 'Too many requests. Wait a moment.', { retryAfterSeconds: 30 });
  }
}
