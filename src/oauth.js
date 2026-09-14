import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { config } from './config.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const decodeSegment = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

// PKCE (RFC 7636). Xyte accepts S256 only; a 32-byte verifier base64url-encodes to the 43 characters
// the hub expects.
export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export const randomToken = () => b64url(randomBytes(24));

let discoveryCache = null;

export async function discovery() {
  if (discoveryCache) return discoveryCache;

  const response = await fetch(`${config.hub}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error(`Discovery failed: HTTP ${response.status} from ${config.hub}`);

  discoveryCache = await response.json();
  return discoveryCache;
}

export async function jwks() {
  const { jwks_uri: uri } = await discovery();
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`JWKS fetch failed: HTTP ${response.status}`);

  return response.json();
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

// One helper for both grant types: form-encoded body, client credentials either in an Authorization
// header (client_secret_basic) or in the body (client_secret_post).
async function postForm(endpoint, params) {
  const body = new URLSearchParams(params);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

  if (config.authMethod === 'basic') {
    // RFC 6749 §2.3.1: both halves are form-url-encoded before they are joined and base64-encoded.
    const credentials = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  } else {
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
  }

  const response = await fetch(endpoint, { method: 'POST', headers, body });
  const text = await response.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: response.status, ok: response.ok, body: json, raw: text };
}

export async function exchangeCode({ code, verifier }) {
  const { token_endpoint: endpoint } = await discovery();

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

export async function revokeToken(token) {
  return postForm(`${config.hub}/oauth/revoke`, { token });
}

export async function userinfo(accessToken) {
  const { userinfo_endpoint: endpoint } = await discovery();
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const text = await response.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: response.status, body: json, raw: text };
}

// Verifies the id_token the way a relying party must (OIDC Core 3.1.3.7) and reports every check
// separately, so the demo page can show which one would have caught a forged token.
export async function verifyIdToken(idToken, { expectedNonce } = {}) {
  const [header64, payload64, signature64] = idToken.split('.');
  const header = decodeSegment(header64);
  const claims = decodeSegment(payload64);
  const { issuer } = await discovery();
  const checks = [];

  checks.push({ label: 'Header alg is RS256', ok: header.alg === 'RS256', detail: header.alg });

  const keys = (await jwks()).keys ?? [];
  const jwk = keys.find((key) => key.kid === header.kid) ?? keys[0];
  let signatureValid = false;
  if (jwk) {
    signatureValid = createVerify('RSA-SHA256')
      .update(`${header64}.${payload64}`)
      .verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature64, 'base64url'));
  }
  checks.push({
    label: 'Signature verifies against the JWKS key',
    ok: signatureValid,
    detail: jwk ? `kid ${header.kid}` : 'no matching key in JWKS'
  });

  checks.push({ label: `Issuer is ${issuer}`, ok: claims.iss === issuer, detail: claims.iss });

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  checks.push({
    label: `Audience contains ${config.clientId}`,
    ok: audiences.includes(config.clientId),
    detail: audiences.join(', ')
  });

  const now = Math.floor(Date.now() / 1000);
  checks.push({
    label: 'Not expired',
    ok: typeof claims.exp === 'number' && claims.exp > now,
    detail: claims.exp ? `expires in ${claims.exp - now}s` : 'no exp claim'
  });

  // A refreshed id_token carries no nonce by design, so the check is only meaningful right after the
  // code exchange.
  if (expectedNonce) {
    checks.push({ label: 'Nonce matches this login', ok: claims.nonce === expectedNonce, detail: claims.nonce });
  } else {
    checks.push({ label: 'No nonce expected (token came from a refresh)', ok: !claims.nonce, detail: claims.nonce ?? '—' });
  }

  return { header, claims, checks, valid: checks.every((check) => check.ok) };
}
