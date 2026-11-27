import type { DriverApplication, VerificationCheck } from '@gobye/core';
import type { Querier } from '../database/database';
import { enqueue } from '../jobs/queue';
import type { JobHandler } from '../jobs/worker';
import type { Providers } from '../providers/ports';

/** Queued when a driver sends their application for review. Does nothing until a provider is set. */
export const queueIdentityCheck = (tx: Querier, driverId: string, version: number) => enqueue(tx, { kind: 'identity.check', payload: { driverId }, idempotencyKey: `identity.check:${driverId}:${version}`, maxAttempts: 6 });

/**
 * `identity.check` (D-103): compares the driver's selfie with their NIN record at the identity provider
 * and writes the outcome to our own tables, where staff see it on the application (D-067). It never
 * approves or rejects a driver: a person still decides. The selfie is only shared once our own file
 * check has cleared it, through a link that expires in minutes.
 */
export function identityHandlers(o: { providers: Providers }): Record<string, JobHandler> {
  return {
    'identity.check': async (job, db) => {
      const driverId = String(job.payload.driverId ?? '');
      const provider = o.providers.identity;
      if (!provider) return { ok: true, result: { skipped: 'no identity provider: staff check by hand' } };
      const a = (await db.query<{ data: DriverApplication; status: string }>(`select data, status from app.driver_applications where driver_id = $1`, [driverId])).rows[0];
      if (!a || a.status !== 'pending_review') return { ok: true, result: { skipped: 'not waiting for review' } };
      const id = a.data.identity;
      const person = a.data.personal;
      if (!id || !person || id.type !== 'nin') return { ok: true, result: { skipped: 'no NIN on this application: staff check by hand' } };
      const f = (await db.query<{ bucket: string; object_key: string; status: string; scan_status: string }>(`select bucket, object_key, status, scan_status from ops.files where id::text = $1 and owner_id = $2`, [id.selfieUri, driverId])).rows[0];
      if (!f) return { ok: true, result: { skipped: 'selfie file not found' } };
      if (f.scan_status !== 'clean') return { ok: false, error: 'selfie not cleared by the file check yet', permanent: false };
      const link = await o.providers.storage.presignGet({ bucket: f.bucket, key: f.object_key, expiresIn: 300 });
      const r = await provider.ninFaceMatch({ nin: id.number, firstName: person.firstName, lastName: person.lastName, photoUrl: link.url });
      await db.tx(async (tx) => {
        await tx.query(`insert into app.identity_checks (driver_id, kind, provider, provider_ref, status, face_match, match_score, name_match, detail) values ($1, 'nin_face_match', $2, $3, $4, $5, $6, $7, $8)`, [driverId, provider.name, r.providerRef, r.status, r.faceMatch, r.matchScore, r.nameMatch, r.detail]);
        const row = (await tx.query<{ data: DriverApplication; status: string }>(`select data, status from app.driver_applications where driver_id = $1 for update`, [driverId])).rows[0]!;
        if (row.status !== 'pending_review' || r.status === 'error') return;
        const now = Date.now();
        const checks: VerificationCheck[] = (row.data.checks ?? []).map((c) => (c.id === 'identity' ? { ...c, state: r.status === 'passed' ? ('passed' as const) : ('failed' as const), note: r.detail ?? undefined, updatedAt: now } : c));
        // Only the check's state changes; the application's version and status are staff's to change.
        await tx.query(`update app.driver_applications set data = jsonb_set(data, '{checks}', $2::jsonb) where driver_id = $1`, [driverId, JSON.stringify(checks)]);
        await tx.query(`insert into ops.audit_events (actor_kind, actor_id, actor_name, action, target_type, target_id, summary, data) values ('provider', $1, $1, 'driver.identity_checked', 'driver', $2, $3, $4::jsonb)`, [provider.name, driverId, r.status === 'passed' ? 'Identity check passed' : 'Identity check did not pass', JSON.stringify({ faceMatch: r.faceMatch, matchScore: r.matchScore, nameMatch: r.nameMatch, simulated: provider.simulated })]);
      });
      return r.status === 'error' ? { ok: false, error: r.detail ?? 'identity provider error', permanent: false } : { ok: true, result: { status: r.status } };
    },
  };
}
