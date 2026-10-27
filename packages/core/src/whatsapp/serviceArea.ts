import type { LatLng } from '../types';
import type { CityId } from '../platform/types';

/**
 * Launch cities as rough bounding boxes (Lagos State; the Federal Capital Territory). APPROXIMATE:
 * good enough to tell "in Lagos" from "in Ibadan" for a chat booking. Real service areas (polygons,
 * excluded zones) will come from server configuration before launch (Q-007).
 */
export const SERVICE_AREAS: Record<CityId, { south: number; north: number; west: number; east: number; name: string }> = {
  lagos: { south: 6.36, north: 6.75, west: 2.7, east: 4.36, name: 'Lagos' },
  abuja: { south: 8.4, north: 9.35, west: 6.75, east: 7.65, name: 'Abuja' },
};

export function cityAt(p: LatLng): CityId | null {
  for (const [id, a] of Object.entries(SERVICE_AREAS) as [CityId, (typeof SERVICE_AREAS)[CityId]][]) {
    if (p.latitude >= a.south && p.latitude <= a.north && p.longitude >= a.west && p.longitude <= a.east) return id;
  }
  return null;
}
