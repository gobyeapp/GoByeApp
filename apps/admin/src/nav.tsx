import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { CityId, Permission, PlatformDataset, StaffRole } from '@gobye/core';
import type { IconName } from '@/ui/Icon';
import { REVIEW_STATES } from '@/workspaces/people/logic';

/**
 * Workspace registry: one list drives the sidebar, the routes and the permission checks, so a link is
 * never shown for a page the role can't open. `anyOf`: the item shows if the staff member holds any
 * of these permissions. `badge`: count of items needing action (shown next to the link).
 */
export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  anyOf: Permission[];
  page: LazyExoticComponent<ComponentType>;
  /** Items needing action. `inScope` limits the count to the staff member's cities, like the pages do. */
  badge?: (d: PlatformDataset, now: number, inScope: (c: CityId) => boolean) => number;
  /** Words the command palette also matches (synonyms staff use). */
  keywords?: string;
}
export interface NavGroup {
  /** Empty title: the top group (Home), shown without a heading. */
  title: string;
  items: NavItem[];
  /** Show the group's pages as a secondary tab bar above each page (Finance, Settings). */
  subnav?: boolean;
}

const L = (f: () => Promise<{ default: ComponentType }>) => lazy(f);
const open = (status: string) => status !== 'resolved' && status !== 'closed';

