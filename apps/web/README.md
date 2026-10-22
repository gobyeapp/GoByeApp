# GoBYE website (`apps/web`)

Static landing page: hero video, sticky navbar with a riders/drivers toggle, pinned step cards,
feature carousel, social proof (verified only), scroll-fill statement, comparison, final banner and footer. No build step: open `index.html` from any static host.

```bash
cd apps/web && python3 -m http.server 8130   # then open http://localhost:8130
```

| File | What it is |
|---|---|
| `index.html` | Page markup. Text in `data-text` elements comes from the content model. |
| `site.config.js` | **Content model**: copy, launch status, store links, waitlist endpoint, QR card, verified trust data. Edit this, not the markup. |
| `app.js` | Renders the config, the waitlist dialog, store badges, QR card and trust/social proof. |
| `styles.css` | Styles. DM Sans below the hero (the hero keeps Plus Jakarta Sans), white and #F4F4F4 sections, aubergine/tangerine brand gradient. |
| `icons.js` | MingCute Core icons (Apache-2.0), generated from `@mingcute/icons`. |
| `components.html` | Internal preview of the verified social-proof components with labelled placeholders. `noindex`; not linked from the page. |
| `assets/` | Hero video (`hero.mp4`, `hero.webm`, poster), working logo marks, `ui/` app crops and 3D renders for the steps and features. |

## Before publishing

1. **Hero video.** `assets/hero.mp4` is the owner's uploaded video, used unchanged (Q-062 for final footage).
8. **Rider/driver content.** `audiences.rider` and `audiences.driver` hold the steps, features, statement, comparison and banner. Driver steps have no screenshots until the driver app exists.
9. **Founder and footer.** Fill `founder` (name, title, approved photo) to show the founder card; fill `footer` links and socials to show them. Empty fields stay hidden.
2. **Waitlist.** Sign ups go to Supabase (`waitlist.supabase`, anon key only). Run `supabase/migrations/20261022_waitlist.sql` once in the Supabase SQL Editor. Read sign ups in Table Editor → waitlist. Never put the service_role key in this folder.
3. **Privacy.** The form collects email addresses: link a privacy notice and keep consent records before going live (Nigeria Data Protection Act 2023; OPEN_QUESTIONS Q-063).
4. **Launch.** Set `launch.status` to `'live'` and both store `url`s, and add the official badge artwork to `assets/badges/`. Badges replace the waitlist button only when both links are real.
5. **QR card (optional, desktop only).** Set `qr.url` and a `qr.caption` that names where it goes.
6. **Trust.** Fill `trust.verified` only with verified data: a rider count needs its `label` and `definition`; ratings need the store `url`; testimonials need `permission: true`. Anything missing stays hidden, and the prelaunch block shows until something is verified.
7. **Logo.** Replace `assets/logo-mark-inverse.png` (working concept) with the vector master when supplied.
