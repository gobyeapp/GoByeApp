import { DATA_PLATFORM, MIGRATION_PHASES, MIGRATION_STEPS, PORTABILITY_CHECKS, PROVIDER_OPTIONS, migrationPlan, portabilitySummary } from '../index';

describe('data platform portability (D-065)', () => {
  it('records both components with the settings that point the API at them', () => {
    expect(DATA_PLATFORM.map((c) => c.area)).toEqual(['database', 'auth']);
    expect(DATA_PLATFORM.find((c) => c.area === 'database')!.configuredBy).toContain('DATABASE_URL');
    expect(DATA_PLATFORM.find((c) => c.area === 'auth')!.configuredBy.join(' ')).toContain('AUTH_PROVIDER');
  });

  it('every check, option and step has a unique id and evidence or a source', () => {
    for (const list of [PORTABILITY_CHECKS, PROVIDER_OPTIONS, MIGRATION_STEPS]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    for (const c of PORTABILITY_CHECKS) expect(c.evidence.length).toBeGreaterThan(3);
    for (const o of PROVIDER_OPTIONS) expect(o.source).toMatch(/^https:\/\//);
  });

  it('summarises readiness per area', () => {
    const s = portabilitySummary();
    expect(s.database.attention).toBe(0);
    expect(s.auth.attention).toBeGreaterThan(0);
    expect(s.database.ready + s.database.attention + s.auth.ready + s.auth.attention).toBe(PORTABILITY_CHECKS.length);
  });

  it('a database-only plan skips sign-in steps and stays in phase order', () => {
    const db = migrationPlan('database');
    expect(db.some((s) => s.area === 'auth')).toBe(false);
    expect(db.some((s) => s.id === 'dump')).toBe(true);
    const phases = db.map((s) => MIGRATION_PHASES.indexOf(s.phase));
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
    expect(migrationPlan('both')).toHaveLength(MIGRATION_STEPS.length);
    expect(migrationPlan('auth').some((s) => s.id === 'auth-switch')).toBe(true);
  });
});
