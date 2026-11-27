import type { Querier } from '../database/database';
import { Errors } from '../common/errors';
import type { RideRow } from '../rides/rides.repository';

/** Replaced by the ledger posting in the money work package. */
export async function payByWallet(_tx: Querier, _ride: RideRow, _now: number): Promise<string> {
  throw Errors.notConfigured('Paying from the wallet');
}
