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

function flashCard(flash) {
  if (!flash) return '';

  return `<section class="card flash"><h2>Last action</h2><p>${flash.html}</p></section>`;
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
        <p>A third-party application that reads devices from Xyte on your behalf. Both buttons below start the
        <em>same</em> OAuth2 authorization request — Xyte decides what you get from who signs in and what they pick.</p>
      </section>
      <div class="grid">
        <a class="choice" href="/login?flow=connect">
          <strong>Connect your organization</strong>
          <span>For an organization administrator. Grants this app access to one organization, with the reach of an
          organization API key. Returns no <code>id_token</code> — nobody is signed in, the organization is connected.</span>
        </a>
        <a class="choice" href="/login?flow=signin">
          <strong>Sign in with Xyte</strong>
          <span>For a member of an organization that is already connected. Returns an OpenID Connect
          <code>id_token</code> plus a token limited to exactly what that member can see in the Xyte portal.</span>
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

function headline(session) {
  const claims = session.idTokenClaims;
  if (!claims) return 'Connected as an organization';

  return `Signed in as ${claims.name ?? claims.sub}${claims.email ? ` (${claims.email})` : ''}`;
}

function tokenRows(session) {
  const { tokens } = session;

  return `
    <tr><th>access_token</th><td class="mono">${escape(truncate(tokens.access_token))}</td></tr>
    <tr><th>refresh_token</th><td class="mono">${escape(truncate(tokens.refresh_token))}</td></tr>
    <tr><th>token_type</th><td class="mono">${escape(tokens.token_type ?? '—')}</td></tr>
    <tr><th>expires_in</th><td class="mono">${escape(tokens.expires_in ?? '—')}</td></tr>
    <tr><th>scope</th><td class="mono">${escape(tokens.scope ?? '— (none granted)')}</td></tr>
    <tr><th>id_token</th><td class="mono">${tokens.id_token ? escape(truncate(tokens.id_token, 20)) : '— (organization tokens carry no id_token)'}</td></tr>`;
}

function idTokenCard(session) {
  if (!session.idTokenClaims) {
    return `<section class="card">
      <h2>OpenID Connect</h2>
      <p class="muted">No <code>id_token</code> was issued. An administrator connecting an organization authorizes the
      <em>organization</em>, not a person, so there is nobody for Xyte to assert an identity for.</p>
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

  const explanation = userinfoResult.status === 403
    ? 'Expected for an organization token: <code>/oauth/userinfo</code> describes a person, and this authorization has none.'
    : userinfoResult.status === 200
      ? 'The same identity as the <code>id_token</code>, fetched live from Xyte.'
      : '';

  return `<section class="card">
    <h2>GET /oauth/userinfo ${statusPill(userinfoResult.status)}</h2>
    <pre>${escape(JSON.stringify(userinfoResult.body ?? userinfoResult.raw, null, 2))}</pre>
    ${explanation ? `<p class="muted small">${explanation}</p>` : ''}
  </section>`;
}

export function dashboard({ session, probes, userinfoResult, flash }) {
  const isMember = Boolean(session.idTokenClaims);
  const rows = probes
    .map((result) => `<tr>
        <td class="mono">${escape(result.path)}</td>
        <td>${statusPill(result.status)}</td>
        <td>${escape(result.summary)}<div class="muted small">${escape(result.note ?? '')}</div></td>
      </tr>`)
    .join('');

  return layout({
    title: `${config.appName} — dashboard`,
    body: `
      <section class="card banner">
        <h3>${escape(headline(session))}</h3>
        <p>${isMember
          ? `Tenant <code>${escape(session.idTokenClaims.xyte_tenant_id ?? '')}</code> (${escape(session.idTokenClaims.xyte_tenant_type ?? '')}). This token carries this member's own access — nothing more.`
          : 'This app now holds an organization-scoped token with the same reach as an organization API key.'}</p>
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
          <form method="post" action="/revoke"><button type="submit">Revoke (vendor side)</button></form>
          <form method="post" action="/logout"><button type="submit">Sign out of this demo</button></form>
        </div>
        <p class="muted small">Refreshing rotates the refresh token. Replaying the rotated one within 60 seconds is
        treated as a retried lost response and only fails; replaying it later is treated as theft and revokes the whole
        grant. Revoking here kills this app's tokens but leaves the authorization in place.</p>
      </section>`
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
        <p class="muted small">These two documents are everything a client needs to find the endpoints and verify an
        <code>id_token</code> signature. Nothing else about Xyte has to be hard-coded.</p>
      </section>
      <section class="card"><a class="btn" href="/">Back</a></section>`
  });
}
