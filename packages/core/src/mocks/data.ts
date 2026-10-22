import { naira } from '../money';
import type {
  AppNotification,
  Kobo,
  Referral,
  DriverSummary,
  LatLng,
  PaymentMethod,
  Place,
  SavedPlace,
  Vehicle,
  VehicleCategoryId,
  WalletTransaction,
} from '../types';

/**
 * MOCK DATA — public Lagos and Abuja landmarks with approximate coordinates, invented drivers.
 * Nothing here represents real people, vehicles or live availability.
 */

export const LAGOS_DEFAULT_LOCATION: LatLng = { latitude: 6.5095, longitude: 3.3711 }; // Yaba (approx.)
export const ABUJA_DEFAULT_LOCATION: LatLng = { latitude: 9.0579, longitude: 7.4951 }; // Central Area (approx.)

export const MOCK_PLACES: Place[] = [
  { id: 'p-icm', title: 'Ikeja City Mall', subtitle: 'Obafemi Awolowo Way, Alausa, Ikeja', coordinate: { latitude: 6.6142, longitude: 3.3581 } },
  { id: 'p-mmia', title: 'Murtala Muhammed International Airport', subtitle: 'Airport Road, Ikeja', coordinate: { latitude: 6.5774, longitude: 3.3212 } },
  { id: 'p-lcc', title: 'Lekki Conservation Centre', subtitle: 'Lekki Epe Expressway, Lekki', coordinate: { latitude: 6.4413, longitude: 3.5357 } },
  { id: 'p-nt', title: 'National Theatre', subtitle: 'Iganmu, Surulere', coordinate: { latitude: 6.4757, longitude: 3.377 } },
  { id: 'p-unilag', title: 'University of Lagos', subtitle: 'Akoka, Yaba', coordinate: { latitude: 6.5158, longitude: 3.3896 } },
  { id: 'p-tbs', title: 'Tafawa Balewa Square', subtitle: 'Lagos Island', coordinate: { latitude: 6.4489, longitude: 3.3988 } },
  { id: 'p-fp', title: 'Freedom Park', subtitle: 'Broad Street, Lagos Island', coordinate: { latitude: 6.4494, longitude: 3.3954 } },
  { id: 'p-palms', title: 'The Palms Shopping Mall', subtitle: 'Lekki Phase 1', coordinate: { latitude: 6.4354, longitude: 3.4497 } },
  { id: 'p-falomo', title: 'Falomo Shopping Centre', subtitle: 'Awolowo Road, Ikoyi', coordinate: { latitude: 6.4421, longitude: 3.4302 } },
  { id: 'p-maryland', title: 'Maryland Mall', subtitle: 'Ikorodu Road, Maryland', coordinate: { latitude: 6.5717, longitude: 3.3672 } },
  { id: 'p-oshodi', title: 'Oshodi Transport Interchange', subtitle: 'Oshodi', coordinate: { latitude: 6.5537, longitude: 3.3434 } },
  { id: 'p-teslim', title: 'Teslim Balogun Stadium', subtitle: 'Surulere', coordinate: { latitude: 6.4985, longitude: 3.3627 } },
  { id: 'p-tejuosho', title: 'Tejuosho Market', subtitle: 'Ojuelegba Road, Yaba', coordinate: { latitude: 6.5076, longitude: 3.3711 } },
  { id: 'p-eko', title: 'Eko Atlantic', subtitle: 'Victoria Island', coordinate: { latitude: 6.4062, longitude: 3.406 } },
  { id: 'p-cms', title: 'CMS Bus Terminal', subtitle: 'Marina, Lagos Island', coordinate: { latitude: 6.4519, longitude: 3.3923 } },
  // Abuja (approximate public landmarks) — for validating pickup accuracy in both launch candidates (Q-007).
  { id: 'a-nnamdi', title: 'Nnamdi Azikiwe International Airport', subtitle: 'Airport Road, Abuja', coordinate: { latitude: 9.0068, longitude: 7.2632 } },
  { id: 'a-jabi', title: 'Jabi Lake Mall', subtitle: 'Bala Sokoto Way, Jabi, Abuja', coordinate: { latitude: 9.0656, longitude: 7.4239 } },
  { id: 'a-wuse', title: 'Wuse Market', subtitle: 'Wuse Zone 5, Abuja', coordinate: { latitude: 9.0745, longitude: 7.4686 } },
  { id: 'a-mosque', title: 'Abuja National Mosque', subtitle: 'Independence Avenue, Central Area, Abuja', coordinate: { latitude: 9.0597, longitude: 7.4898 } },
  { id: 'a-eagle', title: 'Eagle Square', subtitle: 'Shehu Shagari Way, Central Area, Abuja', coordinate: { latitude: 9.0561, longitude: 7.5006 } },
  { id: 'a-millennium', title: 'Millennium Park', subtitle: 'Maitama, Abuja', coordinate: { latitude: 9.0735, longitude: 7.5036 } },
  { id: 'a-ceddi', title: 'Ceddi Plaza', subtitle: 'Central Business District, Abuja', coordinate: { latitude: 9.0563, longitude: 7.487 } },
];

