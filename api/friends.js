import { verifyGoogle } from './_auth.js';
import { db, dbReady, readBody, meProfile, pub, NAME_RE } from './_db.js';

async function lists(me) {
  const r = await db(`friends?or=(a.eq.${me},b.eq.${me})&select=a,b,status`);
  const rows = r.ok && r.data ? r.data : [];
  const ids = [...new Set(rows.map(x => (x.a === me ? x.b : x.a)))];
  let profs = {};
  if (ids.length) {
    const p = await db('profiles?id=in.(' + ids.join(',') + ')&select=id,name,tag,hero,stars');
    for (const x of (p.data || [])) profs[x.id] = pub(x);
  }
  const friends = [], incoming = [], outgoing = [];
  for (const x of rows) {
    const other = x.a === me ? x.b : x.a, p = profs[other]; if (!p) continue;
    if (x.status === 'accepted') friends.push(p); else if (x.b === me) incoming.push(p); else outgoing.push(p);
  }
  friends.sort((a, b) => a.name.localeCompare(b.name));
  return { friends, incoming, outgoing };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!dbReady()) return res.status(503).json({ error: 'db-not-configured' });
  const who = await verifyGoogle(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const me = await meProfile(who.sub);
  if (!me) return res.status(404).json({ error: 'no-profile' });

  if (req.method === 'GET') return res.status(200).json(await lists(me.id));
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let b; try { b = await readBody(req); } catch (_) { return res.status(400).json({ error: 'bad-body' }); }
  const uuid = /^[0-9a-f-]{36}$/i;

  if (b.action === 'add') {
    const m = String(b.handle || '').trim().replace(/^@/, '').match(/^(.+?)\s*#\s*(\d{4})$/);
    if (!m || !NAME_RE.test(m[1])) return res.status(400).json({ error: 'bad-handle' });
    const t = await db(`profiles?name=ilike.${encodeURIComponent(m[1].replace(/[_%\\]/g,c=>'\\'+c))}&tag=eq.${m[2]}&select=id,name,tag,hero,stars`);
    const target = t.data && t.data[0];
    if (!target) return res.status(404).json({ error: 'not-found' });
    if (target.id === me.id) return res.status(400).json({ error: 'self' });
    const ex = await db(`friends?or=(and(a.eq.${me.id},b.eq.${target.id}),and(a.eq.${target.id},b.eq.${me.id}))&select=a,b,status`);
    const row = ex.data && ex.data[0];
    if (row) {
      if (row.status === 'pending' && row.a === target.id) {
        await db(`friends?a=eq.${target.id}&b=eq.${me.id}`, { method: 'PATCH', body: { status: 'accepted' } });
        return res.status(200).json({ result: 'accepted', target: pub(target), ...(await lists(me.id)) });
      }
      return res.status(200).json({ result: row.status === 'accepted' ? 'already' : 'pending', target: pub(target), ...(await lists(me.id)) });
    }
    const cnt = await db(`friends?or=(a.eq.${me.id},b.eq.${me.id})&select=a`);
    if ((cnt.data || []).length >= 200) return res.status(400).json({ error: 'too-many' });
    await db('friends', { method: 'POST', body: { a: me.id, b: target.id, status: 'pending' } });
    return res.status(200).json({ result: 'sent', target: pub(target), ...(await lists(me.id)) });
  }
  if (b.action === 'accept' && uuid.test(b.id || '')) {
    await db(`friends?a=eq.${b.id}&b=eq.${me.id}`, { method: 'PATCH', body: { status: 'accepted' } });
    return res.status(200).json(await lists(me.id));
  }
  if (b.action === 'remove' && uuid.test(b.id || '')) {
    await db(`friends?or=(and(a.eq.${me.id},b.eq.${b.id}),and(a.eq.${b.id},b.eq.${me.id}))`, { method: 'DELETE' });
    return res.status(200).json(await lists(me.id));
  }
  return res.status(400).json({ error: 'bad-action' });
}
