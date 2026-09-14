import { randomBytes } from 'node:crypto';

const COOKIE = 'xyte_demo_sid';

// In-memory only: restarting the demo signs everyone out, which is exactly what you want while
// stepping through the flows. Nothing is ever evicted either — fine for a demo, but a real vendor app
// persists this server-side, per user, with a TTL and a sweep.
const sessions = new Map();

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        // No decodeURIComponent: the ids are base64url, and a malformed cookie would otherwise throw
        // a URIError that turns every page into a 500.
        const at = part.indexOf('=');
        return at === -1 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
      })
  );
}

// SameSite=Lax does two jobs here. It still sends the cookie on the hub's top-level redirect back to
// /callback, which is what lets us match the returned `state`; and it is the only thing stopping
// another site from POSTing to /refresh or /revoke on a visitor's behalf. Relaxing it to None would
// remove that CSRF defence, so a copy of this code would need real CSRF tokens instead.
function setCookie(res, value, extra = '') {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${extra}`);
}

const newId = () => randomBytes(18).toString('base64url');

export function loadSession(req, res) {
  const existing = parseCookies(req)[COOKIE];
  if (existing && sessions.has(existing)) return sessions.get(existing);

  const session = { id: newId() };
  sessions.set(session.id, session);
  setCookie(res, session.id);
  return session;
}

// A session id that existed before the user signed in must not still be valid afterwards, or anyone
// who managed to plant that cookie inherits the login. Rotating on every privilege change — sign-in
// and sign-out — is the standard defence against session fixation.
export function rotateSession(session, res) {
  sessions.delete(session.id);
  session.id = newId();
  sessions.set(session.id, session);
  setCookie(res, session.id);
}

export function clearSession(session) {
  for (const key of Object.keys(session)) {
    if (key !== 'id') delete session[key];
  }
}
