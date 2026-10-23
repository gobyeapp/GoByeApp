// Admin QA screenshots: signs in as a test staff account (simulated sign in) and captures routes at
// several widths in light and dark, reporting horizontal overflow.
// Usage: node tools/qa-web/admin-shots.cjs [baseUrl]
//   env SHOTS=dir  WIDTHS=1440,1024,768,375  THEMES=light,dark  ROUTES=/overview,/live  STAFF=<staff name substring>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:5180/';
const OUT = process.env.SHOTS || '/tmp/admin-shots';
const WIDTHS = (process.env.WIDTHS || '1440,1024,768,375').split(',').map(Number);
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const ROUTES = (process.env.ROUTES || '/overview').split(',');
const STAFF = process.env.STAFF || '';
const FULL = process.env.FULL !== '0';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 812 : 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${theme} ${w}: page error ${e.message}`));
      await page.addInitScript((t) => localStorage.setItem('gobye.admin.theme', t), theme);
      await page.goto(BASE);
      const opt = STAFF ? page.locator('.staff-option', { hasText: STAFF }).first() : page.locator('.staff-option').first();
      await opt.click();
      for (const r of ROUTES) {
        await page.goto(`${BASE}#${r}`);
        await page.waitForSelector('main h1', { timeout: 10000 }).catch(() => problems.push(`${theme} ${w} ${r}: no page heading`));
        await page.waitForTimeout(400);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 1) problems.push(`${theme} ${w} ${r}: page scrolls sideways by ${over}px`);
        const name = `${w}-${theme}${r.replace(/\//g, '_')}.png`;
        await page.screenshot({ path: `${OUT}/${name}`, fullPage: FULL });
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(problems.length ? problems.join('\n') : 'No overflow or page errors');
})();
