import { createHash } from 'node:crypto';
export const subHash = sub => createHash('sha256').update('paint-clash:' + sub).digest('hex');
export function dbReady() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY); }
export async function db(path, { method = 'GET', body, prefer } = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  if (prefer) h.Prefer = prefer;
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch (_) {}
  return { ok: r.ok, status: r.status, data };
}
export const NAME_RE = /^[A-Za-z0-9_\-À-ÖØ-öø-ÿ]{3,12}$/;
export function cleanName(n) {
  let s = String(n || '').normalize('NFC').replace(/\s+/g, '').replace(/[^A-Za-z0-9_\-À-ÖØ-öø-ÿ]/g, '').slice(0, 12);
  if (s.length < 3) s = (s + 'Joueur').slice(0, 12);
  return s;
}
export const randTag = () => String(1000 + Math.floor(Math.random() * 9000));
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = ''; for await (const c of req) { raw += c; if (raw.length > 20000) throw new Error('too-big'); }
  return JSON.parse(raw || '{}');
}
export async function meProfile(sub) {
  const r = await db('profiles?sub_hash=eq.' + subHash(sub) + '&select=id,name,tag,name_changed_at,hero,stars');
  return r.ok && r.data && r.data[0] ? r.data[0] : null;
}
export const pub = p => ({ id: p.id, name: p.name, tag: p.tag, hero: p.hero, stars: p.stars });
