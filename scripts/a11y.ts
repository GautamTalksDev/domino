// Accessibility check: runs axe-core (WCAG 2 A and AA rules) on every page of a running Domino, plus the dialogs.
//   npm run a11y                       (against http://localhost:3000)
//   DOMINO_URL=https://… npm run a11y  (against a deployment)
// Needs a Chromium for Playwright once: npx playwright install chromium (or point CHROME_PATH at an installed Chrome).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Page } from 'playwright';

const base = (process.env.DOMINO_URL || 'http://localhost:3000').replace(/\/+$/, '');
const PAGES = ['/', '/patients', '/patients/p-beatrice', '/patients/p-beatrice/brief', '/inbox', '/team', '/check', '/ehr', '/checkup', '/population', '/graph', '/evaluation', '/how'];
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function audit(page: Page, label: string): Promise<number> {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    return axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
  });
  const n = result.violations.length;
  console.log(`  ${n ? '✗' : '✓'} ${label}${n ? '' : ': no violations'}`);
  for (const v of result.violations) console.log(`      ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
  return n;
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let failures = 0;
console.log(`\nAccessibility (axe-core, WCAG 2 A/AA) against ${base}\n`);
for (const p of PAGES) {
  await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  failures += await audit(page, `page ${p}`);
}
// The overlays: command palette and keyboard shortcuts.
await page.goto(base + '/inbox', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
failures += await audit(page, 'command palette');
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+Slash');
await page.waitForTimeout(400);
failures += await audit(page, 'keyboard shortcuts');
await page.keyboard.press('Escape');
// The guided tour's card and ring over a page.
await page.goto(base + '/?judge=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
failures += await audit(page, 'guided tour');
await page.getByRole('button', { name: 'End the tour' }).click().catch(() => {});
// The demo EHR with Domino's card pausing a signature (the light-themed panel and the CDS card).
await page.goto(base + '/ehr', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Benztropine' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Sign order/ }).click();
await page.getByRole('alertdialog').waitFor({ timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(600);
failures += await audit(page, 'demo EHR with a CDS card');
// The care-team search with results (words, meaning and graph badges).
await page.goto(base + '/team', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'swelling amlodipine' }).click();
await page.locator('#mem-q').waitFor();
await page.waitForTimeout(1500);
failures += await audit(page, 'care-team search results');
// A phone-width pass of the landing page.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
failures += await audit(page, 'page / at phone width');
await browser.close();
console.log(failures ? `\n${failures} violation type(s) found.` : '\nAll clear.');
process.exit(failures ? 1 : 0);
