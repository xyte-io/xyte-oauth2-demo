import { config } from './config.js';

export const escape = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const truncate = (value, keep = 14) => {
  const text = String(value ?? '');
  return text.length <= keep * 2 ? text : `${text.slice(0, keep)}…${text.slice(-6)}`;
};

const STYLES = `
  :root {
    --bg: #f6f7f9; --card: #ffffff; --ink: #14181f; --muted: #5b6676; --line: #e2e6ec;
    --accent: #2f5bd8; --ok: #157347; --warn: #9a6700; --bad: #b42318; --code: #f1f3f7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216; --card: #171b21; --ink: #e8ebef; --muted: #9aa4b2; --line: #262c35;
      --accent: #7d9bff; --ok: #4ec07d; --warn: #e0b341; --bad: #f97066; --code: #10141a;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
         font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 940px; margin: 0 auto; padding: 32px 20px 64px; }
  header.top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap;
               padding-bottom: 16px; border-bottom: 1px solid var(--line); margin-bottom: 28px; }
  header.top h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  header.top .hub { color: var(--muted); font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  h2 { font-size: 15px; margin: 0 0 10px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  .banner { border-left: 4px solid var(--accent); }
  .banner h3 { margin: 0 0 6px; font-size: 18px; }
  .banner p { margin: 0; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .choice { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 10px;
            padding: 20px; text-decoration: none; color: inherit; transition: border-color .15s, transform .15s; }
  .choice:hover { border-color: var(--accent); transform: translateY(-1px); }
  .choice strong { display: block; font-size: 17px; margin-bottom: 6px; }
  .choice span { color: var(--muted); font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.mono, code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  code { background: var(--code); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  pre { background: var(--code); padding: 14px; border-radius: 8px; overflow-x: auto; font-size: 13px; margin: 0; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .s2xx { background: rgba(21,115,71,.14); color: var(--ok); }
  .s4xx { background: rgba(180,35,24,.14); color: var(--bad); }
  .sother { background: rgba(154,103,0,.14); color: var(--warn); }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  button, .btn { font: inherit; font-size: 14px; padding: 9px 16px; border-radius: 8px; border: 1px solid var(--line);
                 background: var(--card); color: var(--ink); cursor: pointer; text-decoration: none; display: inline-block; }
  button:hover, .btn:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  ul.checks { list-style: none; padding: 0; margin: 0; }
  ul.checks li { padding: 5px 0; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: baseline; }
  ul.checks li:last-child { border-bottom: 0; }
  ul.checks .mark { font-weight: 700; width: 16px; }
  ul.checks .ok { color: var(--ok); }
  ul.checks .bad { color: var(--bad); }
  .flash { border-left: 4px solid var(--warn); }
  footer { margin-top: 32px; color: var(--muted); font-size: 13px; }
`;

