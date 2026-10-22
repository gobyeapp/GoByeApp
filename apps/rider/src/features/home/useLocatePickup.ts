import { useCallback, useState } from 'react';
import type { Place, Result } from '@gobye/core';
import { useBooking } from '@/state/booking';
import { useCurrentLocation } from '@/state/location';
import { useServices } from '@/state/services';

/**
 * "Use my location" for the pickup: takes a fresh fix, looks up the address and sets it as the pickup.
 * Nothing changes if any step fails, so the current pickup is never lost.
 */
export function useLocatePickup() {
  const location = useCurrentLocation();
  const { maps } = useServices();
  const { setPickup } = useBooking();
  const [busy, setBusy] = useState(false);

  const locate = useCallback(async (): Promise<Result<Place>> => {
    setBusy(true);
    try {
      const c = await location.refresh();
      if (!c) return { ok: false, error: 'We couldn’t find your position. Check that location services are on, or search for the address.' };
      const p = await maps.reverseGeocode(c);
      const place: Place = { ...p, coordinate: c, title: 'Current location', subtitle: p.title };
      setPickup(place);
      return { ok: true, value: place };
    } catch {
      return { ok: false, error: 'We couldn’t look up the address here. Try again, or search for it.' };
    } finally {
      setBusy(false);
    }
  }, [location, maps, setPickup]);

  return { locate, busy };
}
