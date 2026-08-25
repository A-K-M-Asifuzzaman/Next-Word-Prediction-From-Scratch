import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:3111";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push(String(e)));
p.on("console", m => { if (m.type()==="error") errs.push(m.text()); });
let pass = 0, total = 0;
const chk = (n, ok, d="") => { total++; if (ok) pass++; console.log(`${ok?"PASS":"FAIL"}  ${n}${d?` — ${d}`:""}`); };

await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
// Credentials come from the environment: this file is committed, and an
// admin password does not belong in a repository.
//   NWP_ADMIN_EMAIL=... NWP_ADMIN_PASSWORD=... node scripts/e2e-admin.mjs
const EMAIL = process.env.NWP_ADMIN_EMAIL;
const PASSWORD = process.env.NWP_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("set NWP_ADMIN_EMAIL and NWP_ADMIN_PASSWORD");
  process.exit(2);
}
await p.locator('input[type="email"]').fill(EMAIL);
await p.locator('input[type="password"]').fill(PASSWORD);
await p.getByRole("button", { name: /sign in/i }).click();
await p.waitForURL(/workspace/, { timeout: 30000 });
chk("admin signs in", true);

for (const [path, marker] of [
  ["/admin", /control room/i],
  ["/admin/training", /nwp-core-base/i],
  ["/admin/models", /model registry/i],
  ["/admin/users", /accounts/i],
  ["/admin/telemetry", /telemetry/i],
  ["/admin/flags", /feature flags/i],
]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const ok = (await p.getByText(marker).count()) > 0;
  chk(`${path} renders`, ok, p.url().replace(BASE,""));
  if (path === "/admin/training") {
    const svgs = await p.locator("svg").count();
    chk("training charts drawn", svgs >= 4, `${svgs} svg`);
    await p.screenshot({ path: "../docs/shot-admin-training.png" });
  }
  if (path === "/admin") await p.screenshot({ path: "../docs/shot-admin.png" });
}
const fatal = errs.filter(e => !/favicon/.test(e));
chk("no console errors", fatal.length === 0, fatal.slice(0,2).join(" | ").slice(0,200));
await b.close();
console.log(`\n${pass}/${total} checks passed`);
process.exit(pass === total ? 0 : 1);
