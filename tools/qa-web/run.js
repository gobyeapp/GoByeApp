// QA harness: drives the GoBye Rider web build through its flows and, at each stable state,
// captures every viewport width in light and dark, checking for horizontal overflow.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');

const WIDTHS = [[320, 568], [360, 740], [375, 667], [390, 844], [393, 852], [402, 874], [414, 896], [430, 932], [440, 956], [480, 1000]];
const ONLY = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : null;
const OUT = (process.env.SHOTS || '/tmp/qa-shots');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function overflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const issues = [];
    const doc = document.documentElement.scrollWidth > vw + 1;
    const scrollAncestor = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (['auto', 'scroll'].includes(s.overflowX)) return true;
      }
      return false;
    };
    const hidden = (el) => {
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.opacity === '0' || s.visibility === 'hidden' || s.display === 'none') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('div[dir="auto"], [role="button"], input')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !scrollAncestor(el) && !hidden(el)) {
        issues.push(`${(el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 40).replace(/\n/g, ' ')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      // Unintended truncation: single-line text clipped with ellipsis.
      const cs = getComputedStyle(el);
      if (el.matches('div[dir="auto"]') && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !hidden(el)) {
        issues.push(`TRUNC: ${el.innerText.slice(0, 40)}`);
      }
    }
    return { doc, issues: [...new Set(issues)].slice(0, 12) };
  });
}

async function shoot(page, name, opts = {}) {
  const widths = (opts.widths || WIDTHS).filter(([w]) => !ONLY || ONLY.includes(w));
  for (const theme of opts.themes || ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [w, h] of widths) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      const o = await overflow(page);
      const file = `${OUT}/${w}-${theme}-${name}.png`;
      await page.screenshot({ path: file });
      results.push({ screen: name, width: w, theme, docOverflow: o.doc, issues: o.issues });
      if (o.doc || o.issues.length) log('  ISSUE', name, w, theme, JSON.stringify(o));
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  log('shot', name);
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`).first();
async function tap(page, id) {
  await tid(page, id).click({ timeout: 15000 });
  await page.waitForTimeout(400);
}
async function tapText(page, text) {
  await page.getByText(text, { exact: false }).first().click({ timeout: 15000 });
  await page.waitForTimeout(400);
}
async function waitText(page, text, timeout = 90000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
}
async function type(page, id, value) {
  const el = page.locator(`[data-testid="${id}"]`).first();
  await el.click();
  await el.fill(value);
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 6.4281, longitude: 3.4219 }, permissions: ['geolocation'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGEERR', e.message.slice(0, 200)));
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      log('STEP FAILED', label, e.message.split('\n')[0]);
      await page.screenshot({ path: `${OUT}/FAIL-${label}.png` });
    }
  };

  await page.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await step('onboarding', () => shoot(page, '01-onboarding'));
  await step('to-phone', () => tap(page, 'onboarding-signup'));
  await step('phone', async () => { await page.waitForTimeout(1500); await shoot(page, '02-phone'); });
  await step('phone-fill', async () => { await type(page, 'phone-input', '8031234567'); await shoot(page, '02b-phone-filled', { themes: ['light'] }); await tap(page, 'send-code'); });
  await step('otp', async () => { await page.waitForTimeout(2500); await shoot(page, '03-otp'); });
  await step('otp-fill', async () => { await type(page, 'otp-input', '123456'); await page.waitForTimeout(300); const v = tid(page, 'verify-code'); if (await v.count()) await v.click().catch(() => {}); await page.waitForTimeout(3000); });
  await step('name', async () => { await shoot(page, '04-name'); await type(page, 'first-name', 'Adaeze'); await type(page, 'last-name', 'Okonkwo-Ibrahim'); await tap(page, 'agree-terms'); await tap(page, 'profile-continue'); await page.waitForTimeout(2500); });
  await step('home', async () => { await page.waitForTimeout(2000); await shoot(page, '05-home'); });
  await step('primer', async () => {
    await tap(page, 'where-to');
    await page.waitForTimeout(1500);
    if (await tid(page, 'location-continue').count()) { await shoot(page, '05b-location-primer'); await tap(page, 'location-continue'); await page.waitForTimeout(2000); }
  });
  await step('search', async () => {
    if (!(await tid(page, 'search-input').count())) { await tap(page, 'where-to'); await page.waitForTimeout(1500); }
    await page.waitForTimeout(1200);
    await shoot(page, '06-search');
    await type(page, 'search-input', 'Ikeja');
    await page.waitForTimeout(1500);
    await shoot(page, '06b-search-results', { themes: ['light'] });
    await page.locator('[data-testid^="place-"]').first().click();
    await page.waitForTimeout(3500);
  });
  await step('options', async () => { await waitText(page, 'Suggested fare', 20000); await page.waitForTimeout(1500); await shoot(page, '07-options'); });
  await step('options-negotiate', async () => { await tap(page, 'mode-negotiate'); await shoot(page, '07b-options-negotiate', { themes: ['light'] }); await tap(page, 'mode-quick'); });
  await step('pickup-note', async () => { await tap(page, 'pickup-note'); await page.waitForTimeout(800); await shoot(page, '07c-pickup-note-sheet'); await type(page, 'pickup-note-input', 'Gate 2, opposite the pharmacy by the big mango tree'); await tap(page, 'save-pickup-note'); });
  await step('book', async () => { await tap(page, 'book-ride'); await page.waitForTimeout(1200); await shoot(page, '08-searching'); });
  await step('approach', async () => {
    for (let i = 0; i < 40; i++) {
      if (await page.getByText('Retry', { exact: false }).count() && (await tid(page, 'retry-search').count())) await tap(page, 'retry-search');
      if (await page.getByText('on the way', { exact: false }).count()) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(3000);
    await shoot(page, '09-approaching', { widths: WIDTHS.filter(([w]) => [320, 360, 390, 430, 480].includes(w)) });
  });
  await step('arrived', async () => {
    await waitText(page, 'has arrived', 60000);
    await shoot(page, '10-arrived', { widths: WIDTHS.filter(([w]) => [320, 430].includes(w)) });
  });
  await step('in-trip', async () => {
    await waitText(page, 'On the way to', 30000);
    await page.waitForTimeout(2000);
    await shoot(page, '11-in-trip', { widths: WIDTHS.filter(([w]) => [320, 375, 390, 430, 480].includes(w)) });
    if (await tid(page, 'trip-help').count()) { await tap(page, 'trip-help'); await page.waitForTimeout(800); await shoot(page, '11b-help-sheet', { widths: WIDTHS.filter(([w]) => [320, 430].includes(w)) }); await page.keyboard.press('Escape'); await page.mouse.click(200, 60); await page.waitForTimeout(800); }
  });
  await step('complete', async () => { await waitText(page, 'Trip completed', 60000); await page.waitForTimeout(1500); await shoot(page, '12-trip-complete'); });
  await step('payment', async () => {
    await tap(page, 'pay-now');
    await page.waitForTimeout(1500);
    await shoot(page, '13-payment-wallet');
    await tap(page, 'change-method');
    await page.waitForTimeout(800);
    await shoot(page, '13b-payment-method-sheet');
    await tapText(page, 'Bank transfer');
    await page.waitForTimeout(1000);
    await shoot(page, '13c-payment-transfer');
    await tap(page, 'confirm-transfer');
    await page.waitForTimeout(800);
    await shoot(page, '13d-payment-checking', { widths: WIDTHS.filter(([w]) => [320, 430].includes(w)) });
    await page.waitForTimeout(6000);
    await shoot(page, '13e-payment-result', { widths: WIDTHS.filter(([w]) => [320, 390, 430].includes(w)) });
    if (await tid(page, 'confirm-transfer').count()) { await tap(page, 'confirm-transfer'); await page.waitForTimeout(6000); }
    if (await tid(page, 'payment-continue').count()) await tap(page, 'payment-continue');
    await page.waitForTimeout(1500);
    await shoot(page, '14-trip-complete-paid', { widths: WIDTHS.filter(([w]) => [320, 390, 430].includes(w)) });
    if (await tid(page, 'trip-done').count()) await tap(page, 'trip-done');
    else await tapText(page, 'Back to Home');
    await page.waitForTimeout(1500);
  });
  await step('passenger-sheet', async () => { await tap(page, 'passenger-selector'); await tap(page, 'passenger-other'); await page.waitForTimeout(500); await shoot(page, '15-passenger-sheet'); await page.mouse.click(200, 40); await page.waitForTimeout(600); if (await tid(page, 'passenger-discard').count()) await tap(page, 'passenger-discard'); });
  await step('pickup-sheet', async () => { await tap(page, 'edit-pickup'); await page.waitForTimeout(600); await shoot(page, '16-pickup-sheet', { widths: WIDTHS.filter(([w]) => [320, 430].includes(w)) }); await tap(page, 'pickup-on-map'); await page.waitForTimeout(2000); await shoot(page, '17-pickup-map'); await page.goBack(); await page.waitForTimeout(1500); });
  const go = async (path, name, extra) => step(name, async () => { await page.goto(`http://localhost:8099${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500); if (extra) await extra(); await shoot(page, name); });
  await go('/activity', '20-activities');
  await go('/wallet', '21-wallet');
  await step('deposit', async () => { await tap(page, 'wallet-add'); await page.waitForTimeout(800); await shoot(page, '21b-deposit-sheet'); await tap(page, 'deposit-continue').catch(() => {}); await page.waitForTimeout(2500); await shoot(page, '21c-deposit-details', { widths: WIDTHS.filter(([w]) => [320, 390, 430].includes(w)) }); });
  await go('/account', '22-account');
  await go('/account/profile', '23-profile');
  await go('/account/places', '24-places');
  await go('/account/notifications', '25-notifications');
  await go('/account/rewards', '26-referrals');
  await go('/account/appearance', '27-appearance');
  await go('/account/location', '28-location');
  await go('/account/safety', '29-safety');
  await go('/account/support', '30-support');
  await go('/account/settings', '31-legal');
  await go('/account/delete', '32-delete');

  fs.writeFileSync((process.env.SHOTS || '/tmp/qa-shots') + '/results.json', JSON.stringify(results, null, 1));
  log('DONE', results.length, 'captures;', results.filter((r) => r.docOverflow || r.issues.length).length, 'with issues');
  await browser.close();
})();
