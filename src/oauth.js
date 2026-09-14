import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { config } from './config.js';

const TIMEOUT_MS = 10_000;
const JWKS_CACHE_MS = 5 * 60 * 1000;
const DISCOVERY_CACHE_MS = 60 * 60 * 1000;
// The expiry and issued-at checks run against the customer's laptop clock, not Xyte's, so a minute
// of drift must not reject a freshly issued token.
const CLOCK_SKEW_SECONDS = 60;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// RFC 6749 §2.3.1 requires each half of the Basic credentials to be form-urlencoded before they are
// joined and base64-encoded. URLSearchParams is that encoder; encodeURIComponent is not.
const formEncode = (value) => new URLSearchParams([['v', value]]).toString().slice(2);

// Every call is bounded: without this a hub that accepts the connection and then stalls hangs the
// browser request forever.
const request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function pkcePair() {
  // RFC 7636 allows a 43-128 character verifier; 32 random bytes base64url-encode to the 43-character
  // minimum, which is already 256 bits of entropy. Xyte accepts S256 only — `plain` is rejected.
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export const randomToken = () => b64url(randomBytes(24));

let discoveryCache = { document: null, fetchedAt: 0 };

// OpenID Connect Discovery §4.3: the document's `issuer` MUST equal the issuer it was fetched from,
// and the endpoints it names must belong to that issuer — this client is about to post its
// client_secret to `token_endpoint`. Skipping this also makes the id_token's `iss` check circular,
// since it would be validating the token against a claim from the same untrusted document.
function assertTrustworthy(document) {
  if (document.issuer !== config.hub) {
    throw new Error(`Discovery issuer "${document.issuer}" does not match XYTE_HUB "${config.hub}"`);
  }

  const expected = new URL(config.hub).origin;
  for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri']) {
    if (!document[key] || new URL(document[key]).origin !== expected) {
      throw new Error(`Discovery ${key} ("${document[key]}") is not on ${expected}`);
    }
  }
}

// Xyte marks the document cacheable for an hour; caching it forever would mean a long-running
// integration never notices an endpoint move.
export async function discovery() {
  if (discoveryCache.document && Date.now() - discoveryCache.fetchedAt < DISCOVERY_CACHE_MS) {
    return discoveryCache.document;
  }

  const response = await request(`${config.hub}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error(`Discovery failed: HTTP ${response.status} from ${config.hub}`);

  const document = await response.json();
  // Throws before anything is cached, so a rejected document cannot poison later calls.
  assertTrustworthy(document);
  discoveryCache = { document, fetchedAt: Date.now() };
  return document;
}

let jwksCache = { keys: null, fetchedAt: 0 };

// Xyte marks the JWKS cacheable for 5 minutes and rate-limits it to 120/min, so a client caches it
// and refetches only when it meets a `kid` it does not know — which is what a key rotation looks like.
export async function jwks({ refresh = false } = {}) {
  if (!refresh && jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_MS) return jwksCache.keys;

  const { jwks_uri: uri } = await discovery();
  const response = await request(uri);
  if (!response.ok) throw new Error(`JWKS fetch failed: HTTP ${response.status}`);

  jwksCache = { keys: (await response.json()).keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

export async function authorizeUrl({ state, nonce, challenge }) {
  const { authorization_endpoint: endpoint } = await discovery();
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: config.scope,
    nonce
  });

  return `${endpoint}?${query}`;
}

// One helper for both grant types and for revocation: form-encoded body, client credentials either in
// an Authorization header (client_secret_basic) or in the body (client_secret_post). Xyte rejects a
// JSON body with 400 invalid_request.
async function postForm(endpoint, params) {
  const body = new URLSearchParams(params);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

  if (config.authMethod === 'basic') {
    const credentials = `${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  } else {
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
  }

  const response = await request(endpoint, { method: 'POST', headers, body });
  const text = await response.text();

  return { status: response.status, ok: response.ok, body: parseJson(text), raw: text };
}

export async function exchangeCode({ code, verifier }) {
  const { token_endpoint: endpoint } = await discovery();

  // redirect_uri is sent again and must be byte-identical to the one used at authorize; it is not a
  // routing instruction here, it is proof that the same client started the flow.
  return postForm(endpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier
  });
}

