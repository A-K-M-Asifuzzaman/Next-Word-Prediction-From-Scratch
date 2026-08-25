import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:3111";
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.locator('input[type="email"]').fill("demo@nwpcore.dev");
await p.locator('input[type="password"]').fill("NwpCore!Demo2026");
await p.getByRole("button", { name: /sign in/i }).click();
await p.waitForURL(/workspace/, { timeout: 30000 });
await p.waitForFunction(() => !document.body.innerText.includes("downloading model"), null, { timeout: 180000 });

const ta = p.locator("textarea").first();
await ta.click();
await ta.type("The transformer architecture has become the standard for language", { delay: 45 });
await p.waitForTimeout(2500);
// accept a few suggestions so acceptance rate is non-zero
for (let i = 0; i < 4; i++) { await ta.press("Tab"); await p.waitForTimeout(900); }
await p.waitForTimeout(1500);

// Client-side navigation — this is the case that used to drop everything.
await p.getByRole("link", { name: /dashboard/i }).click();
await p.waitForURL(/dashboard/, { timeout: 30000 });
await p.waitForTimeout(3500);
await p.reload({ waitUntil: "networkidle" });

const txt = await p.locator("body").innerText();
const m = txt.match(/SUGGESTIONS SHOWN\s*\n\s*([\d,]+)/i);
const acc = txt.match(/ACCEPTANCE RATE\s*\n\s*([\d.]+)/i);
console.log("suggestions shown:", m ? m[1] : "not found");
console.log("acceptance rate:", acc ? acc[1] + "%" : "not found");
await p.screenshot({ path: "../docs/shot-dashboard.png", fullPage: false });
const ok = m && parseInt(m[1].replace(/,/g,"")) > 0;
console.log(ok ? "PASS  telemetry survived client-side navigation" : "FAIL  telemetry still lost");
await b.close();
process.exit(ok ? 0 : 1);
