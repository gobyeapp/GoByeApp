import { createElement, type SVGProps } from 'react';
import AddIcon from '@mingcute/icons/core-regular/add';
import AlarmIcon from '@mingcute/icons/core-regular/alarm-2';
import AlertIcon from '@mingcute/icons/core-regular/alert-octagon';
import AnnouncementIcon from '@mingcute/icons/core-regular/announcement';
import ArrowRightIcon from '@mingcute/icons/core-regular/arrow-right';
import BalanceIcon from '@mingcute/icons/core-regular/balance';
import BankIcon from '@mingcute/icons/core-regular/bank';
import BellIcon from '@mingcute/icons/core-regular/notification';
import BillIcon from '@mingcute/icons/core-regular/bill';
import CalendarIcon from '@mingcute/icons/core-regular/calendar';
import CarIcon from '@mingcute/icons/core-regular/car';
import ChartBarIcon from '@mingcute/icons/core-regular/chart-bar';
import ChatIcon from '@mingcute/icons/core-regular/chat-3';
import CheckIcon from '@mingcute/icons/core-regular/check';
import CheckCircleIcon from '@mingcute/icons/core-regular/check-circle';
import CloseIcon from '@mingcute/icons/core-regular/close';
import CodeIcon from '@mingcute/icons/core-regular/code';
import CopyIcon from '@mingcute/icons/core-regular/copy-2';
import DashboardIcon from '@mingcute/icons/core-regular/dashboard-2';
import DocumentIcon from '@mingcute/icons/core-regular/document-2';
import DownIcon from '@mingcute/icons/core-regular/down-small';
import DownloadIcon from '@mingcute/icons/core-regular/download-2';
import EditIcon from '@mingcute/icons/core-regular/edit-2';
import ExchangeIcon from '@mingcute/icons/core-regular/exchange-dollar';
import ExitIcon from '@mingcute/icons/core-regular/exit';
import EyeIcon from '@mingcute/icons/core-regular/eye';
import FileCheckIcon from '@mingcute/icons/core-regular/file-check';
import FilterIcon from '@mingcute/icons/core-regular/filter-2';
import FlagIcon from '@mingcute/icons/core-regular/flag-1';
import GiftIcon from '@mingcute/icons/core-regular/gift';
import GroupIcon from '@mingcute/icons/core-regular/group-3';
import HeadphoneIcon from '@mingcute/icons/core-regular/headphone';
import HistoryIcon from '@mingcute/icons/core-regular/history';
import HomeIcon from '@mingcute/icons/core-regular/home-4';
import InfoIcon from '@mingcute/icons/core-regular/information';
import KeyIcon from '@mingcute/icons/core-regular/key-2';
import LayoutIcon from '@mingcute/icons/core-regular/layout-grid';
import LeftIcon from '@mingcute/icons/core-regular/left-small';
import LinkIcon from '@mingcute/icons/core-regular/link';
import ListIcon from '@mingcute/icons/core-regular/list-check-3';
import LockIcon from '@mingcute/icons/core-regular/lock';
import MailIcon from '@mingcute/icons/core-regular/mail';
import MapPinIcon from '@mingcute/icons/core-regular/map-pin';
import MoonIcon from '@mingcute/icons/core-regular/moon';
import MoreIcon from '@mingcute/icons/core-regular/more-2';
import PhoneIcon from '@mingcute/icons/core-regular/phone';
import PluginIcon from '@mingcute/icons/core-regular/plugin-2';
import RadarIcon from '@mingcute/icons/core-regular/radar-2';
import RefreshIcon from '@mingcute/icons/core-regular/refresh-2';
import RightIcon from '@mingcute/icons/core-regular/right-small';
import RouteIcon from '@mingcute/icons/core-regular/route';
import SafeAlertIcon from '@mingcute/icons/core-regular/safe-alert';
import SearchIcon from '@mingcute/icons/core-regular/search-2';
import ServerIcon from '@mingcute/icons/core-regular/server';
import SettingsIcon from '@mingcute/icons/core-regular/settings-3';
import ShieldIcon from '@mingcute/icons/core-regular/shield';
import StarIcon from '@mingcute/icons/core-regular/star';
import SteeringIcon from '@mingcute/icons/core-regular/steering-wheel';
import SunIcon from '@mingcute/icons/core-regular/sun';
import TicketIcon from '@mingcute/icons/core-regular/ticket';
import TimeIcon from '@mingcute/icons/core-regular/time';
import UserIcon from '@mingcute/icons/core-regular/user-3';
import UserAddIcon from '@mingcute/icons/core-regular/user-add';
import UserForbidIcon from '@mingcute/icons/core-regular/user-forbid';
import WalletIcon from '@mingcute/icons/core-regular/wallet-4';
import WarningIcon from '@mingcute/icons/core-regular/warning';
import WebhookIcon from '@mingcute/icons/core-regular/webhook';
import QuestionIcon from '@mingcute/icons/core-regular/question';
import ReceiptIcon from '@mingcute/icons/core-regular/bill-2';
import CloudIcon from '@mingcute/icons/core-regular/cloud';
import UploadIcon from '@mingcute/icons/core-regular/upload-2';
import StoreIcon from '@mingcute/icons/core-regular/store';
import ComputerIcon from '@mingcute/icons/core-regular/computer';
import MenuIcon from '@mingcute/icons/core-regular/menu';
import SidebarCloseIcon from '@mingcute/icons/core-regular/layout-leftbar-close';
import SidebarOpenIcon from '@mingcute/icons/core-regular/layout-leftbar-open';
import CommandIcon from '@mingcute/icons/core-regular/command';
import UpIcon from '@mingcute/icons/core-regular/up-small';
import SortAscIcon from '@mingcute/icons/core-regular/sort-ascending';
import SortDescIcon from '@mingcute/icons/core-regular/sort-descending';
import EnterIcon from '@mingcute/icons/core-regular/corner-down-left';

