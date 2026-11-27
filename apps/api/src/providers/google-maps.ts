import type { LatLng } from '@gobye/core';
import { Errors } from '../common/errors';
import type { MapsProvider, PlaceResult } from './ports';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Google Maps Platform (D-025), called from the server only: Routes API for distance and time, Places
 * API (New) for search, Geocoding for "what is here". The key is a SERVER key (restricted to these three
 * APIs, never shipped in an app). Written from Google's public documentation and run only against a
 * stand-in server: the first real call needs a key and a billing account.
 */
export function googleMaps(o: { apiKey: string; fetch?: FetchLike; timeoutMs?: number }): MapsProvider {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const call = async <T>(url: string, init: { method: string; headers?: Record<string, string>; body?: object }): Promise<T> => {
    let res;
    try {
      res = await f(url, { method: init.method, headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey, ...(init.headers ?? {}) }, ...(init.body ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(o.timeoutMs ?? 6000) });
    } catch {
      throw Errors.unavailable('Maps are slow to answer. Try again.');
    }
    if (!res.ok) throw Errors.unavailable('Maps are unavailable right now. Try again.');
    return (await res.json()) as T;
  };
  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });

  return {
    name: 'google',
    async searchPlaces(query, near) {
      const q = query.trim();
      if (q.length < 2) return [];
      const r = await call<{ places?: { id: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }[] }>('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'x-goog-fieldmask': 'places.id,places.displayName,places.formattedAddress,places.location' },
        body: { textQuery: q.slice(0, 120), regionCode: 'NG', maxResultCount: 8, ...(near ? { locationBias: { circle: { center: { latitude: near.latitude, longitude: near.longitude }, radius: 30000 } } } : {}) },
      });
      return (r.places ?? []).filter((p) => p.location).map((p): PlaceResult => ({ id: p.id, label: p.displayName?.text ?? p.formattedAddress ?? 'Place', secondary: p.formattedAddress ?? null, location: { latitude: p.location!.latitude, longitude: p.location!.longitude } }));
    },
    async reverseGeocode(at) {
      const r = await call<{ results?: { place_id: string; formatted_address: string }[] }>(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${at.latitude.toFixed(6)},${at.longitude.toFixed(6)}&region=ng`, { method: 'GET' });
      const first = r.results?.[0];
      return first ? { id: first.place_id, label: first.formatted_address.split(',')[0] ?? first.formatted_address, secondary: first.formatted_address, location: at } : null;
    },
    async route(from, to) {
      const r = await call<{ routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] }>('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'x-goog-fieldmask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
        body: { origin: point(from), destination: point(to), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', regionCode: 'NG' },
      });
      const best = r.routes?.[0];
      const seconds = best?.duration ? Number(String(best.duration).replace(/s$/, '')) : NaN;
      if (!best?.distanceMeters || !Number.isFinite(seconds)) throw Errors.validation({ destination: 'We couldn’t find a route between these places.' });
      return { distanceMeters: best.distanceMeters, durationSeconds: Math.round(seconds), polyline: best.polyline?.encodedPolyline ?? null };
    },
  };
}
