/**
 * GoBYE website content model. Everything the page shows that can change lives here.
 *
 * Rules:
 * - Leave a field `null` until it is real. The page hides any block whose data is missing.
 * - Never put waitlist sign-ups, downloads, completed rides and active riders in the same number.
 * - Ratings need a real store listing (url). Testimonials need the customer's permission.
 * - Describe the product as planned for launch; never claim availability, safety records or speed.
 */
window.GOBYE_SITE = {
  brand: { name: 'GoBYE', logo: 'assets/logo-mark-inverse.png', logoDark: 'assets/logo-mark.png' },

  /** 'prelaunch' shows the waitlist. 'live' shows store badges, but only when both store links are set. */
  launch: { status: 'prelaunch', area: 'Nigeria', cities: ['Lagos', 'Abuja'] },

  hero: {
    headline: 'Your next move.',
    supporting: 'Request a car, agree your fare, and get moving with GoBYE.',
    cityLine: 'Coming to Nigeria.',
    ctaLabel: 'Join the waitlist',
  },

  /**
   * Photo section. Owner-supplied images (generated from the prompts in docs/PHOTO_BRIEF.md, 2026-10-22).
   * Swap in the branded shoot from docs/PHOTO_BRIEF.md by changing `photo` and `alt`; keep `pos` as the focal point.
   * The chip is a GoBYE app notification drawn over the photo, not part of the photograph.
   */
  people: {
    eyebrow: 'MADE FOR NIGERIA',
    lines: ['Built for the way', 'your city moves.'],
    tiles: [
      { photo: 'assets/people/rider.jpg', alt: 'A young woman checks her phone at a Lagos roadside at sunset, traffic behind her', title: 'Book from the roadside', chip: 'Where are you going?', pos: '30% 55%', big: true },
      { photo: 'assets/people/street.jpg', alt: 'A young man shows his phone to a smiling driver through the window of a silver car at the kerb', title: 'Meet your driver at the kerb', chip: 'Share your PIN at pickup', pos: '55% 30%', noteRight: true },
      { photo: 'assets/people/road.jpg', alt: 'A woman with a suitcase leaves a silver car at the airport as the driver waves goodbye', title: 'Pay when you arrive', chip: 'Fare agreed before you go', pos: '45% 62%' },
    ],
  },

  /** The navbar toggle switches every section below the hero between these two audiences. */
  audiences: {
    rider: {
      label: 'For riders',
      hero: { headline: 'Your next move.', supporting: 'Request a car, agree your fare, and get moving with GoBYE.', ctaLabel: 'Join the waitlist' },
      people: {
        eyebrow: 'MADE FOR NIGERIA',
        lines: ['Built for the way', 'your city moves.'],
        tiles: [
          { photo: 'assets/people/rider.jpg', alt: 'A young woman checks her phone at a Lagos roadside at sunset, traffic behind her', title: 'Book from the roadside', chip: 'Where are you going?', pos: '30% 55%', big: true },
          { photo: 'assets/people/street.jpg', alt: 'A young man shows his phone to a smiling driver through the window of a silver car at the kerb', title: 'Meet your driver at the kerb', chip: 'Share your PIN at pickup', pos: '55% 30%', noteRight: true },
          { photo: 'assets/people/road.jpg', alt: 'A woman with a suitcase leaves a silver car at the airport as the driver waves goodbye', title: 'Pay when you arrive', chip: 'Fare agreed before you go', pos: '45% 62%' },
        ],
      },
      footer: { title: 'Every journey starts with GoBYE.', supporting: 'Move around your city with confidence. Simple bookings, fares agreed upfront, and a better way to get there.', cta: 'Join the waitlist' },
      steps: {
        eyebrow: 'STEP BY STEP',
        lines: ['One app.', 'Every trip.', 'No stress.'],
        items: [
          { title: 'Set your pickup and destination', body: 'Search where you’re going, move the pickup pin, or add a note for your driver.', ui: 'assets/ui/search.jpg', alt: 'GoBYE home screen with destination search and pickup' },
          { title: 'Agree your fare first', body: 'Ride at the suggested fare with Quick Match, or offer your own price to nearby drivers.', ui: 'assets/ui/fare.jpg', alt: 'Suggested fare with Quick Match and Negotiate options' },
          { title: 'Know who’s coming', body: 'See your driver, car and plate before pickup, and share your four digit PIN to start.', ui: 'assets/ui/driver.jpg', alt: 'Driver on the way with car, plate and pickup PIN' },
          { title: 'Pay when you arrive', body: 'Pay from your GoBYE wallet or by bank transfer after the trip, then get your receipt.', ui: 'assets/ui/pay.jpg', alt: 'Trip completed screen with the amount due and payment method' },
        ],
      },
      features: {
        eyebrow: 'ADDITIONAL FEATURES',
        lines: ['Everything a trip needs,', 'in one place.'],
        items: [
          { title: 'Book for someone else', body: 'Send a ride to family or a friend.', frag: 'assets/ui/feat/r-someone.webp', art: 'assets/ui/sedan.webp' },
          { title: 'Saved places', body: 'Home, Work and favourites, one tap away.', frag: 'assets/ui/feat/r-places.webp', art: 'assets/ui/destination.webp' },
          { title: 'Pickup notes', body: 'Tell your driver exactly where to find you.', frag: 'assets/ui/feat/r-note.webp' },
          { title: 'Invite friends', body: 'Earn rewards when friends take their first paid trip.', frag: 'assets/ui/feat/r-invite.webp', art: 'assets/ui/reward-gift.webp' },
        ],
      },
      safety: {
        eyebrow: 'SAFETY',
        lines: ['Safe from pickup', 'to drop off.'],
        items: [
          { title: 'Verified drivers', body: 'Documents checked before anyone drives. See your driver, car and plate before pickup.', frag: 'assets/ui/feat/r-driver.webp', art: 'assets/ui/sedan.webp' },
          { title: 'Pickup PIN', body: 'Your trip starts only when your driver has your PIN.', frag: 'assets/ui/feat/r-pin.webp' },
          { title: 'Help on every trip', body: 'Call 112, report an issue or share your trip from the trip screen.', frag: 'assets/ui/feat/r-help.webp' },
        ],
      },
      statement: 'Getting around Nigeria shouldn’t mean arguing over the fare at the roadside. With GoBYE you agree it before you go, and pay only when you arrive.',
      compare: {
        eyebrow: 'DESIGNED FOR RIDERS, NOT ROADSIDE HAGGLING',
        lines: ['A better trip,', 'from booking to receipt.'],
        old: { title: 'Hailing on the street', tag: 'Fare argued at the roadside', frag: 'assets/ui/feat/r-haggle.webp', items: ['Price argued every trip', 'No record of who is driving', 'Cash in hand only', 'No receipt afterwards', 'Hard to arrange a ride for someone else'] },
        ours: { tag: 'Fare agreed before you book', sub: 'Everything you need, from booking to receipt.', frag: 'assets/ui/feat/r-fare.webp', items: ['Suggested fare before you book', 'Quick Match or offer your own fare', 'Driver, car and plate before pickup', 'Pickup PIN to start every trip', 'Pay after the trip, wallet or bank transfer', 'Book rides for family and friends', 'A receipt for every paid trip'], highlightLast: 3 },
      },
      banner: { headline: 'See where GoBYE can take you', supporting: 'Coming to Nigeria. Join the waitlist to hear first.' },
    },
    driver: {
      label: 'For drivers',
      hero: { headline: 'Drive more. Keep it all.', supporting: 'See the fare before you accept, keep every naira you earn, and pay no commission on your trips.', ctaLabel: 'Join as a driver',
        /** The driver hero shows this photograph instead of the rider video (owner, 2026-10-23). */
        photo: true },
      people: {
        eyebrow: 'MADE FOR DRIVERS',
        lines: ['Your car, your hours,', 'your earnings.'],
        tiles: [
          { photo: 'assets/people/street.jpg', alt: 'A smiling driver in a silver car greets a passenger at the kerb', title: 'Pick up riders near you', chip: 'Ask for the PIN to start', pos: '55% 30%', big: true },
          { photo: 'assets/people/road.jpg', alt: 'A driver waves goodbye as a passenger leaves the car at the airport', title: 'Finish the trip, keep the fare', chip: '₦0 commission on this trip', pos: '45% 62%', noteRight: true },
          { photo: 'assets/people/rider.jpg', alt: 'A rider at a Lagos roadside books a trip on her phone', title: 'Requests with the fare shown', chip: 'Agreed fare shown upfront', pos: '30% 55%' },
        ],
      },
      footer: { title: 'Every trip pays you in full.', supporting: 'Drive with GoBYE: no commission on your trips, fares agreed upfront, and earnings sent to your bank.', cta: 'Join as a driver' },
      steps: {
        eyebrow: 'STEP BY STEP',
        lines: ['Your car.', 'Your fares.', 'Your earnings.'],
        items: [
          { title: 'Apply and get verified', body: 'Share your licence, vehicle papers and insurance. We check them before you drive.', ui: 'assets/ui/drv-verify.jpg', alt: 'GoBYE Driver documents screen with each document’s review status' },
          { title: 'Choose daily or monthly access', body: 'Buy a simple pass to go online. GoBYE takes no commission from your trips.', ui: 'assets/ui/drv-pass.jpg', alt: 'GoBYE Driver screen for choosing a daily or monthly pass' },
          { title: 'See the fare before you accept', body: 'Take trips at the agreed fare, or reply to a passenger’s offer with your own price.', ui: 'assets/ui/drv-request.jpg', alt: 'GoBYE Driver trip request with the agreed fare shown' },
          { title: 'Keep the full fare', body: 'Passengers pay through GoBYE and your earnings go to your verified bank account.', ui: 'assets/ui/drv-earnings.jpg', alt: 'GoBYE Driver trip completed screen with ₦0 commission' },
        ],
      },
      features: {
        eyebrow: 'ADDITIONAL FEATURES',
        lines: ['Built for the way', 'you drive.'],
        items: [
          { title: 'Daily or monthly pass', body: 'Pick the access that fits your week.', frag: 'assets/ui/feat/d-pass.webp', art: 'assets/ui/wallet.webp' },
          { title: 'Fare first', body: 'Every request shows the fare before you accept.', frag: 'assets/ui/feat/d-fare.webp', art: 'assets/ui/sedan.webp' },
          { title: 'Counter offers', body: 'Reply to a passenger’s offer with your price.', frag: 'assets/ui/feat/d-counter.webp' },
          { title: 'Earnings at a glance', body: 'See what you made from every trip.', frag: 'assets/ui/feat/d-earn.webp' },
        ],
      },
      safety: {
        eyebrow: 'SAFETY',
        lines: ['Safer trips,', 'on your terms.'],
        items: [
          { title: 'Confirm every passenger', body: 'Start the trip only with the passenger’s four digit PIN.', frag: 'assets/ui/feat/d-pin.webp' },
          { title: 'Fare agreed upfront', body: 'The price is set before you accept, so there is nothing to argue about.', frag: 'assets/ui/feat/d-fare.webp' },
          { title: 'Less cash to carry', body: 'Passengers pay by GoBYE wallet or bank transfer.', frag: 'assets/ui/feat/d-paid.webp', art: 'assets/ui/wallet.webp' },
        ],
      },
      statement: 'Drivers should keep what they earn. GoBYE takes no commission from your trips: you buy simple daily or monthly access, and the fare is yours.',
      compare: {
        eyebrow: 'DESIGNED FOR DRIVERS, NOT COMMISSION',
        lines: ['Keep more of', 'every fare.'],
        old: { title: 'Commission per trip', tag: 'A share of every fare', frag: 'assets/ui/feat/d-commission.webp', items: ['Part of each fare goes to the platform', 'The more you drive, the more you pay', 'Fares set without your say', 'Hard to plan your week', 'Less left at the end of a long day'] },
        ours: { tag: '0% commission', sub: 'Keep the full fare on every trip.', frag: 'assets/ui/feat/d-earn.webp', items: ['No commission on your trips', 'Daily or monthly access', 'See the fare before you accept', 'Counter offers to passengers', 'PIN check at pickup', 'Earnings to your verified bank', 'Simple weekly planning'], highlightLast: 3 },
      },
      banner: { headline: 'Drive with GoBYE', supporting: 'Coming to Nigeria. Join the waitlist to be first to apply.' },
    },
  },

  waitlist: {
    /**
     * Supabase project that stores sign ups in `public.waitlist` (supabase/migrations/20261022_waitlist.sql).
     * Only the PUBLIC anon key belongs here. Row level security lets it insert and nothing else.
     * Never put the service_role key in this file: the website is public.
     */
    supabase: {
      url: 'https://morqitxqsfiprefczduo.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vcnFpdHhxc2ZpcHJlZmN6ZHVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NjY1MTMsImV4cCI6MjEwODI0MjUxM30.iWSsufXrwvrWxBgxchdajxYKBpJmTeXekn198KIWRg4',
      table: 'waitlist',
    },
    /** Alternative: any POST endpoint that answers 2xx only once the sign up is stored. Used when supabase is not set. */
    endpoint: null,
    cities: ['Lagos', 'Abuja', 'Another city'],
    /** Shown when "Another city" is picked: the other 35 states (Lagos and the FCT have their own tiles). */
    otherStates: ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'],
  },

  /** Official store listings. Badges appear only when status is 'live' and both urls are real. */
  stores: {
    appStore: { url: null, badge: 'assets/badges/app-store.svg' },
    googlePlay: { url: null, badge: 'assets/badges/google-play.png' },
  },

  /** Desktop QR card. Hidden until it has a real destination and a caption that names it. */
  qr: { url: null, caption: null },

  /** Founder card in the final banner. Hidden until name, title and photo are real and approved. */
  founder: { name: null, title: null, photo: null, pitch: null, callUrl: null, x: null, linkedin: null },

  /** Footer. Links render only when they have a real url. */
  footer: {
    contactEmail: null,
    privacyUrl: null,
    termsUrl: null,
    social: { instagram: null, linkedin: null, x: null },
  },

  trust: {
    prelaunch: {
      eyebrow: 'MEET GOBYE',
      heading: 'A better way to make your next move.',
      supporting: 'Coming soon across Nigeria.',
      cards: [
        { icon: 'fare', title: 'Choose your fare', body: 'Quick Match or negotiate before your trip.' },
        { icon: 'someone', title: 'Book for someone else', body: 'Arrange a ride for a friend or family member.' },
        { icon: 'pay', title: 'Pay with less hassle', body: 'Access supported payment options within GoBYE.' },
      ],
    },
    /** Replaces the prelaunch block once ANY of these is verified. Unverified fields stay null and their blocks stay hidden. */
    verified: {
      eyebrow: 'RIDERS TRUST GOBYE',
      riderCount: { value: null, label: null, definition: null, asOf: null },
      /** { platform: 'App Store' | 'Google Play', rating: 4.8, reviews: 1200, url: 'https://…' } */
      ratings: [],
      /** { quote, name, date, location?, photo?, permission: true } — permission must be true to show. */
      testimonials: [],
    },
  },
};
