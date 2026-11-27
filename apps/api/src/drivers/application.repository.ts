import { applicationFiles, verificationSummary, type ApplicationFileSlot, type DriverApplication, type VerificationStatus } from '@gobye/core';
import type { Querier } from '../database/database';
import { AppError, Errors } from '../common/errors';

/** A driver's application as stored (app.driver_applications), with the core shape rebuilt from `data`. */
export interface StoredApplication {
  driverId: string;
  city: 'lagos' | 'abuja';
  version: number;
  app: DriverApplication;
  submittedAt: Date | null;
  decidedAt: Date | null;
}

interface Row {
  driver_id: string;
  city: 'lagos' | 'abuja';
  status: VerificationStatus | null;
  version: number | null;
  data: Omit<DriverApplication, 'status'> | null;
  submitted_at: Date | null;
  decided_at: Date | null;
}

/** Load (and lock, for writes) the application. A driver with no row yet has an empty one at version 0. */
export async function loadApplication(q: Querier, driverId: string, lock: boolean): Promise<StoredApplication | null> {
  const r = await q.query<Row>(
    `select d.user_id as driver_id, d.city, a.status, a.version, a.data, a.submitted_at, a.decided_at
       from app.drivers d left join app.driver_applications a on a.driver_id = d.user_id
      where d.user_id = $1 ${lock ? 'for update of d' : ''}`,
    [driverId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const data = row.data ?? { documents: {} };
  return {
    driverId: row.driver_id,
    city: row.city,
    version: row.version ?? 0,
    app: { ...data, documents: data.documents ?? {}, status: row.status ?? 'not_started' },
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  };
}

/** The verification status on app.drivers that matches an application status. */
const DRIVER_STATUS: Record<VerificationStatus, string> = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  changes_requested: 'in_progress',
  pending_review: 'pending_review',
  approved: 'approved',
  rejected: 'rejected',
};

/**
 * Write the new state if nobody changed it since `expected` (optimistic concurrency). Returns the new
 * version; a stale version is a 409 the caller shows as "someone else changed this, reload".
 */
export async function saveApplication(
  q: Querier,
  s: StoredApplication,
  next: DriverApplication,
  event: { actorKind: 'driver' | 'staff'; actorId: string; kind: string; data?: object; decidedBy?: string; requestId?: string; reason?: string },
): Promise<number> {
  const { status, ...data } = next;
  const decided = status === 'approved' || status === 'rejected';
  let version: number;
  if (s.version === 0) {
    const r = await q.query<{ version: number }>(
      `insert into app.driver_applications (driver_id, status, data, submitted_at) values ($1, $2, $3::jsonb, $4)
       on conflict (driver_id) do nothing returning version`,
      [s.driverId, status, JSON.stringify(data), next.submittedAt ? new Date(next.submittedAt) : null],
    );
    if (!r.rows[0]) throw versionConflict();
    version = r.rows[0].version;
  } else {
    const r = await q.query<{ version: number }>(
      `update app.driver_applications
          set status = $3, data = $4::jsonb, version = version + 1,
              submitted_at = $5, decided_at = case when $6 then now() end, decided_by = case when $6 then $7::uuid end
        where driver_id = $1 and version = $2
        returning version`,
      [s.driverId, s.version, status, JSON.stringify(data), next.submittedAt ? new Date(next.submittedAt) : null, decided, event.decidedBy ?? null],
    );
    if (!r.rows[0]) throw versionConflict();
    version = r.rows[0].version;
  }
  await q.query(
    `update app.drivers set verification_status = $2, approved_at = case when $2 = 'approved' then coalesce(approved_at, now()) else approved_at end where user_id = $1`,
    [s.driverId, DRIVER_STATUS[status]],
  );
  await q.query(
    `insert into app.application_events (driver_id, actor_kind, actor_id, kind, version, data) values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [s.driverId, event.actorKind, event.actorId, event.kind, version, JSON.stringify(event.data ?? {})],
  );
  await q.query(
    `insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, reason, request_id, data)
     values ($1, $2, $3, $4, 'driver_application', $5, $6, $7, $8, $9::jsonb)`,
    [event.actorKind, event.actorId, `${event.actorKind}:${event.actorId}`, `driver_application.${event.kind}`, s.driverId, AUDIT_SUMMARY[event.kind] ?? event.kind, event.reason ?? null, event.requestId ?? null, JSON.stringify({ version, ...(event.data ?? {}) })],
  );
  return version;
}

const AUDIT_SUMMARY: Record<string, string> = {
  step_saved: 'Saved a registration step',
  submitted: 'Sent the application for review',
  resubmitted: 'Sent the application back for review',
  changes_requested: 'Asked the driver for changes',
  approved: 'Approved the driver',
  rejected: 'Rejected the driver',
};

export const versionConflict = () => new AppError(409, 'VERSION_CONFLICT', 'This application changed since you opened it. Reload and try again.');

/** The file classes each slot accepts (ops.files.file_class). */
const SLOT_CLASSES: Record<ApplicationFileSlot, string[]> = {
  photo: ['profile_photo'],
  licence: ['driver_licence'],
  selfie: ['identity_document'],
  registration: ['vehicle_document'],
  insurance: ['vehicle_document'],
  roadworthiness: ['vehicle_document'],
};

export type FileState = 'checking' | 'ready' | 'problem' | 'missing';
export interface FileView {
  slot: ApplicationFileSlot;
  fileId: string;
  state: FileState;
}

/** Each referenced file with a state the driver and staff understand. Files stay unreadable until scanned clean. */
export async function applicationFileStates(q: Querier, driverId: string, app: DriverApplication): Promise<FileView[]> {
  const refs = applicationFiles(app);
  if (!refs.length) return [];
  const rows = (
    await q.query<{ id: string; owner_id: string; file_class: string; status: string }>(
      `select id, owner_id, file_class, status from ops.files where id = any($1::uuid[])`,
      [refs.map((r) => r.ref)],
    )
  ).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return refs.map(({ slot, ref }) => {
    const f = byId.get(ref);
    let state: FileState = 'missing';
    if (f && f.owner_id === driverId && SLOT_CLASSES[slot].includes(f.file_class)) {
      state = f.status === 'approved' ? 'ready' : ['pending_upload', 'uploaded', 'scanning'].includes(f.status) ? 'checking' : 'problem';
    }
    return { slot, fileId: ref, state };
  });
}

/** Saving a step: each new file must be the driver's own upload of the right kind and not refused. */
export async function assertFilesUsable(q: Querier, driverId: string, app: DriverApplication, slots: ApplicationFileSlot[]) {
  const bad = (await applicationFileStates(q, driverId, app)).filter((f) => slots.includes(f.slot) && (f.state === 'missing' || f.state === 'problem'));
  if (bad.length) throw Errors.validation(Object.fromEntries(bad.map((f) => [f.slot, f.state === 'missing' ? 'Upload this file again.' : 'This file was refused. Upload a new one.'])), 'Some files can’t be used.');
}

/** Submitting or approving: every file must have passed the scanner. */
export async function assertFilesReady(q: Querier, driverId: string, app: DriverApplication) {
  const notReady = (await applicationFileStates(q, driverId, app)).filter((f) => f.state !== 'ready');
  if (notReady.length) {
    throw new AppError(409, 'DOCUMENTS_NOT_READY', 'Some documents are still being checked or need uploading again.', {
      details: Object.fromEntries(notReady.map((f) => [f.slot, f.state === 'checking' ? 'Still being checked.' : 'Upload this file again.'])),
    });
  }
}

/** The body both the driver and staff read. */
export async function applicationView(q: Querier, s: StoredApplication) {
  return {
    driverId: s.driverId,
    status: s.app.status,
    version: s.version,
    application: { ...s.app, city: s.city },
    summary: verificationSummary(s.app),
    files: await applicationFileStates(q, s.driverId, s.app),
  };
}
