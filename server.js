import { createServer } from 'node:http';
import { config, configProblems } from './src/config.js';
import { clearSession, loadSession } from './src/session.js';
import {
  authorizeUrl,
  discovery,
  exchangeCode,
  jwks,
  pkcePair,
  randomToken,
  refreshTokens,
  revokeToken,
  userinfo,
  verifyIdToken
} from './src/oauth.js';
import { probeAll } from './src/xyte.js';
import { dashboard, discoveryPage, errorPage, escape, landing, layout } from './src/views.js';

const send = (res, status, html) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
};

const redirect = (res, location) => {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
};

const takeFlash = (session) => {
  const flash = session.flash;
  delete session.flash;
  return flash;
};

// Stores whatever a token response returned. A refresh keeps the previous refresh token aside so the
// replay button has something to send.
async function applyTokens(session, tokens, { expectedNonce, keepOldRefresh = false } = {}) {
  if (keepOldRefresh && session.tokens?.refresh_token) session.oldRefreshToken = session.tokens.refresh_token;

  session.tokens = tokens;
  delete session.idTokenClaims;
  delete session.idTokenChecks;

  if (tokens.id_token) {
    const verified = await verifyIdToken(tokens.id_token, { expectedNonce });
    session.idTokenClaims = verified.claims;
    session.idTokenChecks = verified.checks;
  }
}

function tokenError(result) {
  const { error, error_description: description } = result.body ?? {};
  return `HTTP ${result.status} <code>${escape(error ?? 'unknown_error')}</code>${description ? ` — ${escape(description)}` : ''}`;
}

const routes = {
  'GET /': async (req, res, session) =>
    send(res, 200, landing({ session, problems: configProblems(), flash: takeFlash(session) })),

  // Both buttons on the landing page arrive here; `flow` is only a label this demo keeps so the
  // dashboard can explain what happened. The authorization request itself is identical.
  'GET /login': async (req, res, session, url) => {
    const { verifier, challenge } = pkcePair();
    session.flow = url.searchParams.get('flow') ?? 'signin';
    session.state = randomToken();
    session.nonce = randomToken();
    session.codeVerifier = verifier;

    redirect(res, await authorizeUrl({ state: session.state, nonce: session.nonce, challenge }));
  },

  'GET /callback': async (req, res, session, url) => {
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Check `state` before anything else, including on the error path: an unsolicited callback is
    // the one thing a client must never act on.
    if (!session.state || returnedState !== session.state) {
      return send(res, 400, errorPage({
        error: 'state_mismatch',
        description: 'The state in the callback does not match the one this app generated. The response was discarded.',
        state: returnedState,
        expectedState: session.state
      }));
    }

    if (error) {
      return send(res, 200, errorPage({
        error,
        description: url.searchParams.get('error_description'),
        state: returnedState,
        expectedState: session.state
      }));
    }

    const result = await exchangeCode({ code: url.searchParams.get('code'), verifier: session.codeVerifier });
    if (!result.ok) {
      return send(res, 200, errorPage({
        error: result.body?.error ?? `http_${result.status}`,
        description: result.body?.error_description ?? result.raw,
        state: returnedState,
        expectedState: session.state
      }));
    }

    await applyTokens(session, result.body, { expectedNonce: session.nonce });
    delete session.oldRefreshToken;
    redirect(res, '/dashboard');
  },

  'GET /dashboard': async (req, res, session) => {
    if (!session.tokens) return redirect(res, '/');

    const [probes, userinfoResult] = await Promise.all([
      probeAll(session.tokens.access_token),
      userinfo(session.tokens.access_token)
    ]);

    send(res, 200, dashboard({ session, probes, userinfoResult, flash: takeFlash(session) }));
  },

  'POST /refresh': async (req, res, session) => {
    if (!session.tokens?.refresh_token) return redirect(res, '/');

    const result = await refreshTokens(session.tokens.refresh_token);
    if (result.ok) {
      await applyTokens(session, result.body, { keepOldRefresh: true });
      session.flash = {
        html: 'Refreshed. The refresh token was rotated — the previous one is now dead and is kept aside for the replay button.'
      };
    } else {
      session.flash = { html: `Refresh failed: ${tokenError(result)}` };
    }

    redirect(res, '/dashboard');
  },

  'POST /replay': async (req, res, session) => {
    if (!session.oldRefreshToken) return redirect(res, '/dashboard');

    const result = await refreshTokens(session.oldRefreshToken);
    session.flash = {
      html: result.ok
        ? 'Unexpected: the rotated refresh token was accepted.'
        : `${tokenError(result)}. Within 60 seconds of the rotation Xyte reads this as a client retrying a lost response and only refuses it. After that it reads it as a stolen token and revokes the entire grant — reload and every probe below will answer 401.`
    };

    redirect(res, '/dashboard');
  },

  'POST /revoke': async (req, res, session) => {
    if (!session.tokens?.access_token) return redirect(res, '/');

    const result = await revokeToken(session.tokens.access_token);
    session.flash = {
      html: `<code>POST /oauth/revoke</code> answered HTTP ${result.status} with an empty body — RFC 7009 says a revocation
             endpoint must not reveal whether the token existed. The tokens of this authorization are dead, so the probes
             below now answer 401. The authorization itself survives: signing in again issues new tokens without asking
             the administrator to approve anything.`
    };

    redirect(res, '/dashboard');
  },

  'POST /logout': async (req, res, session) => {
    clearSession(session);
    session.flash = { html: 'Signed out of this demo only. The authorization at Xyte is untouched — use Revoke for that.' };
    redirect(res, '/');
  },

  'GET /discovery': async (req, res) => send(res, 200, discoveryPage({ discovery: await discovery(), jwks: await jwks() }))
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${config.port}`);
  const handler = routes[`${req.method} ${url.pathname}`];

  if (!handler) return send(res, 404, layout({ title: 'Not found', body: '<section class="card"><h2>404</h2><a class="btn" href="/">Back</a></section>' }));

  try {
    const session = loadSession(req, res);
    await handler(req, res, session, url);
  } catch (error) {
    send(res, 500, layout({
      title: 'Error',
      body: `<section class="card"><h2>Something went wrong</h2><pre>${escape(error.stack ?? error.message)}</pre>
             <p class="muted small">If this is a connection error, check that <code>XYTE_HUB</code> points at a reachable hub.</p>
             <a class="btn" href="/">Back</a></section>`
    }));
  }
});

server.listen(config.port, () => {
  const problems = configProblems();
  console.log(`${config.appName} demo listening on http://localhost:${config.port}`);
  console.log(`  hub:          ${config.hub}`);
  console.log(`  client_id:    ${config.clientId}`);
  console.log(`  redirect_uri: ${config.redirectUri}`);
  if (problems.length) console.log(`  problems:     ${problems.join(' ')}`);
});
