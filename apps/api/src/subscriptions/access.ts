import { passAt } from '@gobye/core';
import type { Querier } from '../database/database';
import { loadState } from './subscriptions.repository';

/** True when the driver has a pass covering this moment (D-024, D-058). Rules from @gobye/core. */
export async function hasDriverAccess(q: Querier, driverId: string, now: number): Promise<boolean> {
  const s = await loadState(q, driverId);
  return !!s && !!passAt(s.passes, now);
}
