// Vérifie un jeton Google (ID token) et renvoie l'identifiant du compte.
export async function verifyGoogle(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return { error: 'not-configured', status: 503 };
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return { error: 'no-token', status: 401 };
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
