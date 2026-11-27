import type { JobHandler } from '../jobs/worker';
import { sweepExpired } from './rides.repository';

/**
 * `rides.sweep`, every minute: ends searches that ran out of time when nobody's app is asking about them
 * (the rider closed the app), and removes fare quotes older than a day.
 */
export function rideHandlers(): Record<string, JobHandler> {
  return {
    'rides.sweep': async (_job, db) => {
      const ended = await db.tx((tx) => sweepExpired(tx, Date.now()));
      const quotes = await db.query(`delete from app.fare_quotes where expires_at < now() - interval '1 day'`);
      return { ok: true, result: { searchesEnded: ended, quotesRemoved: quotes.rowCount ?? 0 } };
    },
  };
}
