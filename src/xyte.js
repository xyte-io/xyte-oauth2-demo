import { config } from './config.js';

// The five probes that make the difference between the two flows visible. An organization token
// answers all of them; a member token is narrowed to that member's own access and 403s on the
// administrator-only ones.
export const PROBES = [
  { path: '/core/v1/organization/info', note: 'Organization profile — both flows can read it.' },
  { path: '/core/v1/organization/devices?per_page=50', note: 'An organization token sees every device; a member token sees only the devices shared with them.' },
  { path: '/core/v1/organization/spaces', note: 'Same narrowing as devices.' },
  { path: '/core/v1/organization/users', note: 'Administrator-only — 403 "Not authorized" for a member token.' },
  { path: '/core/v1/organization/groups', note: 'Administrator-only — 403 "Not authorized" for a member token.' }
];

function summarize(body) {
  if (body == null) return '(empty body)';
  if (body.error) return String(body.error);

  if (Array.isArray(body.items)) {
    const names = body.items.map((item) => item.name ?? item.email ?? item.id).filter(Boolean);
    return `${body.items.length} item(s)${names.length ? `: ${names.slice(0, 10).join(', ')}` : ''}`;
  }

  if (body.name) return `${body.name}${body.statistics ? ` — ${JSON.stringify(body.statistics)}` : ''}`;

  return Object.keys(body).slice(0, 8).join(', ');
}

export async function probe(path, accessToken) {
  try {
    const response = await fetch(`${config.hub}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      // Bounded like every other call: five probes run in parallel on each dashboard render, and a
      // stalled hub would otherwise hang the page indefinitely.
      signal: AbortSignal.timeout(10_000)
    });
    const text = await response.text();

    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    return {
      path,
      status: response.status,
      // The hub spells out why a token was refused in this header; it is the fastest way to tell an
      // expired token from a scope problem.
      challenge: response.headers.get('www-authenticate') ?? '',
      summary: body ? summarize(body) : text.slice(0, 120)
    };
  } catch (error) {
    return { path, status: 0, challenge: '', summary: `request failed: ${error.message}` };
  }
}

export function probeAll(accessToken) {
  return Promise.all(PROBES.map(async ({ path, note }) => ({ ...(await probe(path, accessToken)), note })));
}
