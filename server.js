import { createServer } from 'node:http';
import { config, configProblems } from './src/config.js';
import { clearSession, loadSession, rotateSession } from './src/session.js';
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
import { dashboard, discoveryPage, errorPage, escape, idTokenErrorPage, landing, layout } from './src/views.js';

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

// Stores a token response, but only after any id_token in it has been verified. Returns null on
// success, or the failed verification so the caller can show which check rejected the token.
//
// Nothing is written to the session before that decision: claims from an unverified id_token are
// claims from whoever sent it, and a relying party that renders them has authenticated nobody.
async function applyTokens(session, tokens, { expectedNonce, keepOldRefresh = false } = {}) {
  let verified = null;

  if (tokens.id_token) {
    verified = await verifyIdToken(tokens.id_token, { expectedNonce });
    if (!verified.valid) return verified;
  }

  if (keepOldRefresh && session.tokens?.refresh_token) session.oldRefreshToken = session.tokens.refresh_token;

  session.tokens = tokens;
  delete session.idTokenClaims;
  delete session.idTokenChecks;

  if (verified) {
    session.idTokenClaims = verified.claims;
    session.idTokenChecks = verified.checks;
  }

  return null;
}

function tokenError(result) {
  const { error, error_description: description } = result.body ?? {};
  return `HTTP ${result.status} <code>${escape(error ?? 'unknown_error')}</code>${description ? ` — ${escape(description)}` : ''}`;
}

const routes = {
  'GET /': async (req, res, session) =>
    send(res, 200, landing({ session, problems: configProblems(), flash: takeFlash(session) })),

  // Both cards on the landing page link here. There is deliberately no "which button did you click"
  // state: what comes back depends on who signs in and what they pick, not on how the flow started,
  // and the dashboard says so by reading the token response rather than a local flag.
  'GET /login': async (req, res, session) => {
    const { verifier, challenge } = pkcePair();

    // One flow at a time per session: starting a second login in another tab abandons the first.
    session.state = randomToken();
    session.nonce = randomToken();
    session.codeVerifier = verifier;

    redirect(res, await authorizeUrl({ state: session.state, nonce: session.nonce, challenge }));
  },

  'GET /callback': async (req, res, session, url) => {
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const { state: expectedState, nonce, codeVerifier } = session;

    // Check `state` before anything else, including on the error path: acting on an unsolicited
    // callback is the one thing a client must never do.
    if (!expectedState || returnedState !== expectedState) {
      return send(res, 400, errorPage({
        error: 'state_mismatch',
        description: 'The state in the callback does not match the one this app generated. The response was discarded.',
        state: returnedState,
        expectedState
      }));
    }

    // `state`, `nonce` and the PKCE verifier are one-shot values. Dropping them here means a replayed
    // callback URL finds nothing to match against instead of being accepted a second time.
    delete session.state;
    delete session.nonce;
    delete session.codeVerifier;

    if (error || !code) {
      return send(res, 200, errorPage({
        error: error ?? 'invalid_response',
        description: error
          ? url.searchParams.get('error_description')
          : 'The callback carried neither an authorization code nor an error.',
        state: returnedState,
        expectedState
      }));
    }

    const result = await exchangeCode({ code, verifier: codeVerifier });
    if (!result.ok) {
      return send(res, 200, errorPage({
        error: result.body?.error ?? `http_${result.status}`,
        description: result.body?.error_description ?? result.raw,
        state: returnedState,
        expectedState
      }));
    }

    const failed = await applyTokens(session, result.body, { expectedNonce: nonce });
    if (failed) return send(res, 400, idTokenErrorPage(failed));

    delete session.oldRefreshToken;
    // The session id existed before this sign-in, so it is replaced now that the session carries an
    // identity (session fixation).
    rotateSession(session, res);
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
    if (!result.ok) {
      session.flash = { trustedHtml: `Refresh failed: ${tokenError(result)}` };
      return redirect(res, '/dashboard');
    }

    const failed = await applyTokens(session, result.body, { keepOldRefresh: true });
    if (failed) return send(res, 400, idTokenErrorPage(failed));

    session.flash = {
      trustedHtml: 'Refreshed. The refresh token was rotated — the previous one is now dead and is kept aside for the replay button.'
    };
    redirect(res, '/dashboard');
  },

  'POST /replay': async (req, res, session) => {
    if (!session.oldRefreshToken) return redirect(res, '/dashboard');

    const result = await refreshTokens(session.oldRefreshToken);
    session.flash = {
      trustedHtml: result.ok
        ? 'Unexpected: the rotated refresh token was accepted.'
        : `${tokenError(result)}. Within 60 seconds of the rotation Xyte reads this as a client retrying a lost response and only refuses it. After that it reads it as a stolen token and revokes the entire grant — reload and every probe below will answer 401.`
    };

    redirect(res, '/dashboard');
  },

  'POST /revoke': async (req, res, session) => {
    if (!session.tokens?.access_token) return redirect(res, '/');

    const result = await revokeToken(session.tokens.access_token);
    session.flash = {
      trustedHtml: `<code>POST /oauth/revoke</code> answered HTTP ${result.status} with an empty body — RFC 7009 says a revocation
             endpoint must not reveal whether the token existed. The tokens of this authorization are dead, so the probes
             below now answer 401. The authorization itself survives: signing in again issues new tokens without asking
             the administrator to approve anything.`
    };

    redirect(res, '/dashboard');
  },

  'POST /logout': async (req, res, session) => {
    clearSession(session);
    // Rotate on sign-out too, so the id that was tied to an identity cannot be presented again.
    rotateSession(session, res);
    session.flash = { trustedHtml: 'Signed out of this demo only. The authorization at Xyte is untouched — use Revoke for that.' };
    redirect(res, '/');
  },

  'GET /discovery': async (req, res) => send(res, 200, discoveryPage({ discovery: await discovery(), jwks: { keys: await jwks() } }))
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
             <p class="muted small">If this is a connection or discovery error, check that <code>XYTE_HUB</code> points at a
             reachable hub and that its <code>issuer</code> matches that URL exactly.</p>
             <a class="btn" href="/">Back</a></section>`
    }));
  }
});

server.listen(config.port, () => {
  const problems = configProblems();
  console.log(`${config.appName} demo listening on http://localhost:${config.port}`);
  console.log(`  hub:          ${config.hub}`);
  console.log(`  client_id:    ${config.clientId || '(not set)'}`);
  console.log(`  redirect_uri: ${config.redirectUri}`);
  if (problems.length) console.log(`  problems:     ${problems.join(' ')}`);
});
