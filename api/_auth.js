import crypto from 'node:crypto';

// Clé de signature des sessions (aucune variable à ajouter : dérivée d'un secret déjà présent).
function secret() {
  const base = process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.BLOB_READ_WRITE_TOKEN || '';
  return base ? crypto.createHash('sha256').update('kr-session:' + base).digest() : null;
}
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Crée une session longue durée (180 jours) pour la reconnexion automatique.
export function makeSession(who) {
  const key = secret();
  if (!key) return null;
  const body = b64u(JSON.stringify({ sub: who.sub, email: who.email || '', name: who.name || '', exp: Math.floor(Date.now() / 1000) + 180 * 86400 }));
  const sig = b64u(crypto.createHmac('sha256', key).update(body).digest());
  return 's1.' + body + '.' + sig;
}

function readSession(token) {
  const key = secret();
  const parts = token.split('.');
  if (!key || parts.length !== 3) return null;
  const sig = b64u(crypto.createHmac('sha256', key).update(parts[1]).digest());
  if (sig.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return null;
  try {
    const b = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!b.sub || b.exp * 1000 < Date.now()) return null;
    return { sub: b.sub, email: b.email, name: b.name };
  } catch (e) { return null; }
}

// Vérifie un jeton Google (ID token) ou une session du jeu et renvoie l'identifiant du compte.
export async function verifyGoogle(req, allowSession = true) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return { error: 'not-configured', status: 503 };
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return { error: 'no-token', status: 401 };
  if (token.startsWith('s1.')) {
    const s = allowSession ? readSession(token) : null;
    return s || { error: 'bad-token', status: 401 };
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
    if (!r.ok) return { error: 'bad-token', status: 401 };
    const t = await r.json();
    const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
    if (t.aud !== clientId || !issOk || +t.exp * 1000 < Date.now()) return { error: 'bad-token', status: 401 };
    return { sub: t.sub, email: t.email, name: t.given_name || t.name || '' };
  } catch (e) {
    return { error: 'verify-failed', status: 502 };
  }
}
