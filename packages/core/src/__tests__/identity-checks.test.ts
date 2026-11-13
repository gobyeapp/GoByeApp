import { IDENTITY_CHECKS, createPlatformDataset, identityCheckSummary, integrationsWithoutDashboard, simulatedIdentityChecks, type DriverRecord } from '../index';

const now = Date.UTC(2026, 10, 13, 10, 0);
const data = createPlatformDataset(now);
const driverIn = (v: DriverRecord['verification']) => ({ ...data.drivers[0], verification: v });

describe('driver identity checks (D-066)', () => {
  it('covers NIN, licence, face match, liveness and plate, from QoreID', () => {
    expect(IDENTITY_CHECKS.map((c) => c.kind)).toEqual(['nin', 'licence', 'face_match', 'liveness', 'plate']);
    for (const r of simulatedIdentityChecks(driverIn('approved'), now)) expect(r.provider).toBe('QoreID');
  });

  it('an approved driver passed every check, each with a provider reference', () => {
    const r = simulatedIdentityChecks(driverIn('approved'), now);
    expect(identityCheckSummary(r)).toEqual({ passed: 5, attention: 0, notRun: 0, allPassed: true });
    expect(r.every((x) => x.reference && x.checkedAt)).toBe(true);
  });

  it('a new application has run nothing yet', () => {
    const s = identityCheckSummary(simulatedIdentityChecks(driverIn('applied'), now));
    expect(s.notRun).toBe(5);
    expect(s.allPassed).toBe(false);
  });

  it('flags a name mismatch for staff and a failed licence on a rejected driver', () => {
    const review = simulatedIdentityChecks(driverIn('in_review'), now);
    expect(review.find((x) => x.kind === 'nin')!.outcome).toBe('needs_review');
    const rejected = simulatedIdentityChecks(driverIn('rejected'), now);
    expect(rejected.find((x) => x.kind === 'licence')!.outcome).toBe('failed');
    expect(identityCheckSummary(rejected).attention).toBe(1);
  });
});

describe('integration results come home (D-067)', () => {
  it('every integration says where its results show in our dashboards', () => {
    expect(integrationsWithoutDashboard(data.integrations).map((i) => i.id)).toEqual([]);
    for (const i of data.integrations) for (const r of i.resultsShownIn) expect(r.route.startsWith('/')).toBe(true);
  });

  it('identity results show on the driver page', () => {
    const idv = data.integrations.find((i) => i.id === 'int-idv')!;
    expect(idv.provider).toContain('QoreID');
    expect(idv.resultsShownIn.map((r) => r.route)).toContain('/drivers');
  });

  it('catches an integration added without a home for its results', () => {
    expect(integrationsWithoutDashboard([{ ...data.integrations[0], resultsShownIn: [] }])).toHaveLength(1);
  });
});