import DashboardFilled from '@mingcute/icons/core-filled/dashboard-2';
import CheckCircleFilled from '@mingcute/icons/core-filled/check-circle';
import GroupFilled from '@mingcute/icons/core-filled/group-3';
import HistoryFilled from '@mingcute/icons/core-filled/history';
import ChartFilled from '@mingcute/icons/core-filled/chart-bar';
import LinkFilled from '@mingcute/icons/core-filled/link';
import RadarFilled from '@mingcute/icons/core-filled/radar-2';
import RouteFilled from '@mingcute/icons/core-filled/route';
import UserFilled from '@mingcute/icons/core-filled/user-3';
import SteeringFilled from '@mingcute/icons/core-filled/steering-wheel';
import HeadphoneFilled from '@mingcute/icons/core-filled/headphone';
import SafeAlertFilled from '@mingcute/icons/core-filled/safe-alert';
import ExchangeFilled from '@mingcute/icons/core-filled/exchange-dollar';
import WalletFilled from '@mingcute/icons/core-filled/wallet-4';
import BankFilled from '@mingcute/icons/core-filled/bank';
import RefreshFilled from '@mingcute/icons/core-filled/refresh-2';
import BillFilled from '@mingcute/icons/core-filled/bill';
import BalanceFilled from '@mingcute/icons/core-filled/balance';
import ListFilled from '@mingcute/icons/core-filled/list-check-3';
import MapPinFilled from '@mingcute/icons/core-filled/map-pin';
import CarFilled from '@mingcute/icons/core-filled/car';
import SettingsFilled from '@mingcute/icons/core-filled/settings-3';
import TicketFilled from '@mingcute/icons/core-filled/ticket';
import GiftFilled from '@mingcute/icons/core-filled/gift';
import AnnouncementFilled from '@mingcute/icons/core-filled/announcement';
import LayoutFilled from '@mingcute/icons/core-filled/layout-grid';
import CalendarFilled from '@mingcute/icons/core-filled/calendar';
import PluginFilled from '@mingcute/icons/core-filled/plugin-2';
import WebhookFilled from '@mingcute/icons/core-filled/webhook';
import ServerFilled from '@mingcute/icons/core-filled/server';
import HomeFilled from '@mingcute/icons/core-filled/home-4';

