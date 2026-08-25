/**
 * Google OAuth setup doctor.
 *
 * Enabling Google sign-in spans two dashboards, and a mistake in either one
 * surfaces as the same unhelpful error at the sign-in button. This checks both
 * sides independently so you know which half is wrong:
 *
 *   1. Supabase  — is the Google provider actually enabled?
 *   2. Google    — does the OAuth client accept Supabase's callback URL?
 *
 * Needs no secrets: a client ID and a redirect URI are both public values that
 * appear in the OAuth URL the browser is sent to anyway.
 *
 *   node scripts/check-google-oauth.mjs <google-client-id>
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://obuhrzoycjdonjyvrork.supabase.co";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_VyWJhiePgh6PhGy4JbJV9g_CFVpQgB2";

const clientId = process.argv[2];
const callback = `${SUPABASE_URL}/auth/v1/callback`;

let ok = true;
const say = (pass, label, detail) => {
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- Supabase --
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: ANON },
  });
  const cfg = await res.json();
  const enabled = Boolean(cfg?.external?.google);
  say(
    enabled,
    "Supabase: Google provider enabled",
    enabled
      ? "external.google = true"
      : "external.google = false → Authentication → Providers → Google → toggle on + paste Client ID/Secret",
  );
  if (cfg?.mailer_autoconfirm === false) {
    console.log(
      "INFO  email signups require confirmation (mailer_autoconfirm=false); " +
        "Google sign-ins skip this",
    );
  }
} catch (e) {
  say(false, "Supabase: reachable", String(e).slice(0, 120));
}

// ------------------------------------------------------------------ Google --
if (!clientId) {
  console.log(
    "SKIP  Google: redirect URI check — pass the client ID as an argument",
  );
} else {
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(callback)}` +
    "&response_type=code&scope=openid%20email";

  try {
    const body = await (await fetch(url, { redirect: "follow" })).text();
    if (/redirect_uri_mismatch/i.test(body)) {
      say(
        false,
        "Google: callback URL authorised",
        `not registered → add "${callback}" to the client's Authorised redirect URIs`,
      );
    } else if (/deleted_client|invalid_client|OAuth client was not found/i.test(body)) {
      say(false, "Google: client ID valid", "client not found in that project");
    } else if (/Sign in|Choose an account|identifier|consent/i.test(body)) {
      say(true, "Google: callback URL authorised", "served a sign-in page");
    } else {
      const err = body.match(/Error [0-9]+:[^<]*/i)?.[0] ?? "unrecognised response";
      say(false, "Google: callback URL authorised", err.slice(0, 100));
    }
  } catch (e) {
    say(false, "Google: reachable", String(e).slice(0, 120));
  }
}

console.log(
  ok
    ? "\n✓ Both sides configured — Sign in with Google should work."
    : "\n✗ Fix the FAIL lines above, then re-run.",
);
process.exit(ok ? 0 : 1);