export const MOCK_SAVED_PLACES: SavedPlace[] = [
  { ...MOCK_PLACES[4], id: 'sp-home', label: 'home', name: 'Home' },
  { ...MOCK_PLACES[8], id: 'sp-work', label: 'work', name: 'Work' },
];

export const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pm-wallet', type: 'wallet', label: 'GoBye Wallet' },
  { id: 'pm-transfer', type: 'bank_transfer', label: 'Bank transfer' },
  // Cash is an open decision (Q-001) — present in data, hidden while disabled in MOCK_PAYMENTS_CONFIG.
  { id: 'pm-cash', type: 'cash', label: 'Cash' },
];

const VEHICLES: Record<VehicleCategoryId, Omit<Vehicle, 'plate'>[]> = {
  keke: [
    { make: 'TVS', model: 'King', colour: 'Yellow', year: 2022, category: 'keke' },
    { make: 'Bajaj', model: 'RE', colour: 'Yellow', year: 2021, category: 'keke' },
  ],
  go: [
    { make: 'Toyota', model: 'Corolla', colour: 'Silver', year: 2014, category: 'go' },
    { make: 'Honda', model: 'Accord', colour: 'Black', year: 2013, category: 'go' },
    { make: 'Hyundai', model: 'Elantra', colour: 'White', year: 2016, category: 'go' },
  ],
  comfort: [
    { make: 'Toyota', model: 'Camry', colour: 'Grey', year: 2019, category: 'comfort' },
    { make: 'Lexus', model: 'ES 350', colour: 'Black', year: 2018, category: 'comfort' },
  ],
  xl: [
    { make: 'Toyota', model: 'Sienna', colour: 'Blue', year: 2015, category: 'xl' },
    { make: 'Honda', model: 'Odyssey', colour: 'Silver', year: 2016, category: 'xl' },
  ],
};

const FIRST_NAMES = ['Chinedu', 'Aisha', 'Tunde', 'Emeka', 'Ngozi', 'Bayo', 'Kemi', 'Ifeanyi', 'Musa', 'Funmi', 'Segun', 'Halima'];
const LAST_INITIALS = ['O.', 'A.', 'B.', 'E.', 'I.', 'M.', 'N.', 'U.'];
const DEMO_BANKS = ['GoBye Demo Bank', 'Preview Microfinance Bank'];
const PLATE_PREFIXES = ['KJA', 'LND', 'EKY', 'APP', 'FKJ', 'SMK'];
const PLATE_SUFFIXES = ['AB', 'KJ', 'XA', 'BG', 'LA', 'DE'];

