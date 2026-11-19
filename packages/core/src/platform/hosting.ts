/**
 * Hosting plan (D-072, D-073). Everything free runs on Cloudflare now; the paid parts (Workers Paid for
 * the API containers, R2 storage) wait behind one owner switch in the admin. Turning the switch on records
 * the owner's approval; the parts start only after Workers Paid is active in Cloudflare and the
 * "Deploy API (staging)" workflow has run. Turning it off records that paid hosting should stop.
 */
export type HostingTier = 'free' | 'paid';

export interface HostingPart {
  id: string;
  label: string;
  provider: string;
  tier: HostingTier;
  /** Approximate monthly cost in US dollars at launch size (cost sheet, 13 Nov 2026). */
  monthlyUsd: number;
  /** How it is deployed or switched on. */
  how: string;
}

export const HOSTING_PARTS: HostingPart[] = [
  { id: 'web', label: 'Website', provider: 'Cloudflare', tier: 'free', monthlyUsd: 0, how: 'Actions → Deploy sites (Cloudflare)' },
  { id: 'admin', label: 'Admin dashboard', provider: 'Cloudflare', tier: 'free', monthlyUsd: 0, how: 'Actions → Deploy sites (Cloudflare)' },
  { id: 'db', label: 'Database and sign in', provider: 'Supabase', tier: 'free', monthlyUsd: 0, how: 'Supabase free plan; Pro ($25) when the database nears 400 MB' },
  { id: 'workers-paid', label: 'Workers Paid plan', provider: 'Cloudflare', tier: 'paid', monthlyUsd: 5, how: 'Cloudflare dashboard → Workers & Pages → Plans' },
  { id: 'api', label: 'API servers', provider: 'Cloudflare Containers', tier: 'paid', monthlyUsd: 7, how: 'Actions → Deploy API (staging)' },
  { id: 'gateway', label: 'API front door', provider: 'Cloudflare Workers', tier: 'paid', monthlyUsd: 0, how: 'Deployed with the API (included in Workers Paid)' },
  { id: 'storage', label: 'File storage', provider: 'Cloudflare R2', tier: 'paid', monthlyUsd: 0, how: 'R2 needs a payment method; free up to 10 GB' },
];

export interface PaidHostingState {
  enabled: boolean;
  changedAt?: number;
  changedBy?: string;
}

export function hostingCost(parts: HostingPart[] = HOSTING_PARTS, paidOn: boolean): number {
  return parts.filter((p) => p.tier === 'free' || paidOn).reduce((s, p) => s + p.monthlyUsd, 0);
}
