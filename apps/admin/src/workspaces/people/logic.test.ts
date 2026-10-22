import { describe, expect, it } from 'vitest';
import { createPlatformDataset, type DriverRecord } from '@gobye/core';
import { accessStatus, applyVerification, documentReadiness, expiringDocuments, liftRestriction, restrictPassenger, reviewDocument, searchPassengers, verificationActions } from './logic';

const d = createPlatformDataset();
const now = d.generatedAt;
const DAY = 86_400_000;
const allAccepted = (): DriverRecord => ({
  ...d.drivers[0]!,
  verification: 'in_review',
  documents: (['licence', 'vehicle_registration', 'insurance', 'roadworthiness', 'id_card', 'photo'] as const).map((kind) => ({ kind, status: 'accepted' as const, expiresAt: kind === 'licence' ? now + 100 * DAY : undefined })),
});

describe('documentReadiness', () => {
  it('is ready when every required document is accepted and in date', () => {
    expect(documentReadiness(allAccepted(), now)).toEqual({ ready: true, blockers: [] });
  });
  it('blocks on missing, unreviewed or expired documents', () => {
    const x = allAccepted();
    x.documents[0]!.expiresAt = now - DAY;
    x.documents[2]!.status = 'missing';
    x.documents[3]!.status = 'submitted';
    const r = documentReadiness(x, now);
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(['Driver’s licence: expired', 'Insurance: missing', 'Roadworthiness: not reviewed yet']);
  });
  it('ignores the photo', () => {
    const x = allAccepted();
    x.documents[5]!.status = 'missing';
    expect(documentReadiness(x, now).ready).toBe(true);
  });
});

describe('applyVerification', () => {
  it('approves only when documents are ready', () => {
    const x = allAccepted();
    x.documents[1]!.status = 'rejected';
    expect(applyVerification(x, 'approve', now).ok).toBe(false);
    expect(x.verification).toBe('in_review');
    x.documents[1]!.status = 'accepted';
    expect(applyVerification(x, 'approve', now)).toEqual({ ok: true });
    expect(x.verification).toBe('approved');
  });
  it('follows the workflow and needs reasons for reject and suspend', () => {
    expect(verificationActions('approved')).toEqual(['suspend']);
    expect(verificationActions('suspended')).toEqual(['reject', 'reinstate']);
    const x = allAccepted();
    x.verification = 'approved';
    x.online = true;
    expect(applyVerification(x, 'suspend', now).ok).toBe(false);
    expect(applyVerification(x, 'suspend', now, 'Safety review')).toEqual({ ok: true });
    expect(x.online).toBe(false);
    expect(applyVerification(x, 'reinstate', now)).toEqual({ ok: true });
    expect(x.verification).toBe('approved');
  });
});

describe('reviewDocument', () => {
  it('rejecting needs a note; expired documents cannot be accepted', () => {
    const x = allAccepted();
    expect(reviewDocument(x, 'insurance', 'rejected', now).ok).toBe(false);
    expect(reviewDocument(x, 'insurance', 'rejected', now, 'Blurry').ok).toBe(true);
    expect(x.documents[2]!.note).toBe('Blurry');
    x.documents[0]!.expiresAt = now - 1;
    expect(reviewDocument(x, 'licence', 'accepted', now).ok).toBe(false);
  });
});

describe('expiringDocuments', () => {
  it('lists expired or soon expiring documents, soonest first', () => {
    const rows = expiringDocuments(d.drivers, now);
    expect(rows.every((r) => r.expiresAt - now <= 30 * DAY)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.expiresAt).toBeGreaterThanOrEqual(rows[i - 1]!.expiresAt);
  });
});

describe('accessStatus', () => {
  it('describes package state', () => {
    expect(accessStatus({ access: null }, now)).toEqual({ active: false, label: 'No package' });
    expect(accessStatus({ access: { packageId: 'daily', expiresAt: now + 1 } }, now).active).toBe(true);
    expect(accessStatus({ access: { packageId: 'monthly', expiresAt: now - 1 } }, now).label).toBe('Monthly access expired');
  });
});

describe('passengers', () => {
  it('matches phone numbers only with contact permission', () => {
    const p = d.passengers[0]!;
    const tail = p.phone.replace(/\D/g, '').slice(-4);
    expect(searchPassengers(d.passengers, tail, true).map((x) => x.id)).toContain(p.id);
    expect(searchPassengers(d.passengers, tail, false).map((x) => x.id)).not.toContain(p.id);
    expect(searchPassengers(d.passengers, p.name.split(' ')[0]!, false).map((x) => x.id)).toContain(p.id);
  });
  it('restricts with a reason and future end date, and lifts', () => {
    const p = { ...d.passengers.find((x) => x.status === 'active')! };
    expect(restrictPassenger(p, { reason: '', by: 'A' }, now).ok).toBe(false);
    expect(restrictPassenger(p, { reason: 'Abuse', until: now - 1, by: 'A' }, now).ok).toBe(false);
    expect(restrictPassenger(p, { reason: 'Abuse', until: now + DAY, by: 'A' }, now)).toEqual({ ok: true });
    expect(p.status).toBe('restricted');
    expect(liftRestriction(p)).toEqual({ ok: true });
    expect(p.restriction).toBeUndefined();
  });
});
