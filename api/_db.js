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
  return { ok: r.ok, status: r.status, data, range: r.headers.get('content-range') };
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
// hero = "<id>~<json>" : l'id du héros + les infos publiques du profil (photo, titre, stats)
export function splitHero(v) {
  const s = String(v || 'cubo'), i = s.indexOf('~');
  let x = {}; if (i >= 0) { try { x = JSON.parse(s.slice(i + 1)) || {}; } catch (_) { x = {}; } }
  return { hero: (i >= 0 ? s.slice(0, i) : s) || 'cubo', x };
}
const n = v => Math.max(0, Math.min(1e9, Math.floor(+v || 0)));
export const pub = p => {
  const { hero, x } = splitHero(p.hero);
  return { id: p.id, name: p.name, tag: p.tag, hero, stars: p.stars, icon: typeof x.i === 'string' ? x.i : undefined, title: typeof x.t === 'string' ? x.t : undefined,
    wins: n(x.w), teamWins: n(x.tw), tw: n(x.tw), kills: n(x.k), games: n(x.g), hi: n(x.hi), lvl: n(x.l) || 1 };
};
export function packHero(hero, x) {
  const h = String(hero || 'cubo').replace(/[^a-z0-9_]/gi, '').slice(0, 20) || 'cubo';
  if (!x || typeof x !== 'object') return h;
  const ok = v => typeof v === 'string' && /^[a-z0-9_:]{1,30}$/i.test(v) ? v : undefined;
  const o = { i: ok(x.i), t: ok(x.t), w: n(x.w), tw: n(x.tw), k: n(x.k), g: n(x.g), hi: n(x.hi), l: n(x.l) };
  return h + '~' + JSON.stringify(o);
}
