/**
 * Driver location session policy (decision D-012, revised 2026-10-21 per Q-012).
 *
 * - A session starts only when the driver explicitly goes online.
 * - Updates continue in the background while available, approaching pickup, or carrying a passenger.
 * - Operational tracking stops when the driver is offline with no active trip.
 * - iOS: request When In Use first; background updates continue when configured
 *   (UIBackgroundModes `location`, allowsBackgroundLocationUpdates) and started in the foreground.
 *   "Always" is never requested automatically.
 * - Precise location is required for dispatch/navigation; update frequency adapts to activity;
 *   stale positions are flagged.
 * - If permission or updates are lost, new matching pauses and the driver is notified.
 *
 * Pure logic: the Driver app maps platform callbacks (expo-location / TaskManager) to these events.
 * Interval and threshold values are PLACEHOLDERS to be tuned from real-device tests.
 */

export type DriverActivity = 'offline' | 'available' | 'to_pickup' | 'on_trip';

export type DriverLocationPermission =
  | 'undetermined'
  | 'denied'
  | 'restricted'
  | 'when_in_use_approximate'
  | 'when_in_use_precise'
  | 'always_precise';

export type TrackingIssue =
  | 'permission_missing'
  | 'approximate_only'
  | 'background_unavailable'
  | 'session_interrupted'
  | 'stale_position'
  | 'low_accuracy'
  | 'no_access_package';

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  at: number;
}

export interface DriverLocationState {
  activity: DriverActivity;
  permission: DriverLocationPermission;
  /** Background updates configured and allowed on this device (dev build, plist/manifest, FGS). */
  backgroundCapable: boolean;
  sessionActive: boolean;
  sessionStartedAt?: number;
  lastFix?: LocationFix;
  interrupted: boolean;
  hasActiveTrip: boolean;
}

export interface UpdateProfile {
  /** Desired time between updates (ms). */
  intervalMs: number;
  /** Minimum movement before an update (m). */
  distanceMeters: number;
  /** A fix older than this is stale (ms). */
  staleAfterMs: number;
}

/** Placeholder update profiles per activity — tune after device testing (battery vs freshness). */
export const UPDATE_PROFILES: Record<Exclude<DriverActivity, 'offline'>, UpdateProfile> = {
  available: { intervalMs: 15_000, distanceMeters: 50, staleAfterMs: 60_000 },
  to_pickup: { intervalMs: 5_000, distanceMeters: 15, staleAfterMs: 20_000 },
  on_trip: { intervalMs: 5_000, distanceMeters: 20, staleAfterMs: 20_000 },
};

/** Maximum horizontal accuracy accepted for dispatch (placeholder). */
export const MAX_DISPATCH_ACCURACY_M = 100;

export const initialDriverLocationState: DriverLocationState = {
  activity: 'offline',
  permission: 'undetermined',
  backgroundCapable: false,
  sessionActive: false,
  interrupted: false,
  hasActiveTrip: false,
};

export type DriverLocationEvent =
  | { type: 'PERMISSION_CHANGED'; permission: DriverLocationPermission; backgroundCapable: boolean }
  | { type: 'GO_ONLINE'; now: number; hasAccess: boolean }
  | { type: 'GO_OFFLINE' }
  | { type: 'TRIP_ASSIGNED' }
  | { type: 'PASSENGER_PICKED_UP' }
  | { type: 'TRIP_ENDED' }
  | { type: 'FIX'; fix: LocationFix }
  | { type: 'SESSION_INTERRUPTED' }
  | { type: 'SESSION_RESUMED'; now: number };

export type DriverLocationError =
  | 'permission_required'
  | 'precise_required'
  | 'no_access_package'
  | 'finish_trip_first'
  | 'not_online'
  | 'invalid_transition';

export interface DriverLocationResult {
  state: DriverLocationState;
  error?: DriverLocationError;
}

const hasForeground = (p: DriverLocationPermission) =>
  p === 'when_in_use_precise' || p === 'when_in_use_approximate' || p === 'always_precise';
const isPrecise = (p: DriverLocationPermission) => p === 'when_in_use_precise' || p === 'always_precise';

/** Whether operational tracking should be running for this activity. */
export function shouldTrack(state: Pick<DriverLocationState, 'activity' | 'hasActiveTrip'>): boolean {
  return state.activity !== 'offline' || state.hasActiveTrip;
}

export function updateProfileFor(activity: DriverActivity): UpdateProfile | null {
  return activity === 'offline' ? null : UPDATE_PROFILES[activity];
}

