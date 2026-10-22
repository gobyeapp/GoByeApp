import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Permission, PlatformDataset, StaffRole } from '@gobye/core';
import type { IconName } from '@/ui/Icon';

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
  badge?: (d: PlatformDataset, now: number) => number;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

const L = (f: () => Promise<{ default: ComponentType }>) => lazy(f);

export const NAV: NavGroup[] = [
  {
    title: 'Oversight',
    items: [
      { path: '/overview', label: 'Overview', icon: 'dashboard', anyOf: ['overview.view'], page: L(() => import('@/workspaces/overview/Overview')) },
      { path: '/approvals', label: 'Approvals', icon: 'checkCircle', anyOf: ['approvals.view'], page: L(() => import('@/workspaces/approvals/Approvals')), badge: (d) => d.approvals.filter((a) => a.status === 'pending').length },
      { path: '/staff', label: 'Staff and access', icon: 'group', anyOf: ['staff.view'], page: L(() => import('@/workspaces/staff/Staff')) },
      { path: '/audit', label: 'Activity and audit', icon: 'history', anyOf: ['audit.view'], page: L(() => import('@/workspaces/audit/Audit')) },
      { path: '/reports', label: 'Reports', icon: 'chart', anyOf: ['reports.view'], page: L(() => import('@/workspaces/finance/Reports')) },
    ],
  },
  {
    title: 'Demo',
    items: [
      // Connected demo (D-049): rider app, driver app and admin on the shared demo relay.
      { path: '/demo', label: 'Connected demo', icon: 'link', anyOf: ['overview.view', 'drivers.view', 'trips.view', 'live.view'], page: L(() => import('@/workspaces/demo/Demo')) },
    ],
  },
  {
    title: 'Operations',
    items: [
      { path: '/live', label: 'Live operations', icon: 'radar', anyOf: ['live.view'], page: L(() => import('@/workspaces/operations/Live')), badge: (d) => d.trips.filter((t) => (t.status === 'en_route' && (t.pickupDelaySeconds ?? 0) > 300) || t.status === 'searching').length },
      { path: '/trips', label: 'Trips', icon: 'route', anyOf: ['trips.view'], page: L(() => import('@/workspaces/operations/Trips')) },
      { path: '/passengers', label: 'Passengers', icon: 'user', anyOf: ['passengers.view'], page: L(() => import('@/workspaces/people/Passengers')) },
      { path: '/drivers', label: 'Drivers', icon: 'steering', anyOf: ['drivers.view'], page: L(() => import('@/workspaces/people/Drivers')), badge: (d) => d.drivers.filter((x) => x.verification === 'in_review' || x.verification === 'applied').length },
    ],
  },
  {
    title: 'Care and safety',
    items: [
      { path: '/cases', label: 'Support cases', icon: 'headphone', anyOf: ['cases.view'], page: L(() => import('@/workspaces/care/Cases')), badge: (d) => d.cases.filter((c) => c.team === 'care' && c.status === 'new').length },
      { path: '/safety', label: 'Safety', icon: 'safeAlert', anyOf: ['safety.view'], page: L(() => import('@/workspaces/safety/Safety')), badge: (d) => d.cases.filter((c) => c.team === 'safety' && c.status !== 'resolved' && c.status !== 'closed').length },
    ],
  },
  {
    title: 'Finance',
    items: [
      { path: '/finance/collections', label: 'Collections', icon: 'exchange', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Collections')) },
      { path: '/finance/wallets', label: 'Passenger wallets', icon: 'wallet', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Wallets')) },
      { path: '/finance/earnings', label: 'Driver earnings', icon: 'steering', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Earnings')) },
      { path: '/finance/withdrawals', label: 'Withdrawals', icon: 'bank', anyOf: ['withdrawals.view'], page: L(() => import('@/workspaces/finance/Withdrawals')), badge: (d) => d.withdrawals.filter((w) => w.status === 'requested' || w.status === 'under_review').length },
      { path: '/finance/refunds', label: 'Refunds and disputes', icon: 'refresh', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Refunds')) },
      { path: '/finance/settlements', label: 'Settlements', icon: 'bill', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Settlements')) },
      { path: '/finance/reconciliation', label: 'Reconciliation', icon: 'balance', anyOf: ['finance.view'], page: L(() => import('@/workspaces/finance/Reconciliation')) },
      { path: '/finance/ledger', label: 'Ledger', icon: 'list', anyOf: ['ledger.view'], page: L(() => import('@/workspaces/finance/Ledger')) },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { path: '/config/areas', label: 'Service areas', icon: 'mapPin', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/ServiceAreas')) },
      { path: '/config/categories', label: 'Vehicle categories', icon: 'car', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/Categories')) },
      { path: '/config/fares', label: 'Fare settings', icon: 'settings', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/Fares')) },
      { path: '/config/packages', label: 'Driver packages', icon: 'ticket', anyOf: ['config.view'], page: L(() => import('@/workspaces/config/Packages')) },
      { path: '/config/referrals', label: 'Rewards and referrals', icon: 'gift', anyOf: ['config.view', 'referrals.manage'], page: L(() => import('@/workspaces/config/Referrals')) },
    ],
  },
  {
    title: 'Growth',
    items: [
      { path: '/comms', label: 'Announcements', icon: 'announcement', anyOf: ['comms.view'], page: L(() => import('@/workspaces/growth/Announcements')) },
      { path: '/promos', label: 'Promotions', icon: 'layout', anyOf: ['promos.manage', 'comms.view'], page: L(() => import('@/workspaces/growth/Promotions')) },
      { path: '/events', label: 'Events and partners', icon: 'calendar', anyOf: ['events.manage', 'config.view'], page: L(() => import('@/workspaces/growth/Events')) },
    ],
  },
  {
    title: 'Technical',
    items: [
      { path: '/payments', label: 'Payments setup', icon: 'bank', anyOf: ['payments_setup.view'], page: L(() => import('@/workspaces/payments/PaymentsSetup')) },
      { path: '/developer', label: 'Integrations', icon: 'plugin', anyOf: ['integrations.view'], page: L(() => import('@/workspaces/developer/Integrations')), badge: (d) => d.integrations.filter((i) => i.state === 'degraded').length },
      { path: '/developer/events', label: 'Events and failures', icon: 'webhook', anyOf: ['logs.view'], page: L(() => import('@/workspaces/developer/EventLog')) },
      // Simulated until a backend and a live control plane exist (D-051). The page also checks roles itself.
      { path: '/infrastructure/traffic', label: 'Traffic and origins', icon: 'server', anyOf: ['integrations.view', 'audit.view', 'staff.manage'], page: L(() => import('@/workspaces/infrastructure/Traffic')) },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items);

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
