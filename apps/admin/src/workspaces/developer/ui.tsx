import type { ConnectionState } from '@gobye/core';
import { when } from '@/data/format';
import { Pill } from '@/ui/kit';
import { OUTCOME_META, STATE_META, type Check, type EventOutcome } from './logic';

/* Small presentational pieces shared by the developer and payments pages (local, not in the kit). */

export function StatePill({ state }: { state: ConnectionState }) {
  const m = STATE_META[state];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.text}
    </Pill>
  );
}

export function OutcomePill({ outcome }: { outcome: EventOutcome }) {
  const m = OUTCOME_META[outcome];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.text}
    </Pill>
  );
}

export function CheckPill({ check, running }: { check?: Check; running?: 'checking' | 'waiting' }) {
  if (running === 'checking') return <Pill tone="info" icon="time">Checking</Pill>;
  if (running === 'waiting') return <Pill tone="neutral" icon={null}>Waiting</Pill>;
  if (!check) return <Pill tone="neutral" icon={null}>Not run</Pill>;
  if (check.passed) return <Pill tone="success" icon="check">Passed</Pill>;
  if (!check.at && !check.detail) return <Pill tone="neutral" icon={null}>Not run</Pill>;
  return <Pill tone="danger">Not passed</Pill>;
}

/** `when()` prints a dash for missing times; visible copy uses words instead. */
export const ago = (ms: number | undefined, now: number, missing = 'Never') => (ms ? when(ms, now) : missing);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
