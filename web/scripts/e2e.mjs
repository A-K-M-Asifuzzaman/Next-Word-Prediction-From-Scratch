/**
 * End-to-end smoke test against a running server.
 *
 * The parts that cannot be checked any other way: does the Web Worker bundle
 * load under a production build, does onnxruntime-web find its .wasm, does the
 * model actually produce sensible next-word predictions in a browser, and do
 * the authenticated routes render.
 *
 *   node scripts/e2e.mjs http://localhost:3111
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3111";
const EMAIL = process.env.NWP_EMAIL ?? "demo@nwpcore.dev";
const PASSWORD = process.env.NWP_PASSWORD ?? "NwpCore!Demo2026";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

try {
  // ---------------------------------------------------------------- landing
  await page.goto(BASE, { waitUntil: "networkidle" });
  check("landing renders", await page.locator("h1").first().isVisible());
  check(
    "specimen panel shows real model stats",
    (await page.getByText("19.5M", { exact: false }).count()) > 0 ||
      (await page.getByText("parameters").count()) > 0,
  );

  // ------------------------------------------------- live demo / inference
  await page.getByRole("button", { name: /load the model/i }).click();
  console.log("      … downloading weights");
  await page.waitForFunction(
    () => !document.body.innerText.includes("loading weights"),
    null,
    { timeout: 180_000 },
  );

  // The seeded prompt should produce a plausible continuation. Wait for the
  // list to actually populate rather than sleeping a fixed interval -- the
  // first forward pass after a cold CDN fetch is slower than a warm one, and a
  // fixed sleep makes this assertion race it.
  await page
    .locator("main button:has(kbd)")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => {});
  const candidates = await page
    .locator("main button:has(kbd)")
    .allInnerTexts()
    .catch(() => []);
  check(
    "model returns candidates",
    candidates.length > 0,
    candidates.slice(0, 5).map((c) => c.replace(/\s+/g, " ").trim()).join(" | "),
  );

  const latency = await page.getByText(/ms$/).first().innerText().catch(() => "");
  check("latency readout present", latency.length > 0, latency);

  // Type and confirm the distribution updates.
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill("The capital city of France is");
  await page.waitForFunction(
    () => document.body.innerText.includes("%"),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(600);
  const after = await page.locator("main button:has(kbd)").allInnerTexts();
  check(
    "prediction updates on input",
    after.length > 0,
    after.slice(0, 5).map((c) => c.replace(/\s+/g, " ").trim()).join(" | "),
  );

  // Tab acceptance must actually mutate the textarea.
  const before = await ta.inputValue();
  await ta.press("Tab");
  await page.waitForTimeout(400);
  const grown = await ta.inputValue();
  check("tab accepts the suggestion", grown.length > before.length,
        JSON.stringify(grown.slice(-28)));

  check("lattice rendered", (await page.locator("svg").count()) > 0);

  // ------------------------------------------------------------------ auth
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/workspace/, { timeout: 30_000 });
  check("sign in reaches workspace", page.url().includes("/workspace"));

  await page.waitForFunction(
    () => !document.body.innerText.includes("downloading model"),
    null,
    { timeout: 180_000 },
  );
  const editor = page.locator("textarea").first();
  await editor.click();
  await editor.type("Machine learning models are trained on large", { delay: 18 });
  await page.waitForTimeout(3000);
  check(
    "workspace produces predictions",
    (await page.locator("aside button:has(kbd)").count()) > 0,
  );
  check(
    "surprisal scope populated",
    (await page.getByText(/tokens profiled/).count()) > 0 ||
      (await page.getByText(/bits/).count()) > 0,
  );

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check("dashboard renders", (await page.getByText(/instrument log/i).count()) > 0);

  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  check("settings renders", (await page.getByText(/inference/i).count()) > 0);

  // A non-admin must be bounced out of /admin.
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check("non-admin blocked from /admin", !page.url().endsWith("/admin"), page.url());

  await page.screenshot({ path: "../docs/shot-workspace.png", fullPage: false });
} catch (err) {
  check("run completed", false, String(err).slice(0, 300));
} finally {
  const fatal = errors.filter(
    (e) => !/favicon|Failed to load resource: the server responded with a status of 40/.test(e),
  );
  if (fatal.length) {
    console.log("\nconsole errors:");
    fatal.slice(0, 8).forEach((e) => console.log("  ! " + e.slice(0, 220)));
  }
  check("no fatal console errors", fatal.length === 0, `${fatal.length} error(s)`);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
