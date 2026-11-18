import { createHash } from 'node:crypto';
import { verifyGoogle } from './_auth.js';
import { storeReady, sbRead, sbWrite, blobRead } from './_store.js';

const hashOf = sub => createHash('sha256').update('paint-clash:' + sub).digest('hex');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw new Error('too-big'); }
  return JSON.parse(raw || '{}');
}

// score de progression, pour choisir la sauvegarde la plus avancée
const prog = s => !s ? -1 : (+s.stars || 0) + 1000 * ((s.owned && s.owned.length) || 0) + 10 * (+s.games || 0) + (+s.passXp || +s.xp || 0);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query && req.query.health) {
    const out = { store: storeReady() ? 'ok' : 'missing' };
    try { await sbRead('_health.json'); } catch (e) { out.store = 'error: ' + String(e.message).slice(0, 80); }
    const b = await blobRead('saves/_health.json'); out.legacy = b.down ? 'down' : 'ok';
    return res.status(200).json(out);
  }
  const who = await verifyGoogle(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  if (!storeReady()) return res.status(503).json({ error: 'not-configured' });
  const h = hashOf(who.sub), name = h + '.json', legacy = 'saves/' + h + '.json';

  if (req.method === 'GET') {
    let cur;
    try { cur = await sbRead(name); } catch (e) { console.error('save read', e.message); return res.status(502).json({ error: 'read-failed' }); }
    let doc = cur.found ? cur.data : null, legacyDown = false;
    // pas encore migré (ou créé pendant la panne) : on regarde l'ancien stockage
    if (!doc || doc.prov) {
      const b = await blobRead(legacy);
      if (b.down) legacyDown = !doc;
      else if (b.found && b.data && b.data.save && prog(b.data.save) > prog(doc && doc.save)) {
        doc = { save: b.data.save, updatedAt: b.data.updatedAt || Date.now() };
        try { await sbWrite(name, doc); } catch (e) { console.error('migrate', e.message); }
      } else if (doc && doc.prov && !b.down) {
        try { await sbWrite(name, { save: doc.save, updatedAt: doc.updatedAt }); } catch (_) {}
      }
    }
    return res.status(200).json({ save: (doc && doc.save) || null, updatedAt: (doc && doc.updatedAt) || 0, email: who.email, name: who.name, legacyDown });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return res.status(400).json({ error: 'bad-body' }); }
    if (!body || typeof body.save !== 'object' || body.save === null) return res.status(400).json({ error: 'bad-body' });
    const doc = { save: body.save, updatedAt: Date.now() };
    if (body.prov) doc.prov = 1; // écrit alors que l'ancienne sauvegarde était illisible
    if (JSON.stringify(doc).length > 150000) return res.status(413).json({ error: 'too-big' });
    try { await sbWrite(name, doc); return res.status(200).json({ ok: true }); }
    catch (e) { console.error('save write', e.message); return res.status(502).json({ error: 'write-failed' }); }
  }

  res.setHeader('Allow', 'GET, PUT, POST');
  return res.status(405).json({ error: 'method' });
}
