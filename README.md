# Xyte OAuth2 / OIDC demo app

A small, runnable third-party application ("Acme Fleet Portal") that authenticates against Xyte with
OAuth2 and OpenID Connect. It is meant to be read as much as run: every request it makes is plain,
commented JavaScript, and the pages explain what Xyte just did and why.

It has **no dependencies**. Node 18.17+ is the only requirement.

```bash
git clone <this repo> && cd xyte-oauth2-demo
cp .env.example .env      # fill in the client_id / client_secret Xyte issued you
node server.js            # http://localhost:5555
```

## The two flows

Both buttons on the landing page send the *same* authorization request. Xyte decides what comes back
from who signs in and what they pick.

| | **Connect your organization** | **Sign in with Xyte** |
|---|---|---|
| Who does it | An organization administrator | Any member of an organization that is already connected |
| What is authorized | The organization | That one person |
| Access token reach | The whole organization, like an organization API key | Exactly what that member can see in the Xyte portal |
| `id_token` | None — nobody signed in | Yes: `sub`, `email`, `name`, `xyte_tenant_id`, `xyte_tenant_type` |
| `/oauth/userinfo` | `403 insufficient_scope` | `200` |
| Admin-only endpoints (`users`, `groups`) | `200` | `403 Not authorized` |

The right-hand column assumes the default `SCOPE`. Drop `openid` from it and even a member gets no
`id_token` and a `403 insufficient_scope` from userinfo, which is correct — this application asked for
neither.

A member of an organization **no administrator has connected yet** reaches a dead end on the consent
screen asking them to have their administrator connect the application first. The administrator has
to go first; that is the whole model in one sentence.

## Configuration

Every value can come from `.env` or from a real environment variable (the environment wins).

| Variable | Default | Notes |
|---|---|---|
| `XYTE_HUB` | `http://localhost:3000` | Base URL, no trailing slash. Production: `https://hub.xyte.io` |
| `XYTE_CLIENT_ID` | *(none — required)* | Issued by Xyte |
| `XYTE_CLIENT_SECRET` | *(none — required)* | Issued by Xyte |
| `REDIRECT_URI` | `http://localhost:5555/callback` | Must match a registered URI **byte for byte** |
| `PORT` | `5555` | Keep in sync with `REDIRECT_URI` |
| `SCOPE` | `openid profile email` | Subset of those three |
| `AUTH_METHOD` | `basic` | `basic` = `client_secret_basic`, `post` = `client_secret_post` |
| `APP_NAME` | `Acme Fleet Portal` | This demo's own UI only; the consent screen uses the name Xyte registered |

Xyte registers your application out of band and hands over the client id, secret and the exact
redirect URIs. There is no dynamic client registration.

## What the pages show

- **`/`** — the two entry points, plus the client configuration in use.
- **`/dashboard`** — the raw token response, the `id_token` claims with every verification check
  listed separately (signature against the JWKS key, issuer, audience, expiry, nonce), the live
  `/oauth/userinfo` response, and five Organization Core API calls with their status codes. Switching
  between the two flows and comparing this table is the fastest way to understand the difference.
- **`/discovery`** — `/.well-known/openid-configuration` and the JWKS, which is nearly everything a
  client needs to discover Xyte. The exception is the revocation endpoint: Xyte does not advertise a
  `revocation_endpoint` yet, so that one URL is built from `XYTE_HUB`.
- Buttons for **refresh**, **replaying a rotated refresh token**, and **revoking**, each explaining
  what Xyte did in response.

## What it demonstrates, and what to copy

- **PKCE with `S256`** is mandatory (`src/oauth.js` → `pkcePair`). `plain` is rejected.
- **`state`** is checked before anything else, including on the error path — an unsolicited callback
  is discarded rather than acted on.
- **The token endpoint is form-encoded only.** A JSON body returns `400 invalid_request`. Client
  credentials go in HTTP Basic (both halves form-url-encoded first, per RFC 6749 §2.3.1) or in the
  body; `src/oauth.js` → `postForm` does both.
- **`id_token` verification** (`src/oauth.js` → `verifyIdToken`) uses Node's built-in `crypto` to turn
  a JWK straight into a public key. RS256 is checked before the key is looked up (accepting the
  header's choice of algorithm is the classic "alg confusion" bug), the `kid` selects the key with no
  fallback to "whichever key came first", and a token that fails **any** check is refused outright
  rather than displayed. `server.js` → `applyTokens` stores the tokens either way — a rotated refresh
  token must never be discarded — but accepts no identity from a token that failed: it records the
  failed checks, and the page says so.
- **The discovery document is validated before it is used** (`src/oauth.js` → `assertTrustworthy`).
  Its `issuer` must equal `XYTE_HUB` and every endpoint must be on that origin, because this client
  is about to post its `client_secret` to `token_endpoint`. Without that check the `iss` check on the
  `id_token` is circular.
- **Refresh tokens rotate.** The old one is dead immediately. Replaying it within 60 seconds is read
  as a client retrying a lost response and merely fails; replaying it later is read as a stolen token
  and revokes the entire grant. Store the new refresh token before you do anything else with it —
  including when something else about the response looks wrong. For the same reason, serialise
  refreshes per grant: two concurrent refreshes make the second one a replay of the first.
- **Revocation** (RFC 7009) always answers `200` with an empty body, even for a token that never
  existed. It kills the tokens, not the authorization: signing in again issues new ones without
  asking the administrator to approve anything. Only the customer-side revoke in
  Settings → Connected apps tears down the authorization itself.
- **Lifetimes**: authorization codes 60 s and single use, access tokens 60 min, refresh tokens 90 days
  from the first exchange (absolute, not sliding).
- **Rate limits**: `/oauth/token` is 60/min per IP *and* 300/min per `client_id`; `/oauth/revoke` is
  60/min per IP; discovery, JWKS and userinfo are 120/min per IP. Polling any of them in a tight loop
  returns `429` with no `Retry-After`.

## This is a demo, not a template for production

Sessions live in a `Map` in memory, are never evicted, and disappear on restart; tokens are printed in
the browser; everything runs over plain HTTP on localhost. A real integration stores tokens
server-side, encrypted and per user, expires its sessions, and serves the redirect URI over HTTPS —
at which point the session cookie should also carry `Secure` and the `__Host-` prefix, which is what
actually stops an attacker planting a cookie (see the note in `server.js` → `/login`).

## Licence and intended use

Copyright © 2026 Xyte Ltd. Licensed under the **GNU Affero General Public License v3.0** — see
[LICENSE](LICENSE).

This repository exists so you can **read, run and review** how a Xyte OAuth2 integration works. It is
a teaching aid, not a starting point for a product, and the licence is chosen to say so: the AGPL
requires anyone who distributes a derived work — or merely runs one as a network service — to release
their own source under the same terms. Copying pieces of this into a closed-source portal is therefore
not something the licence permits.

Read it, borrow the ideas, check your own implementation against it. If you would like to reuse the
code itself under different terms, contact Xyte — the copyright is ours to relicense.

## Files

```
server.js        HTTP server and routes
src/config.js    environment configuration and a minimal .env reader
src/session.js   cookie-based in-memory sessions
src/oauth.js     discovery, PKCE, token/refresh/revoke, userinfo, id_token verification
src/xyte.js      the Organization Core API probes shown on the dashboard
src/views.js     HTML rendering
```