export async function refreshTokens(refreshToken) {
  const { token_endpoint: endpoint } = await discovery();

  return postForm(endpoint, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

// Built from XYTE_HUB rather than from discovery because Xyte does not advertise a
// `revocation_endpoint` in its metadata yet.
export async function revokeToken(token) {
  return postForm(`${config.hub}/oauth/revoke`, { token });
}

export async function userinfo(accessToken) {
  const { userinfo_endpoint: endpoint } = await discovery();
  const response = await request(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const text = await response.text();

  return { status: response.status, body: parseJson(text), raw: text };
}

const failedVerification = (label, detail) => ({
  header: {},
  claims: {},
  checks: [{ label, ok: false, detail }],
  valid: false
});

// Verifies the id_token the way a relying party must (OIDC Core 3.1.3.7) and reports every check
// separately, so the demo page can show which one would have caught a forged token.
//
// The caller MUST refuse the token when `valid` is false. Rendering claims from a token that failed
// verification is the whole bug this function exists to prevent.
export async function verifyIdToken(idToken, { expectedNonce } = {}) {
  const parts = String(idToken).split('.');
  let header;
  let claims;
  try {
    if (parts.length !== 3) throw new Error('expected three dot-separated segments');
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    // `JSON.parse('null')` and `JSON.parse('7')` both succeed, and every check below would then
    // throw on property access instead of reporting a rejection.
    if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') {
      throw new Error('header and payload must both be JSON objects');
    }
  } catch (error) {
    return failedVerification('id_token is a well-formed JWS', error.message);
  }

  const { issuer } = await discovery();
  const now = Math.floor(Date.now() / 1000);
  const checks = [];

  // Checked before the key is even looked up: accepting whatever algorithm the header asks for is
  // the classic "alg confusion" bug, and RS256 is the only algorithm Xyte advertises.
  checks.push({ label: 'Header alg is RS256', ok: header.alg === 'RS256', detail: header.alg ?? '—' });

  let keys = await jwks();
  let jwk = header.kid ? keys.find((key) => key.kid === header.kid) : undefined;
  // Only a token naming a key we do not know is worth a refetch — that is what a key rotation looks
  // like. A token with no `kid` at all would otherwise refetch on every attempt.
  if (!jwk && header.kid) {
    keys = await jwks({ refresh: true });
    jwk = keys.find((key) => key.kid === header.kid);
  }

  let signatureOk = false;
  // No fallback to "the first key in the set": the `kid` selects the key, and a token naming a key
  // nobody published is exactly the token this check has to reject.
  let signatureDetail = `no JWKS key for kid ${header.kid ?? '(absent)'}`;
  if (jwk) {
    try {
      signatureOk = header.alg === 'RS256' && createVerify('RSA-SHA256')
        .update(`${parts[0]}.${parts[1]}`)
        .verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
      signatureDetail = `kid ${header.kid}`;
    } catch (error) {
      signatureDetail = error.message;
    }
  }
  checks.push({ label: 'Signature verifies against the JWKS key', ok: signatureOk, detail: signatureDetail });

  checks.push({ label: `Issuer is ${issuer}`, ok: claims.iss === issuer, detail: claims.iss ?? '—' });

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  checks.push({
    label: `Audience contains ${config.clientId}`,
    ok: audiences.includes(config.clientId),
    detail: audiences.filter(Boolean).join(', ') || '—'
  });

  // OIDC Core 3.1.3.7: `azp` is required when the token has several audiences (rule 5), and whenever
  // it is present at all it MUST equal the client id (rule 6). Xyte issues one audience and no `azp`
  // today, so this row normally does not appear.
  if (audiences.length > 1 || claims.azp !== undefined) {
    checks.push({ label: `azp is ${config.clientId}`, ok: claims.azp === config.clientId, detail: claims.azp ?? '—' });
  }

  checks.push({
    label: 'Not expired',
    ok: typeof claims.exp === 'number' && claims.exp > now - CLOCK_SKEW_SECONDS,
    detail: typeof claims.exp === 'number' ? `expires in ${claims.exp - now}s` : 'no exp claim'
  });

  checks.push({
    label: 'Issued in the past',
    ok: typeof claims.iat === 'number' && claims.iat <= now + CLOCK_SKEW_SECONDS,
    // `toISOString` throws beyond ±8.64e15 ms, and `typeof 1e300 === 'number'`.
    detail: Number.isFinite(claims.iat) && Math.abs(claims.iat) < 8.64e12
      ? new Date(claims.iat * 1000).toISOString()
      : String(claims.iat ?? 'no iat claim')
  });

  // A refreshed id_token carries no nonce by design, so the check is only meaningful right after the
  // code exchange.
  if (expectedNonce) {
    checks.push({ label: 'Nonce matches this login', ok: claims.nonce === expectedNonce, detail: claims.nonce ?? '—' });
  } else {
    checks.push({ label: 'No nonce expected (token came from a refresh)', ok: !claims.nonce, detail: claims.nonce ?? '—' });
  }

  return { header, claims, checks, valid: checks.every((check) => check.ok) };
}