export function layout({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>${escape(config.appName)} <span class="muted small">— Xyte OAuth2 demo</span></h1>
    <span class="hub">${escape(config.hub)}</span>
  </header>
  ${body}
  <footer>
    Sample vendor application. Sessions are in memory and tokens are shown in the browser, so run it locally only.
    <a href="/discovery">Discovery &amp; JWKS</a>
  </footer>
</div>
</body>
</html>`;
}

const statusPill = (status) => {
  const klass = status >= 200 && status < 300 ? 's2xx' : status >= 400 ? 's4xx' : 'sother';
  return `<span class="pill ${klass}">${escape(status || 'ERR')}</span>`;
};

// `trustedHtml` is injected unescaped so the explanations can use <code> and <a>. The name is the
// warning: every producer in server.js escapes its own interpolations, and any new one must too.
function flashCard(flash) {
  if (!flash) return '';

  return `<section class="card flash"><h2>Last action</h2><p>${flash.trustedHtml}</p></section>`;
}

export function landing({ session, problems, flash }) {
  const warnings = problems.length
    ? `<section class="card"><h2>Configuration problems</h2><ul>${problems.map((p) => `<li>${escape(p)}</li>`).join('')}</ul></section>`
    : '';

  const current = session.tokens
    ? `<section class="card banner"><h3>${escape(headline(session))}</h3>
         <p><a class="btn" href="/dashboard">Back to the dashboard</a></p></section>`
    : '';

  return layout({
    title: `${config.appName} — sign in`,
    body: `
      ${warnings}
      ${flashCard(flash)}
      ${current}
      <section class="card">
        <h2>What this is</h2>
        <p>A third-party application that reads devices from Xyte on your behalf. Signing in and authorizing are
        one flow: Xyte authenticates you, you choose which organization this app should act on, and the app comes
        back holding both an identity for you and a token to call the API with.</p>
      </section>
      <div class="grid">
        <a class="choice" href="/login">
          <strong>Sign in with Xyte</strong>
          <span>Xyte lists every organization you can reach and marks each one: already approved by an administrator,
          yours to approve, or waiting on an administrator. Whichever you pick, this app receives an OpenID Connect
          <code>id_token</code> naming who signed in, plus an access token with the reach of an organization API key
          &mdash; the same token for an administrator and for a member.</span>
        </a>
      </div>
      <section class="card">
        <h2>This client</h2>
        <table>
          <tr><th>Hub</th><td class="mono">${escape(config.hub)}</td></tr>
          <tr><th>client_id</th><td class="mono">${escape(config.clientId)}</td></tr>
          <tr><th>redirect_uri</th><td class="mono">${escape(config.redirectUri)}</td></tr>
          <tr><th>scope</th><td class="mono">${escape(config.scope)}</td></tr>
          <tr><th>Client auth</th><td class="mono">${escape(config.authMethod === 'basic' ? 'client_secret_basic' : 'client_secret_post')}</td></tr>
          <tr><th>PKCE</th><td class="mono">S256</td></tr>
        </table>
      </section>`
  });
}

const OPENID_REQUESTED = config.scope.split(/\s+/).includes('openid');

// Only an id_token proves who is signed in. Without `openid` in the scope Xyte asserts no identity at
// all, so an absent id_token stops being evidence of anything and the page must not pretend otherwise.
function headline(session) {
  const claims = session.idTokenClaims;
  if (claims) return `Signed in as ${claims.name ?? claims.sub}${claims.email ? ` (${claims.email})` : ''}`;
  if (session.idTokenRejected) return 'Signed in as nobody — the id_token was rejected';
  if (!OPENID_REQUESTED) return 'Connected';

  return 'Connected as an organization';
}

function subheading(session) {
  const claims = session.idTokenClaims;
  if (claims) {
    return `Tenant <code>${escape(claims.xyte_tenant_id ?? '')}</code> (${escape(claims.xyte_tenant_type ?? '')}).
            The <code>id_token</code> says who signed in; the access token carries organization-wide access,
            independent of it.`;
  }

  if (session.idTokenRejected) {
    return 'The token response was kept, but its <code>id_token</code> failed verification, so no identity was accepted from it.';
  }

  if (!OPENID_REQUESTED) {
    return `This app did not request the <code>openid</code> scope, so Xyte asserted no identity and there is no way to tell
            from here which flow ran. The probe table below shows what this token actually reaches.`;
  }

  return 'This app now holds an organization-scoped token with the same reach as an organization API key.';
}

function tokenRows(session) {
  const { tokens } = session;

  return `
    <tr><th>access_token</th><td class="mono">${escape(truncate(tokens.access_token))}</td></tr>
    <tr><th>refresh_token</th><td class="mono">${escape(truncate(tokens.refresh_token))}</td></tr>
    <tr><th>token_type</th><td class="mono">${escape(tokens.token_type ?? '—')}</td></tr>
    <tr><th>expires_in</th><td class="mono">${escape(tokens.expires_in ?? '—')}</td></tr>
    <tr><th>scope</th><td class="mono">${escape(tokens.scope ?? '— (none granted)')}</td></tr>
    <tr><th>id_token</th><td class="mono">${tokens.id_token ? escape(truncate(tokens.id_token, 20)) : '— (none issued)'}</td></tr>`;
}

const checkList = (checks) => checks
  .map((check) => `<li><span class="mark ${check.ok ? 'ok' : 'bad'}">${check.ok ? '✓' : '✕'}</span>
      <span>${escape(check.label)} <span class="muted small mono">${escape(check.detail ?? '')}</span></span></li>`)
  .join('');

function idTokenCard(session) {
  if (session.idTokenRejected) {
    return `<section class="card">
      <h2>id_token — rejected</h2>
      <p class="muted">An <code>id_token</code> arrived but failed verification, so its claims were discarded rather than
      believed. The access token from the same response is still in use.</p>
      <ul class="checks">${checkList(session.idTokenRejected)}</ul>
    </section>`;
  }

  if (!session.idTokenClaims) {
    return `<section class="card">
      <h2>OpenID Connect</h2>
      <p class="muted">${OPENID_REQUESTED
        ? `No <code>id_token</code> was issued. An administrator connecting an organization authorizes the
           <em>organization</em>, not a person, so there is nobody for Xyte to assert an identity for.`
        : `This app did not ask for the <code>openid</code> scope, so no <code>id_token</code> was issued — not even for a
           member signing in. Add <code>openid</code> to <code>SCOPE</code> to see one.`}</p>
    </section>`;
  }

  const checks = session.idTokenChecks
    .map((check) => `<li><span class="mark ${check.ok ? 'ok' : 'bad'}">${check.ok ? '✓' : '✕'}</span>
        <span>${escape(check.label)} <span class="muted small mono">${escape(check.detail ?? '')}</span></span></li>`)
    .join('');

  const claims = Object.entries(session.idTokenClaims)
    .map(([key, value]) => `<tr><th>${escape(key)}</th><td class="mono">${escape(typeof value === 'object' ? JSON.stringify(value) : value)}</td></tr>`)
    .join('');

  return `<section class="card">
    <h2>id_token — verified locally</h2>
    <ul class="checks">${checks}</ul>
    <h2 style="margin-top:20px">Claims</h2>
    <table>${claims}</table>
  </section>`;
}

function userinfoCard(userinfoResult) {
  if (!userinfoResult) return '';

  const explanation = {
    200: 'The same identity as the <code>id_token</code>, fetched live from Xyte.',
    401: 'The token was rejected — expired, revoked, or killed by a refresh-token replay. Not a scope problem.',
    403: `<code>insufficient_scope</code>: this authorization has no person to describe. That is the normal answer for an
          organization token, and also for a user token whose authorization never requested the <code>openid</code> scope.`
  }[userinfoResult.status] ?? '';

  return `<section class="card">
    <h2>GET /oauth/userinfo ${statusPill(userinfoResult.status)}</h2>
    <pre>${escape(JSON.stringify(userinfoResult.body ?? userinfoResult.raw, null, 2))}</pre>
    ${explanation ? `<p class="muted small">${explanation}</p>` : ''}
  </section>`;
}

export function dashboard({ session, probes, userinfoResult, flash }) {
  const rows = probes
    .map((result) => `<tr>
        <td class="mono">${escape(result.path)}</td>
        <td>${statusPill(result.status)}</td>
        <td>${escape(result.summary)}
          ${result.challenge ? `<div class="muted small mono">${escape(result.challenge)}</div>` : ''}
          <div class="muted small">${escape(result.note ?? '')}</div></td>
      </tr>`)
    .join('');

  return layout({
    title: `${config.appName} — dashboard`,
    body: `
      <section class="card banner">
        <h3>${escape(headline(session))}</h3>
        <p>${subheading(session)}</p>
      </section>
      ${flashCard(flash)}
      <section class="card">
        <h2>Token response</h2>
        <table>${tokenRows(session)}</table>
        <p class="muted small">Tokens are truncated for display. Xyte tokens are opaque and prefixed:
        <code>xoac_</code> codes, <code>xoat_</code> access tokens, <code>xort_</code> refresh tokens.</p>
      </section>
      ${idTokenCard(session)}
      ${userinfoCard(userinfoResult)}
      <section class="card">
        <h2>Organization Core API, called with this token</h2>
        <table>
          <thead><tr><th>Endpoint</th><th>Status</th><th>Response</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <section class="card">
        <h2>Try the lifecycle</h2>
        <div class="actions">
          <form method="post" action="/refresh"><button class="primary" type="submit">Refresh token</button></form>
          <form method="post" action="/replay"><button type="submit"${session.oldRefreshToken ? '' : ' disabled'}>Replay the old refresh token</button></form>
          <form method="post" action="/revoke"><button type="submit">Revoke these tokens</button></form>
          <form method="post" action="/logout"><button type="submit">Sign out of this demo</button></form>
        </div>
        <p class="muted small">Refreshing rotates the refresh token. Replaying the rotated one within 60 seconds is
        treated as a retried lost response and only fails; replaying it later is treated as theft and revokes the whole
        grant.</p>
        <p class="muted small"><strong>Revoking these tokens</strong> is credential hygiene, not a disconnect: it calls
        <code>POST /oauth/revoke</code> so the access and refresh tokens this app is holding stop working immediately,
        instead of being left alive for their remaining 60 minutes and 90 days. It does not end this app's own session,
        and it does not withdraw the organization's approval &mdash; signing in again issues fresh tokens without asking
        an administrator. Withdrawing the approval is the customer's decision and is made in Xyte, under
        <em>Settings &rarr; Connected apps</em>. Signing out below does both halves of what a real application does:
        drops its own session and revokes the tokens it was holding.</p>
      </section>`
  });
}

// Shown instead of the dashboard when an id_token fails any check. Only the individual values that a
// check looked at are echoed — never the claim set presented as an identity, because nothing here has
// been proven to come from Xyte.
export function idTokenErrorPage(verified) {
  const checks = verified.checks
    .map((check) => `<li><span class="mark ${check.ok ? 'ok' : 'bad'}">${check.ok ? '✓' : '✕'}</span>
        <span>${escape(check.label)} <span class="muted small mono">${escape(check.detail ?? '')}</span></span></li>`)
    .join('');

  return layout({
    title: `${config.appName} — id_token rejected`,
    body: `
      <section class="card banner">
        <h3>The id_token failed verification</h3>
        <p>Nobody was signed in. An <code>id_token</code> that fails any of these checks proves nothing, so its claims
        are discarded rather than displayed.</p>
      </section>
      <section class="card">
        <h2>Checks</h2>
        <ul class="checks">${checks}</ul>
      </section>
      <section class="card"><a class="btn" href="/">Start over</a></section>`
  });
}

export function errorPage({ error, description, state, expectedState }) {
  return layout({
    title: `${config.appName} — authorization error`,
    body: `
      <section class="card banner">
        <h3>Authorization did not complete</h3>
        <p>Xyte redirected back to this app with an error instead of a code.</p>
      </section>
      <section class="card">
        <table>
          <tr><th>error</th><td class="mono">${escape(error ?? '—')}</td></tr>
          <tr><th>error_description</th><td>${escape(description ?? '—')}</td></tr>
          <tr><th>state returned</th><td class="mono">${escape(state ?? '—')}</td></tr>
          <tr><th>state expected</th><td class="mono">${escape(expectedState ?? '—')}</td></tr>
        </table>
      </section>
      <section class="card"><a class="btn" href="/">Start over</a></section>`
  });
}

export function discoveryPage({ discovery, jwks }) {
  return layout({
    title: `${config.appName} — discovery`,
    body: `
      <section class="card">
        <h2>GET /.well-known/openid-configuration</h2>
        <pre>${escape(JSON.stringify(discovery, null, 2))}</pre>
      </section>
      <section class="card">
        <h2>GET ${escape(discovery.jwks_uri ?? '/oauth/.well-known/jwks.json')}</h2>
        <pre>${escape(JSON.stringify(jwks, null, 2))}</pre>
        <p class="muted small">These two documents are almost everything a client needs to find the endpoints and verify an
        <code>id_token</code> signature. The one exception is the revocation endpoint, which Xyte does not advertise yet —
        <code>src/oauth.js</code> builds that one from <code>XYTE_HUB</code>.</p>
      </section>
      <section class="card"><a class="btn" href="/">Back</a></section>`
  });
}
