import { readFileSync } from 'node:fs';

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

// Real environment variables win, so `XYTE_HUB=… node server.js` overrides the file for a one-off run.
const file = readDotenv(new URL('../.env', import.meta.url).pathname);
const read = (key, fallback) => process.env[key] ?? file[key] ?? fallback;

export const config = {
  hub: read('XYTE_HUB', 'http://localhost:3000').replace(/\/+$/, ''),
  clientId: read('XYTE_CLIENT_ID', 'acme-demo-client'),
  clientSecret: read('XYTE_CLIENT_SECRET', 'acme-demo-client-secret'),
  redirectUri: read('REDIRECT_URI', 'http://localhost:5555/callback'),
  port: Number(read('PORT', '5555')),
  scope: read('SCOPE', 'openid profile email'),
  authMethod: read('AUTH_METHOD', 'basic'),
  appName: read('APP_NAME', 'Acme Fleet Portal')
};

export function configProblems() {
  const problems = [];
  if (!/^https?:\/\//.test(config.hub)) problems.push('XYTE_HUB must be an absolute http(s) URL.');
  if (!config.clientId || !config.clientSecret) problems.push('XYTE_CLIENT_ID and XYTE_CLIENT_SECRET are required.');
  if (!['basic', 'post'].includes(config.authMethod)) problems.push("AUTH_METHOD must be 'basic' or 'post'.");

  // A redirect URI whose port differs from the listening port produces an opaque invalid_request at
  // the hub rather than a routing error here, so it is worth catching before the first round trip.
  const port = Number(new URL(config.redirectUri).port || 80);
  if (port !== config.port) problems.push(`REDIRECT_URI port (${port}) does not match PORT (${config.port}).`);

  return problems;
}
