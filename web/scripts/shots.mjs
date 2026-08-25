import { chromium } from "playwright";
const BASE = process.argv[2] ?? "https://nwp-core.vercel.app";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

// landing
await p.goto(BASE, { waitUntil: "networkidle" });
await p.screenshot({ path: "../docs/shot-landing.png" });

// workspace
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.locator('input[type="email"]').fill("demo@nwpcore.dev");
await p.locator('input[type="password"]').fill("NwpCore!Demo2026");
await p.getByRole("button", { name: /sign in/i }).click();
await p.waitForURL(/workspace/, { timeout: 30000 });
await p.waitForFunction(() => !document.body.innerText.includes("downloading model"), null, { timeout: 180000 });
const ta = p.locator("textarea").first();
await ta.click();
await ta.press("Control+a"); await ta.press("Backspace");
await ta.type("The observatory sits on the ridge above the valley, and on clear nights the astronomers can see", { delay: 22 });
await p.waitForTimeout(4500);
await p.screenshot({ path: "../docs/shot-workspace.png" });
await b.close();
console.log("captured landing + workspace");
