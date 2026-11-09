import { verifyGoogle } from './_auth.js';
import { db, dbReady, meProfile, pub } from './_db.js';

// Classement mondial par trophées (top 100) + le rang du joueur connecté.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!dbReady()) return res.status(503).json({ error: 'db-not-configured' });
  const r = await db('profiles?select=id,name,tag,hero,stars&order=stars.desc,created_at.asc&limit=100');
  if (!r.ok) return res.status(500).json({ error: 'db' });
  const top = (r.data || []).map(pub);
  let me = null;
  if (req.headers.authorization) {
    const who = await verifyGoogle(req);
    if (!who.error) {
      const p = await meProfile(who.sub);
      if (p) {
        const c = await db('profiles?select=id&stars=gt.' + (p.stars | 0) + '&limit=1', { prefer: 'count=exact' });
        const total = c.range ? parseInt(String(c.range).split('/')[1], 10) : NaN;
        me = Object.assign(pub(p), { rank: Number.isFinite(total) ? total + 1 : null });
      }
    }
  }
  return res.status(200).json({ top, me });
}
