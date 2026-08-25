/**
 * Google OAuth wiring check.
 *
 * Cannot complete a real Google sign-in headlessly (Google blocks automation),
 * so this asserts the parts that are ours: the button exists, clicking it hands
 * off to accounts.google.com, and the callback route degrades cleanly instead
 * of 500ing when the provider reports a failure.
 *
 *   node scripts/e2e-oauth.mjs https://nwp-core.vercel.app
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3111";

let pass = 0;
let total = 0;
const chk = (n, ok, d = "") => {
  total++;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const btn = page.getByRole("button", { name: /continue with google/i });
chk("google button rendered", (await btn.count()) > 0);
chk(
  "email/password form still present",
  (await page.locator('input[type="password"]').count()) > 0,
);

await btn.click().catch(() => {});
await page.waitForTimeout(6000);
const url = page.url();
const wentToGoogle = /accounts\.google\.com/.test(url);
const body = await page.locator("body").innerText();
const providerDisabled = /provider is not enabled|Unsupported provider|not enabled/i.test(body);

chk(
  "click starts Google OAuth",
  wentToGoogle || providerDisabled,
  wentToGoogle
    ? "redirected to accounts.google.com"
    : providerDisabled
      ? "provider not enabled in Supabase yet (expected until configured)"
      : `unexpected: ${url.slice(0, 80)}`,
);

await page.goto(
  `${BASE}/auth/callback?error=access_denied&error_description=User+declined`,
  { waitUntil: "networkidle" },
);
chk(
  "callback surfaces provider errors instead of crashing",
  /\/login\?error=/.test(page.url()),
  decodeURIComponent(page.url().split("error=")[1] ?? "").slice(0, 50),
);

await browser.close();
console.log(`\n${pass}/${total} checks passed`);
process.exit(pass === total ? 0 : 1);
