import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A three-line .env reader keeps the demo dependency-free: `git clone && node server.js` has to work
// on a customer's laptop without an npm install.
function readDotenv(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }

  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

// fileURLToPath, not URL#pathname: a checkout under a path with a space would otherwise be handed to
// readFileSync percent-encoded, and the miss is silent.
const file = readDotenv(fileURLToPath(new URL('../.env', import.meta.url)));

// Real environment variables win, so `XYTE_HUB=… node server.js` overrides the file for a one-off run.
const read = (key, fallback) => process.env[key] ?? file[key] ?? fallback;

export const config = {
  hub: read('XYTE_HUB', 'http://localhost:3000').replace(/\/+$/, ''),
  // Deliberately empty: a placeholder default would make the check below unreachable and leave a
  // forgotten .env to fail later as an opaque invalid_client from the hub.
  clientId: read('XYTE_CLIENT_ID', ''),
  clientSecret: read('XYTE_CLIENT_SECRET', ''),
  redirectUri: read('REDIRECT_URI', 'http://localhost:5555/callback'),
  port: Number(read('PORT', '5555')),
  scope: read('SCOPE', 'openid profile email'),
  authMethod: read('AUTH_METHOD', 'basic'),
  appName: read('APP_NAME', 'Acme Fleet Portal')
};

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];
const KNOWN_SCOPES = ['openid', 'profile', 'email'];

export function configProblems() {
  const problems = [];

  if (!/^https?:\/\//.test(config.hub)) problems.push('XYTE_HUB must be an absolute http(s) URL.');
  if (!config.clientId || !config.clientSecret) {
    problems.push('XYTE_CLIENT_ID and XYTE_CLIENT_SECRET are required — copy .env.example to .env and fill in the credentials Xyte issued you.');
  }
  if (!['basic', 'post'].includes(config.authMethod)) problems.push("AUTH_METHOD must be 'basic' or 'post'.");

  // Checked here so the message is readable: an unusable PORT otherwise reaches server.listen and
  // dies as ERR_SOCKET_BAD_PORT.
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    problems.push(`PORT (${config.port}) must be a whole number between 1 and 65535.`);
  }

  // Xyte answers an unknown scope with invalid_scope after a browser round trip; catching it here
  // saves the reader that detour.
  const unknownScopes = config.scope.split(/\s+/).filter((scope) => scope && !KNOWN_SCOPES.includes(scope));
  if (unknownScopes.length) {
    problems.push(`SCOPE contains ${unknownScopes.join(', ')} — Xyte accepts only ${KNOWN_SCOPES.join(', ')}.`);
  }

  let redirect;
  try {
    redirect = new URL(config.redirectUri);
  } catch {
    problems.push(`REDIRECT_URI (${config.redirectUri}) is not a valid absolute URL.`);
    return problems;
  }

  // Worth catching early only when the browser reaches this process directly: a mismatch there
  // surfaces at the hub as an opaque invalid_request. Behind a proxy or a real hostname the public
  // port has nothing to do with the port we listen on.
  if (LOCAL_HOSTNAMES.includes(redirect.hostname) && Number(redirect.port || 80) !== config.port) {
    problems.push(`REDIRECT_URI port (${redirect.port || 80}) does not match PORT (${config.port}).`);
  }

  return problems;
}
