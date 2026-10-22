import type { LatLng } from './types';

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function polylineLength(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

/** Point at fraction t (0..1) along a polyline, by distance. */
export function pointAlong(points: LatLng[], t: number): LatLng {
  if (points.length === 0) throw new Error('Empty polyline');
  if (points.length === 1 || t <= 0) return points[0];
  if (t >= 1) return points[points.length - 1];
  const target = polylineLength(points) * t;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = haversineMeters(points[i - 1], points[i]);
    if (travelled + seg >= target) {
      const f = seg === 0 ? 0 : (target - travelled) / seg;
      return {
        latitude: points[i - 1].latitude + (points[i].latitude - points[i - 1].latitude) * f,
        longitude: points[i - 1].longitude + (points[i].longitude - points[i - 1].longitude) * f,
      };
    }
    travelled += seg;
  }
  return points[points.length - 1];
}

/** Region that fits all points with padding, for map cameras. */
export function regionForPoints(points: LatLng[], paddingFactor = 1.4) {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * paddingFactor),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * paddingFactor),
  };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** mm:ss countdown, never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
