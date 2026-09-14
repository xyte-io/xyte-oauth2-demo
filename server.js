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

// Stores a token response and verifies any id_token in it. Returns null on success, or the failed
// verification so the caller can show which check rejected the token.
//
// The tokens are stored FIRST and unconditionally. They came back from this client's own
// authenticated call to a validated token endpoint, and on a refresh the rotated token MUST be kept:
// the previous one is already dead at the hub, so losing the new one — to a failed check, or merely
// to a JWKS fetch that happens to be down — would leave the session holding a corpse and turn the
// next refresh into a self-inflicted replay.
//
// It is only the identity claims that have to earn their place: claims from an unverified id_token
// are claims from whoever sent them, and a relying party that renders them has authenticated nobody.
async function applyTokens(session, tokens, { expectedNonce, keepOldRefresh = false } = {}) {
  if (keepOldRefresh && session.tokens?.refresh_token) session.oldRefreshToken = session.tokens.refresh_token;

  session.tokens = tokens;
  delete session.idTokenClaims;
  delete session.idTokenChecks;
  delete session.idTokenRejected;

  if (!tokens.id_token) return null;

  let verified;
  try {
    verified = await verifyIdToken(tokens.id_token, { expectedNonce });
  } catch (error) {
    // A verification that could not even run is a verification that did not pass.
    verified = { valid: false, checks: [{ label: 'Verification could be completed', ok: false, detail: error.message }] };
  }

  if (verified.valid) {
    session.idTokenClaims = verified.claims;
    session.idTokenChecks = verified.checks;
    return null;
  }

  // Remembered so the dashboard says "rejected" rather than silently looking like a flow that never
  // asked for an identity.
  session.idTokenRejected = verified.checks;
  return verified;
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

    // Rotate before the one-time values are stored, so a session id that was visible to anyone
    // before this flow began is already dead by the time it carries a `state` worth stealing.
    //
    // Note what this does NOT buy: login CSRF (RFC 6819 §4.4.1.9), where an attacker runs their own
    // login and then plants the resulting cookie on a victim so the victim signs into the attacker's
    // account, is not closed by any amount of rotation. Closing it needs a cookie an attacker cannot
    // plant — `Secure` plus the `__Host-` prefix, over HTTPS — which this demo deliberately does not
    // have because it runs on plain HTTP.
    rotateSession(session, res);

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
    if (!result.ok || !result.body) {
      return send(res, 200, errorPage({
        error: result.body?.error ?? `http_${result.status}`,
        description: result.body?.error_description ?? result.raw ?? 'The token endpoint returned no usable body.',
        state: returnedState,
        expectedState
      }));
    }

    const failed = await applyTokens(session, result.body, { expectedNonce: nonce });
    if (failed) {
      // At the start of a flow there is no rotated refresh token worth keeping, so the session goes
      // back to empty rather than holding a half-finished login.
      clearSession(session);
      rotateSession(session, res);
      return send(res, 400, idTokenErrorPage(failed));
    }

    delete session.oldRefreshToken;
    // Rotate again now that the session carries an identity: the id that was handed out before the
    // sign-in must not stay valid after it (session fixation).
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

    // Rotation makes a refresh non-idempotent, so two in flight at once means the second one replays
    // a token the first has already rotated away — a double-click would revoke the grant. A real
    // client serialises refreshes per grant for exactly this reason.
    if (session.refreshing) {
      session.flash = { trustedHtml: 'A refresh is already in flight. Rotation makes concurrent refreshes a self-inflicted replay, so this one was dropped.' };
      return redirect(res, '/dashboard');
    }

    session.refreshing = true;
    try {
      const result = await refreshTokens(session.tokens.refresh_token);

      if (!result.ok || !result.body) {
        session.flash = { trustedHtml: `Refresh failed: ${tokenError(result)}` };
        return redirect(res, '/dashboard');
      }

      const failed = await applyTokens(session, result.body, { keepOldRefresh: true });
      if (failed) return send(res, 400, idTokenErrorPage(failed));

      session.flash = {
        trustedHtml: 'Refreshed. The refresh token was rotated — the previous one is now dead and is kept aside for the replay button.'
      };
      redirect(res, '/dashboard');
    } finally {
      // Released only once the new tokens are stored, not merely once the HTTP call returned.
      delete session.refreshing;
    }
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
  // Everything is inside the try: this callback is async, so anything thrown outside it becomes an
  // unhandled rejection, which by default takes the whole process down.
  try {
    // A constant base — only the pathname and the query are used, never the host.
    const url = new URL(req.url, 'http://localhost');
    const handler = routes[`${req.method} ${url.pathname}`];

    if (!handler) return send(res, 404, layout({ title: 'Not found', body: '<section class="card"><h2>404</h2><a class="btn" href="/">Back</a></section>' }));

    const session = loadSession(req, res);
    await handler(req, res, session, url);
  } catch (error) {
    // A handler that already started its response cannot be given an error page on top of it.
    if (res.headersSent) return res.end();

    send(res, 500, layout({
      title: 'Error',
      body: `<section class="card"><h2>Something went wrong</h2><pre>${escape(error.stack ?? error.message)}</pre>
             <p class="muted small">If this is a connection or discovery error, check that <code>XYTE_HUB</code> points at a
             reachable hub and that its <code>issuer</code> matches that URL exactly.</p>
             <a class="btn" href="/">Back</a></section>`
    }));
  }
});

const problems = configProblems();

// An unusable port has to be caught before listen(), which would otherwise die with a bare
// ERR_SOCKET_BAD_PORT and never print the message that explains it.
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  console.error(`Cannot start: ${problems.join(' ')}`);
  process.exit(1);
}

server.listen(config.port, () => {
  console.log(`${config.appName} demo listening on http://localhost:${config.port}`);
  console.log(`  hub:          ${config.hub}`);
  console.log(`  client_id:    ${config.clientId || '(not set)'}`);
  console.log(`  redirect_uri: ${config.redirectUri}`);
  if (problems.length) console.log(`  problems:     ${problems.join(' ')}`);
});