export function isStale(state: DriverLocationState, now: number): boolean {
  const profile = updateProfileFor(state.activity);
  if (!profile) return false;
  if (!state.lastFix) return state.sessionActive && state.sessionStartedAt !== undefined && now - state.sessionStartedAt > profile.staleAfterMs;
  return now - state.lastFix.at > profile.staleAfterMs;
}

/**
 * Current problems with tracking. Any issue except `background_unavailable` while in the foreground
 * pauses new matching (the driver app shows these to the driver).
 */
export function trackingIssues(state: DriverLocationState, now: number): TrackingIssue[] {
  if (!shouldTrack(state)) return [];
  const issues: TrackingIssue[] = [];
  if (!hasForeground(state.permission)) issues.push('permission_missing');
  else if (!isPrecise(state.permission)) issues.push('approximate_only');
  if (!state.backgroundCapable) issues.push('background_unavailable');
  if (state.interrupted) issues.push('session_interrupted');
  if (isStale(state, now)) issues.push('stale_position');
  if (state.lastFix && state.lastFix.accuracyMeters > MAX_DISPATCH_ACCURACY_M) issues.push('low_accuracy');
  return issues;
}

/** New requests are offered only when online, idle, tracking is healthy and precise. */
export function canReceiveRequests(state: DriverLocationState, now: number): { ok: boolean; issues: TrackingIssue[] } {
  const issues = trackingIssues(state, now).filter((i) => i !== 'background_unavailable');
  const ok = state.activity === 'available' && state.sessionActive && issues.length === 0;
  return { ok, issues };
}

export function driverLocationReducer(state: DriverLocationState, event: DriverLocationEvent): DriverLocationResult {
  switch (event.type) {
    case 'PERMISSION_CHANGED': {
      const lost = !hasForeground(event.permission);
      return {
        state: {
          ...state,
          permission: event.permission,
          backgroundCapable: event.backgroundCapable,
          // Losing permission interrupts the session; matching pauses via trackingIssues.
          interrupted: state.sessionActive && lost ? true : state.interrupted,
        },
      };
    }
    case 'GO_ONLINE': {
      if (state.activity !== 'offline') return { state, error: 'invalid_transition' };
      if (!hasForeground(state.permission)) return { state, error: 'permission_required' };
      if (!isPrecise(state.permission)) return { state, error: 'precise_required' };
      if (!event.hasAccess) return { state, error: 'no_access_package' };
      return {
        state: { ...state, activity: 'available', sessionActive: true, sessionStartedAt: event.now, interrupted: false, lastFix: undefined },
      };
    }
    case 'GO_OFFLINE': {
      if (state.hasActiveTrip) return { state, error: 'finish_trip_first' };
      return { state: { ...state, activity: 'offline', sessionActive: false, sessionStartedAt: undefined, lastFix: undefined, interrupted: false } };
    }
    case 'TRIP_ASSIGNED':
      if (state.activity !== 'available') return { state, error: 'not_online' };
      return { state: { ...state, activity: 'to_pickup', hasActiveTrip: true } };
    case 'PASSENGER_PICKED_UP':
      if (state.activity !== 'to_pickup') return { state, error: 'invalid_transition' };
      return { state: { ...state, activity: 'on_trip' } };
    case 'TRIP_ENDED':
      if (!state.hasActiveTrip) return { state, error: 'invalid_transition' };
      // Back to available: the driver stays online until they explicitly go offline.
      return { state: { ...state, activity: 'available', hasActiveTrip: false } };
    case 'FIX':
      if (!state.sessionActive) return { state, error: 'not_online' };
      return { state: { ...state, lastFix: event.fix, interrupted: false } };
    case 'SESSION_INTERRUPTED':
      if (!state.sessionActive) return { state };
      return { state: { ...state, interrupted: true } };
    case 'SESSION_RESUMED':
      if (!state.sessionActive) return { state, error: 'not_online' };
      return { state: { ...state, interrupted: false, sessionStartedAt: event.now } };
    default: {
      const never: never = event;
      return never;
    }
  }
}

/** Driver-facing copy for each issue. */
export function trackingIssueMessage(issue: TrackingIssue): string {
  switch (issue) {
    case 'permission_missing':
      return 'Location access is off. Turn it on in Settings to receive requests.';
    case 'approximate_only':
      return 'Precise location is off. Turn on Precise Location so riders and pickups line up.';
    case 'background_unavailable':
      return 'Location stops when GoBye Driver is in the background. Keep the app open while online.';
    case 'session_interrupted':
      return 'Location updates were interrupted. New requests are paused until updates resume.';
    case 'stale_position':
      return 'We haven’t had a location update recently. New requests are paused.';
    case 'low_accuracy':
      return 'Your GPS signal is weak. Move to an open area if you can.';
    case 'no_access_package':
      return 'Buy a daily or monthly access package to go online.';
  }
}