/** Deterministic pseudo-random generator so mock data is reproducible in tests. */
export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function makeMockDriver(index: number, category: VehicleCategoryId, near: LatLng, rand: () => number): DriverSummary {
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const vehicle = pick(VEHICLES[category]);
  const plate = `${pick(PLATE_PREFIXES)} ${100 + Math.floor(rand() * 899)} ${pick(PLATE_SUFFIXES)}`;
  return {
    id: `drv-${category}-${index}-${Math.floor(rand() * 1e6)}`,
    firstName: FIRST_NAMES[index % FIRST_NAMES.length],
    lastName: pick(LAST_INITIALS),
    // Simulated account — not a real bank account (bank-transfer flow, brief §9).
    payoutAccount: {
      bankName: `${pick(DEMO_BANKS)} (simulated)`,
      accountNumber: `90${String(10_000_000 + Math.floor(rand() * 89_999_999))}`,
      accountName: `${FIRST_NAMES[index % FIRST_NAMES.length]} (Driver), Preview`,
    },
    rating: Math.round((4.3 + rand() * 0.69) * 100) / 100,
    completedTrips: 80 + Math.floor(rand() * 2400),
    vehicle: { ...vehicle, plate },
    coordinate: {
      latitude: near.latitude + (rand() - 0.5) * 0.03,
      longitude: near.longitude + (rand() - 0.5) * 0.03,
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function mockWalletTransactions(now: number): WalletTransaction[] {
  return [
    { id: 'wt-1', type: 'top_up', status: 'successful', amount: naira(15000), createdAt: now - 6 * DAY, description: 'Deposit by bank transfer' },
    { id: 'wt-2', type: 'ride_payment', status: 'successful', amount: naira(-2350), createdAt: now - 5 * DAY, description: 'Trip to Ikeja City Mall' },
    { id: 'wt-3', type: 'top_up', status: 'failed', amount: naira(3000), createdAt: now - 4 * DAY, description: 'Deposit by bank transfer' },
    { id: 'wt-4', type: 'ride_payment', status: 'reversed', amount: naira(-1500), createdAt: now - 2 * DAY, description: 'Trip to Wuse Market' },
    { id: 'wt-5', type: 'ride_payment', status: 'successful', amount: naira(-1800), createdAt: now - 1 * DAY, description: 'Trip to Tejuosho Market' },
  ];
}

export function mockNotifications(now: number): AppNotification[] {
  return [
    { id: 'n-1', kind: 'account', title: 'Welcome to GoBye', body: 'Ride at the suggested fare, or offer your own.', createdAt: now - 2 * 60 * 1000, read: false },
    { id: 'n-2', kind: 'safety', title: 'Ride safely', body: 'Check the plate and driver name before you get in.', createdAt: now - DAY, read: false },
    { id: 'n-3', kind: 'promo', title: 'Invite friends', body: 'Share your code. Preview rewards are simulated.', createdAt: now - 3 * DAY, read: true },
  ];
}

/** Simulated referral activity (brief §12). Amounts come from the referral config, never hard-coded promises. */
export function mockReferrals(now: number, reward: Kobo): Referral[] {
  return [
    { id: 'rf-1', name: 'Ada N.', status: 'rewarded', invitedAt: now - 12 * DAY, updatedAt: now - 5 * DAY, reward },
    { id: 'rf-2', name: 'Kunle B.', status: 'qualified', invitedAt: now - 6 * DAY, updatedAt: now - 1 * DAY, reward },
    { id: 'rf-5', name: 'Emeka O.', status: 'qualifying', invitedAt: now - 3 * DAY, updatedAt: now - 1 * DAY },
    { id: 'rf-3', name: 'Zainab M.', status: 'invited', invitedAt: now - 2 * DAY, updatedAt: now - 2 * DAY },
    { id: 'rf-4', name: 'Tobi E.', status: 'expired', invitedAt: now - 40 * DAY, updatedAt: now - 10 * DAY },
  ];
}
