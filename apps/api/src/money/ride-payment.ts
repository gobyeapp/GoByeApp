import type { Querier } from '../database/database';
import type { RideRow } from '../rides/rides.repository';
import { postJournal } from './ledger';

/**
 * Pays a finished trip from the rider's wallet: the fare leaves the wallet and becomes the driver's
 * earnings (0% commission, D-024). One journal per ride, so paying twice is impossible. Throws
 * INSUFFICIENT_FUNDS when the wallet doesn't cover the fare; nothing changes then.
 */
export async function payByWallet(tx: Querier, ride: RideRow, _now: number): Promise<string> {
  const fare = Number(ride.agreed_fare_kobo);
  const reference = `ride:${ride.id}`;
  await postJournal(tx, {
    kind: 'trip_charge',
    reference,
    description: 'Trip paid from the wallet',
    actor: { kind: 'rider', id: ride.rider_id },
    links: { rideId: ride.id },
    lines: [
      { account: 'passenger_wallet', ownerId: ride.rider_id, amount: -fare },
      { account: 'driver_earnings', ownerId: ride.driver_id!, amount: fare },
    ],
  });
  return reference;
}
