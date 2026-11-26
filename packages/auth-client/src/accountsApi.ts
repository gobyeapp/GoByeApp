import type { ApiClient, ApiResult, ConsentRecord } from '@gobye/core';

/** The body of GET /v1/me (API_CONTRACTS.md §10). */
export interface MeBody {
  userId: string;
  signupComplete: boolean;
  status: string | null;
  fullName: string | null;
  phoneConfirmed: boolean;
  rider: boolean;
  driver: { city: string; verification: string } | null;
  consentsNeeded: ConsentRecord[];
  deletion: { status: 'scheduled'; scheduledFor: string } | null;
}

export interface DeviceInfo {
  installId: string;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string;
}

/** The GoBye accounts API (Backend Phase 2, WP1), as used by sign-in. */
export interface AccountsApi {
  me(): Promise<ApiResult<MeBody>>;
  createProfile(userId: string, body: { role: 'rider' | 'driver'; fullName: string; city?: 'lagos' | 'abuja'; consents: ConsentRecord[]; device?: DeviceInfo }): Promise<ApiResult<MeBody>>;
  rename(fullName: string, idempotencyKey: string): Promise<ApiResult<MeBody>>;
  requestDeletion(idempotencyKey: string): Promise<ApiResult<{ status: 'scheduled'; scheduledFor: string }>>;
}

export function createAccountsApi(api: ApiClient): AccountsApi {
  return {
    me: () => api.get<MeBody>('/me'),
    // One key per person: retrying a sign-up that already reached the server replays it instead of failing.
    createProfile: (userId, body) => api.post<MeBody>('/me/profile', body, { idempotencyKey: `profile-${userId}` }),
    rename: (fullName, idempotencyKey) => api.patch<MeBody>('/me/profile', { fullName }, { idempotencyKey }),
    requestDeletion: (idempotencyKey) => api.delete<{ status: 'scheduled'; scheduledFor: string }>('/me', { idempotencyKey }),
  };
}
