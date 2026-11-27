type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FaceMatchResult {
  status: 'passed' | 'failed' | 'error';
  faceMatch: boolean | null;
  matchScore: number | null;
  /** Do the names on the NIN record match the names the driver gave? Compared here; the record is not kept. */
  nameMatch: boolean | null;
  providerRef: string | null;
  detail: string | null;
}

/** Identity checks (D-103). The provider is a choice; results always come back to our own tables (D-067). */
export interface IdentityProvider {
  readonly name: string;
  readonly simulated: boolean;
  ninFaceMatch(p: { nin: string; firstName: string; lastName: string; photoUrl: string }): Promise<FaceMatchResult>;
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/[^a-z]/g, '') === b.trim().toLowerCase().replace(/[^a-z]/g, '');

/** Development and tests: passes a NIN ending in an even digit. Refused in production by configuration. */
export const simulatedIdentity: IdentityProvider = {
  name: 'simulated',
  simulated: true,
  async ninFaceMatch(p) {
    const ok = Number(p.nin.slice(-1)) % 2 === 0;
    return { status: ok ? 'passed' : 'failed', faceMatch: ok, matchScore: ok ? 96 : 31, nameMatch: true, providerRef: `sim-${p.nin.slice(-4)}`, detail: ok ? null : 'The selfie does not match the NIN photo (simulated).' };
  },
};

/**
 * QoreID: NIN face match (POST /v1/ng/identities/face-verification/nin with a bearer token from /token).
 * Written from QoreID's public documentation; it has NOT been run against QoreID. The token endpoint and
 * its field names in particular must be confirmed with test credentials before use. The provider's copy
 * of the photo and bio-data is read once for the comparison and never stored.
 */
export function qoreId(o: { clientId: string; secret: string; baseUrl?: string; fetch?: FetchLike }): IdentityProvider {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const base = (o.baseUrl ?? 'https://api.qoreid.com').replace(/\/+$/, '');
  let token: { value: string; until: number } | null = null;
  const bearer = async () => {
    if (token && token.until > Date.now() + 30_000) return token.value;
    const r = await f(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: o.clientId, secret: o.secret }), signal: AbortSignal.timeout(8000) });
    const j = (await r.json().catch(() => null)) as { accessToken?: string; expiresIn?: number } | null;
    if (!r.ok || !j?.accessToken) throw new Error(`QoreID token HTTP ${r.status}`);
    token = { value: j.accessToken, until: Date.now() + (j.expiresIn ?? 600) * 1000 };
    return token.value;
  };
  return {
    name: 'qoreid',
    simulated: false,
    async ninFaceMatch(p) {
      const r = await f(`${base}/v1/ng/identities/face-verification/nin`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await bearer()}` }, body: JSON.stringify({ idNumber: p.nin, photoUrl: p.photoUrl }), signal: AbortSignal.timeout(20_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`QoreID HTTP ${r.status}`);
      const j = (await r.json().catch(() => null)) as { id?: number | string; summary?: { face_verification_check?: { match?: boolean; match_score?: number } }; status?: { status?: string }; face_verification?: { firstname?: string; lastname?: string } } | null;
      if (!r.ok || !j) return { status: 'error', faceMatch: null, matchScore: null, nameMatch: null, providerRef: null, detail: `The identity service refused the request (HTTP ${r.status}).` };
      const fc = j.summary?.face_verification_check;
      const rec = j.face_verification;
      const nameMatch = rec?.firstname && rec.lastname ? same(rec.firstname, p.firstName) && same(rec.lastname, p.lastName) : null;
      const faceMatch = typeof fc?.match === 'boolean' ? fc.match : null;
      const passed = faceMatch === true && nameMatch !== false && j.status?.status === 'verified';
      return { status: passed ? 'passed' : 'failed', faceMatch, matchScore: typeof fc?.match_score === 'number' ? Math.round(fc.match_score * 100) / 100 : null, nameMatch, providerRef: j.id !== undefined ? String(j.id) : null, detail: passed ? null : faceMatch === false ? 'The selfie does not match the NIN photo.' : nameMatch === false ? 'The name on the NIN is different.' : 'The NIN could not be verified.' };
    },
  };
}
