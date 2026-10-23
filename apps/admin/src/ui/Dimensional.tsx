import { Icon, type IconName } from './Icon';

/**
 * GoBye dimensional illustrations (docs/DIMENSIONAL_ASSETS.md). Procedural 3D renders produced in-repo by
 * `tools/3d/render.py`, 320 px transparent WebP. Use sparingly: featured metrics, summaries, empty and
 * success states, introductions. Never in table rows. Decorative: hidden from screen readers.
 */
const FILES = import.meta.glob('../assets/3d/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const DIM_NAMES = [
  'sedan', 'comfort', 'xl', 'activeTrips', 'completedTrips', 'driverAvailability', 'routePin', 'navigationPath',
  'wallet', 'subscription', 'walletFunding', 'withdrawal', 'payment', 'earnings', 'refund',
  'verification', 'riderAccount', 'safetyShield', 'supportTicket', 'automation', 'server', 'cloudStorage', 'analytics',
] as const;
export type DimName = (typeof DIM_NAMES)[number];

/** Functional icon used when an asset file is missing (documented placeholder, never passed off as art). */
const FALLBACK: Record<DimName, IconName> = {
  sedan: 'car', comfort: 'car', xl: 'car', activeTrips: 'route', completedTrips: 'checkCircle', driverAvailability: 'steering', routePin: 'mapPin', navigationPath: 'route',
  wallet: 'wallet', subscription: 'ticket', walletFunding: 'wallet', withdrawal: 'bank', payment: 'exchange', earnings: 'chart', refund: 'refresh',
  verification: 'fileCheck', riderAccount: 'user', safetyShield: 'shield', supportTicket: 'headphone', automation: 'settings', server: 'server', cloudStorage: 'server', analytics: 'chart',
};

export function dimUrl(name: DimName): string | undefined {
  return FILES[`../assets/3d/${name}.webp`];
}

export function Dimensional({ name, size = 96, className = '' }: { name: DimName; size?: number; className?: string }) {
  const src = dimUrl(name);
  if (!src)
    return (
      <span className={`dim dim-placeholder ${className}`} style={{ width: size, height: size }} aria-hidden data-placeholder={name}>
        <Icon name={FALLBACK[name]} size={Math.round(size * 0.36)} />
      </span>
    );
  return <img className={`dim ${className}`} src={src} width={size} height={size} alt="" aria-hidden loading="lazy" decoding="async" draggable={false} />;
}
