import { randomBytes } from 'node:crypto';

const COOKIE = 'xyte_demo_sid';

// In-memory only: restarting the demo signs everyone out, which is exactly what you want while
// stepping through the flows. A real vendor app would persist this server-side.
const sessions = new Map();

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf('=');
        return at === -1 ? [part, ''] : [part.slice(0, at), decodeURIComponent(part.slice(at + 1))];
      })
  );
}

export function loadSession(req, res) {
  const existing = parseCookies(req)[COOKIE];
  if (existing && sessions.has(existing)) return sessions.get(existing);

  const id = randomBytes(18).toString('base64url');
  const session = { id };
  sessions.set(id, session);

  // SameSite=Lax still sends the cookie on the hub's top-level redirect back to /callback, which is
  // what lets us match the returned `state` against the one we stored.
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`);
  return session;
}

export function clearSession(session) {
  for (const key of Object.keys(session)) {
    if (key !== 'id') delete session[key];
  }
}
