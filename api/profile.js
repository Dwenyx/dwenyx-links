import { verifyGoogle } from './_auth.js';
import { db, dbReady, subHash, cleanName, randTag, readBody, meProfile, NAME_RE } from './_db.js';
const DAY = 86400000, LOCK = 30 * DAY;
const out = p => ({ id: p.id, name: p.name, tag: p.tag, hero: p.hero, stars: p.stars, nextRename: new Date(p.name_changed_at).getTime() + LOCK });

async function createProfile(sub, wanted) {
  const name = cleanName(wanted);
  for (let i = 0; i < 12; i++) {
    const r = await db('profiles?select=id,name,tag,name_changed_at,hero,stars', { method: 'POST', prefer: 'return=representation', body: { sub_hash: subHash(sub), name, tag: randTag() } });
    if (r.ok && r.data && r.data[0]) return r.data[0];
    if (r.status === 409) { const ex = await meProfile(sub); if (ex) return ex; continue; }
    return null;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!dbReady()) return res.status(503).json({ error: 'db-not-configured' });
  const who = await verifyGoogle(req);
  if (who.error) return res.status(who.status).json({ error: who.error });

  if (req.method === 'GET') {
    let p = await meProfile(who.sub);
    if (!p) p = await createProfile(who.sub, (req.query && req.query.name) || who.name);
    if (!p) return res.status(500).json({ error: 'create-failed' });
    return res.status(200).json(out(p));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let b; try { b = await readBody(req); } catch (_) { return res.status(400).json({ error: 'bad-body' }); }
  const p = await meProfile(who.sub);
  if (!p) return res.status(404).json({ error: 'no-profile' });

  if (b.action === 'sync') {
    const hero = String(b.hero || 'cubo').slice(0, 20), stars = Math.max(0, Math.min(1e6, b.stars | 0));
    await db('profiles?id=eq.' + p.id, { method: 'PATCH', body: { hero, stars } });
    return res.status(200).json({ ok: true });
  }
  if (b.action === 'rename') {
    const name = String(b.name || '').trim();
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'bad-name' });
    const next = new Date(p.name_changed_at).getTime() + LOCK;
    if (Date.now() < next) return res.status(429).json({ error: 'too-soon', nextRename: next });
    let tag = p.tag;
    for (let i = 0; i < 12; i++) {
      const r = await db('profiles?id=eq.' + p.id + '&select=id,name,tag,name_changed_at,hero,stars', { method: 'PATCH', prefer: 'return=representation', body: { name, tag, name_changed_at: new Date().toISOString() } });
      if (r.ok && r.data && r.data[0]) return res.status(200).json(out(r.data[0]));
      if (r.status === 409) { tag = randTag(); continue; }
      return res.status(500).json({ error: 'rename-failed' });
    }
    return res.status(409).json({ error: 'name-taken' });
  }
  return res.status(400).json({ error: 'bad-action' });
}
