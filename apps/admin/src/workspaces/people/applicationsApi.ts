import type { ApiClient, ApiResult, DriverApplication, IssueCode, VerificationSummary } from '@gobye/core';

/** Staff review of driver applications on the GoBye API (D-079, D-081). Bodies: API_CONTRACTS.md §10. */

export type AppStatus = 'in_progress' | 'pending_review' | 'changes_requested' | 'approved' | 'rejected';

export interface QueueItem {
  driverId: string;
  name: string;
  city: 'lagos' | 'abuja';
  status: AppStatus;
  version: number;
  submittedAt: string | null;
  updatedAt: string;
  openIssues: number;
}

export interface ApplicationDetail {
  driverId: string;
  status: AppStatus;
  version: number;
  application: DriverApplication & { city: 'lagos' | 'abuja' };
  summary: VerificationSummary;
  files: { slot: string; fileId: string; state: 'checking' | 'ready' | 'problem' | 'missing' }[];
  driver: { name: string; email?: string | null; phone?: string | null };
  events: { at: string; by: 'driver' | 'staff' | 'system'; kind: string; version: number }[];
}

const newKey = () => `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function applicationsApi(api: ApiClient) {
  return {
    list: (status: AppStatus, city?: string) => api.get<{ items: QueueItem[] }>('/staff/driver-applications', { query: { status, city } }),
    get: (driverId: string) => api.get<ApplicationDetail>(`/staff/driver-applications/${driverId}`),
    requestChanges: (driverId: string, version: number, issues: { code: IssueCode; note?: string }[], note?: string) =>
      api.post<ApplicationDetail>(`/staff/driver-applications/${driverId}/request-changes`, { version, issues, ...(note ? { note } : {}) }, { idempotencyKey: newKey() }),
    approve: (driverId: string, version: number) => api.post<ApplicationDetail>(`/staff/driver-applications/${driverId}/decision`, { version, decision: 'approve' }, { idempotencyKey: newKey() }),
    reject: (driverId: string, version: number, reason: string) =>
      api.post<ApplicationDetail>(`/staff/driver-applications/${driverId}/decision`, { version, decision: 'reject', reason }, { idempotencyKey: newKey() }),
  };
}

/** One line for a failed action: a version conflict asks to reload, anything else uses the server's words. */
export function actionError(r: ApiResult<unknown>): string | null {
  if (r.ok) return null;
  if (r.error.code === 'VERSION_CONFLICT') return 'Someone else changed this application. It has been reloaded.';
  if (r.error.code === 'DOCUMENTS_NOT_READY') return 'Some documents haven’t passed the file check yet.';
  return r.error.message;
}

/** ID numbers are shown with only the last 4 characters. */
export const masked = (v: string | undefined) => (v ? `•••• ${v.slice(-4)}` : '—');

export const FILE_LABEL: Record<string, string> = {
  photo: 'Profile photo',
  licence: 'Driver’s licence',
  selfie: 'ID selfie',
  registration: 'Vehicle licence',
  insurance: 'Insurance',
  roadworthiness: 'Roadworthiness',
};