export const NAV: NavGroup[] = [
  {
    title: '',
    items: [
      { path: '/overview', label: 'Home', icon: 'home', anyOf: ['overview.view'], page: L(() => import('@/workspaces/overview/Overview')), keywords: 'overview dashboard business command centre' },
      { path: '/approvals', label: 'Approvals', icon: 'checkCircle', anyOf: ['approvals.view'], page: L(() => import('@/workspaces/approvals/Approvals')), badge: (d) => d.approvals.filter((a) => a.status === 'pending').length, keywords: 'decisions two person maker checker' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { path: '/live', label: 'Live operations', icon: 'radar', anyOf: ['live.view'], page: L(() => import('@/workspaces/operations/Live')), badge: (d, _n, s) => d.trips.filter((t) => s(t.city) && ((t.status === 'en_route' && (t.pickupDelaySeconds ?? 0) > 300) || t.status === 'searching')).length, keywords: 'dispatch map active rides' },
      { path: '/trips', label: 'Trips', icon: 'route', anyOf: ['trips.view'], page: L(() => import('@/workspaces/operations/Trips')), keywords: 'rides bookings negotiate quick match fares' },
      // Connected demo (D-049): rider app, driver app and admin on the shared demo relay.
      { path: '/demo', label: 'Connected demo', icon: 'link', anyOf: ['overview.view', 'drivers.view', 'trips.view', 'live.view'], page: L(() => import('@/workspaces/demo/Demo')), keywords: 'relay rider app driver app test' },
    ],
  },
  {
    title: 'People',
    items: [
      { path: '/drivers', label: 'Drivers', icon: 'steering', anyOf: ['drivers.view'], page: L(() => import('@/workspaces/people/Drivers')), badge: (d, _n, s) => d.drivers.filter((x) => s(x.city) && REVIEW_STATES.includes(x.verification)).length, keywords: 'verification documents onboarding applications' },
      { path: '/passengers', label: 'Passengers', icon: 'user', anyOf: ['passengers.view'], page: L(() => import('@/workspaces/people/Passengers')), keywords: 'riders customers accounts' },
    ],
  },
  {
    title: 'Care and safety',
    items: [
      { path: '/cases', label: 'Support cases', icon: 'headphone', anyOf: ['cases.view'], page: L(() => import('@/workspaces/care/Cases')), badge: (d, _n, s) => d.cases.filter((c) => s(c.city) && c.team === 'care' && c.status === 'new').length, keywords: 'tickets complaints disputes support' },
      { path: '/safety', label: 'Safety', icon: 'safeAlert', anyOf: ['safety.view'], page: L(() => import('@/workspaces/safety/Safety')), badge: (d, _n, s) => d.cases.filter((c) => s(c.city) && c.team === 'safety' && open(c.status)).length, keywords: 'sos incidents emergency' },
    ],
  },
  {
    title: 'Finance',
    subnav: true,
    items: [
      { path: '/finance/collections', label: 'Collections', icon: 'exchange', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Collections')), keywords: 'payments received packages revenue' },
      { path: '/finance/wallets', label: 'Passenger wallets', icon: 'wallet', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Wallets')) },
      { path: '/finance/earnings', label: 'Driver earnings', icon: 'steering', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Earnings')) },
      { path: '/finance/withdrawals', label: 'Withdrawals', icon: 'bank', anyOf: ['withdrawals.view'], page: L(() => import('@/workspaces/finance/Withdrawals')), badge: (d, _n, s) => { const city = new Map(d.drivers.map((x) => [x.id, x.city])); return d.withdrawals.filter((w) => (w.status === 'requested' || w.status === 'under_review') && (!city.has(w.driverId) || s(city.get(w.driverId)!))).length; }, keywords: 'payouts' },
      { path: '/finance/refunds', label: 'Refunds and disputes', icon: 'refresh', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Refunds')) },
      { path: '/finance/settlements', label: 'Settlements', icon: 'bill', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Settlements')) },
      { path: '/finance/reconciliation', label: 'Reconciliation', icon: 'balance', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Reconciliation')) },
      { path: '/finance/ledger', label: 'Ledger', icon: 'list', anyOf: ['ledger.view'], page: L(() => import('@/workspaces/finance/Ledger')), keywords: 'accounts journal' },
    ],
  },
  {
    title: 'Growth',
    items: [
      { path: '/comms', label: 'Announcements', icon: 'announcement', anyOf: ['comms.view'], page: L(() => import('@/workspaces/growth/Announcements')), keywords: 'messages notifications broadcast' },
      { path: '/promos', label: 'Promotions', icon: 'layout', anyOf: ['promos.manage', 'comms.view'], page: L(() => import('@/workspaces/growth/Promotions')), keywords: 'promo codes campaigns banners' },
      { path: '/events', label: 'Events and partners', icon: 'calendar', anyOf: ['events.manage', 'config.view'], page: L(() => import('@/workspaces/growth/Events')) },
    ],
  },
  {
    title: 'Insights',
    items: [{ path: '/reports', label: 'Reports', icon: 'chart', anyOf: ['reports.view'], page: L(() => import('@/workspaces/finance/Reports')), keywords: 'analytics exports csv' }],
  },
  {
    title: 'Settings',
    subnav: true,
    items: [
      { path: '/config/areas', label: 'Service areas', icon: 'mapPin', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/ServiceAreas')), keywords: 'cities zones hours' },
      { path: '/config/categories', label: 'Vehicle categories', icon: 'car', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/Categories')) },
      { path: '/config/fares', label: 'Fare settings', icon: 'settings', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/Fares')), keywords: 'pricing base fare per km cancellation' },
      { path: '/config/packages', label: 'Driver packages', icon: 'ticket', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/Packages')), keywords: 'access pass subscription' },
      { path: '/config/referrals', label: 'Rewards and referrals', icon: 'gift', anyOf: ['config.view', 'referrals.manage'], page: L(() => import('@/workspaces/config/Referrals')) },
    ],
  },
  {
    title: 'Administration',
    items: [
      { path: '/staff', label: 'Staff and access', icon: 'group', anyOf: ['staff.view'], page: L(() => import('@/workspaces/staff/Staff')), keywords: 'roles permissions team invite' },
      { path: '/audit', label: 'Activity and audit', icon: 'history', anyOf: ['audit.view'], page: L(() => import('@/workspaces/audit/Audit')), keywords: 'log trail' },
    ],
  },
  {
    title: 'Technical',
    items: [
      { path: '/payments', label: 'Payments setup', icon: 'bank', anyOf: ['payments_setup.view'], page: L(() => import('@/workspaces/payments/PaymentsSetup')), keywords: 'provider paystack flutterwave go live' },
      { path: '/developer', label: 'Integrations', icon: 'plugin', anyOf: ['integrations.view'], page: L(() => import('@/workspaces/developer/Integrations')), badge: (d) => d.integrations.filter((i) => i.state === 'degraded').length },
      { path: '/developer/events', label: 'Events and failures', icon: 'webhook', anyOf: ['logs.view'], page: L(() => import('@/workspaces/developer/EventLog')), keywords: 'webhooks jobs errors' },
      // Simulated until a backend and a live control plane exist (D-051). The page also checks roles itself.
      { path: '/infrastructure/traffic', label: 'Traffic and origins', icon: 'server', anyOf: ['integrations.view', 'audit.view', 'staff.manage'], page: L(() => import('@/workspaces/infrastructure/Traffic')), keywords: 'infrastructure cloudflare failover' },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items);

/** The group a path belongs to (breadcrumb, secondary navigation). */
export const groupOf = (path: string) => NAV.find((g) => g.items.some((i) => i.path === path));

/** Each role's homepage: the screen that answers "what needs my attention?" for that job. */
export const ROLE_HOME: Record<StaffRole, string> = {
  owner: '/overview',
  admin: '/overview',
  operations: '/live',
  onboarding: '/drivers',
  care: '/cases',
  safety: '/safety',
  finance: '/finance/collections',
  marketing: '/comms',
  developer: '/developer',
  auditor: '/audit',
};