/**
 * MingCute (Core Regular) for the web admin: the same official icon set as the apps, from the
 * framework-neutral `@mingcute/icons` definitions (D-037). Decorative by default (aria-hidden).
 */
const ICONS = {
  add: AddIcon, alarm: AlarmIcon, alert: AlertIcon, announcement: AnnouncementIcon, arrowRight: ArrowRightIcon, balance: BalanceIcon, bank: BankIcon,
  bell: BellIcon, bill: BillIcon, calendar: CalendarIcon, car: CarIcon, chart: ChartBarIcon, chat: ChatIcon, check: CheckIcon, checkCircle: CheckCircleIcon,
  close: CloseIcon, code: CodeIcon, copy: CopyIcon, dashboard: DashboardIcon, document: DocumentIcon, down: DownIcon, download: DownloadIcon, edit: EditIcon,
  exchange: ExchangeIcon, exit: ExitIcon, eye: EyeIcon, fileCheck: FileCheckIcon, filter: FilterIcon, flag: FlagIcon, gift: GiftIcon, group: GroupIcon,
  headphone: HeadphoneIcon, history: HistoryIcon, home: HomeIcon, info: InfoIcon, key: KeyIcon, layout: LayoutIcon, left: LeftIcon, link: LinkIcon,
  list: ListIcon, lock: LockIcon, mail: MailIcon, mapPin: MapPinIcon, moon: MoonIcon, more: MoreIcon, phone: PhoneIcon, plugin: PluginIcon, radar: RadarIcon,
  refresh: RefreshIcon, right: RightIcon, route: RouteIcon, safeAlert: SafeAlertIcon, search: SearchIcon, server: ServerIcon, settings: SettingsIcon,
  shield: ShieldIcon, star: StarIcon, steering: SteeringIcon, sun: SunIcon, ticket: TicketIcon, time: TimeIcon, user: UserIcon, userAdd: UserAddIcon,
  userForbid: UserForbidIcon, wallet: WalletIcon, warning: WarningIcon, webhook: WebhookIcon,
  question: QuestionIcon, receipt: ReceiptIcon, cloud: CloudIcon, upload: UploadIcon, store: StoreIcon, computer: ComputerIcon, menu: MenuIcon, sidebarClose: SidebarCloseIcon, sidebarOpen: SidebarOpenIcon, command: CommandIcon, up: UpIcon, sortAsc: SortAscIcon, sortDesc: SortDescIcon, enter: EnterIcon,
} as const;

export type IconName = keyof typeof ICONS;

/** Core Filled variants, used for the selected navigation item (brief: filled = selected). */
const FILLED: Partial<Record<IconName, unknown>> = {
  dashboard: DashboardFilled, checkCircle: CheckCircleFilled, group: GroupFilled, history: HistoryFilled, chart: ChartFilled, link: LinkFilled, radar: RadarFilled, route: RouteFilled, user: UserFilled, steering: SteeringFilled, headphone: HeadphoneFilled, safeAlert: SafeAlertFilled, exchange: ExchangeFilled, wallet: WalletFilled, bank: BankFilled, refresh: RefreshFilled, bill: BillFilled, balance: BalanceFilled, list: ListFilled, mapPin: MapPinFilled, car: CarFilled, settings: SettingsFilled, ticket: TicketFilled, gift: GiftFilled, announcement: AnnouncementFilled, layout: LayoutFilled, calendar: CalendarFilled, plugin: PluginFilled, webhook: WebhookFilled, server: ServerFilled, home: HomeFilled,
};
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

type Def = { viewBox: string; elements: { tag: string; attributes: Record<string, string> }[] };
const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export function Icon({ name, size = 18, label, filled, ...rest }: { name: IconName; size?: number; label?: string; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const def = ((filled && FILLED[name]) || ICONS[name]) as unknown as Def;
  return (
    <svg width={size} height={size} viewBox={def.viewBox} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} {...rest}>
      {def.elements.map((el, i) => createElement(el.tag, { key: i, ...Object.fromEntries(Object.entries(el.attributes).map(([k, v]) => [camel(k), v])) }))}
    </svg>
  );
}
