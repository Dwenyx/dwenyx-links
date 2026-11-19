import { createHash } from 'node:crypto';
import { verifyGoogle } from './_auth.js';
import { storeReady, sbRead, sbWrite, blobRead } from './_store.js';
import { dbReady, meProfile, splitHero } from './_db.js';

const hashOf = sub => createHash('sha256').update('paint-clash:' + sub).digest('hex');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw new Error('too-big'); }
  return JSON.parse(raw || '{}');
}

// XP de compte minimale pour un niveau donné (même formule que le jeu)
const xpFor = l => { let x = 0; for (let k = 1; k < l; k++) x += 100 + 40 * (k - 1); return x; };
// secours : l'ancienne sauvegarde est illisible -> on remet au moins les stats publiques du profil (trophées, niveau, victoires…)
async function profileRestore(sub, save) {
  if (!dbReady()) return null;
  let p = null; try { p = await meProfile(sub); } catch (_) { return null; }
  if (!p) return null;
  const { hero, x } = splitHero(p.hero), s = Object.assign({}, save || {}), mx = (k, v) => { if ((+v || 0) > (+s[k] || 0)) s[k] = +v; };
  mx('stars', p.stars); mx('hiStars', Math.max(+x.hi || 0, +p.stars || 0)); mx('wins', x.w); mx('teamWins', x.tw); mx('kills', x.k); mx('games', x.g);
  const ax = xpFor(Math.max(1, +x.l || 1)); if ((+s.accXp || 0) < ax) s.accXp = ax;
  if (hero) { s.owned = Array.isArray(s.owned) ? s.owned.slice() : ['cubo', 'pepin']; if (!s.owned.includes(hero)) s.owned.push(hero); s.levels = Object.assign({}, s.levels || {}); if (!s.levels[hero]) s.levels[hero] = 1; }
  if (typeof x.i === 'string' && !s.icon) s.icon = x.i; if (typeof x.t === 'string' && !s.title) s.title = x.t;
  return s;
}
// score de progression, pour choisir la sauvegarde la plus avancée
const prog = s => !s ? -1 : (+s.stars || 0) + 1000 * ((s.owned && s.owned.length) || 0) + 10 * (+s.games || 0) + (+s.passXp || +s.xp || 0);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query && req.query.health) {
    const out = { store: storeReady() ? 'ok' : 'missing' };
    try { await sbWrite('_health.json', { t: Date.now() }); const r = await sbRead('_health.json'); out.store = r.found ? 'ok' : 'write-not-found'; } catch (e) { out.store = 'error: ' + String(e.message).slice(0, 160); }
    const b = await blobRead('saves/_health.json'); out.legacy = b.down ? 'down' : 'ok';
    return res.status(200).json(out);
  }
  // sauvegarde de secours de toutes les stats publiques (aucune donnée renvoyée, juste le nombre)
  if (req.query && req.query.backup && dbReady()) {
    try { const { db } = await import('./_db.js'); const r = await db('profiles?select=id,sub_hash,name,tag,hero,stars&limit=10000');
      const day = new Date().toISOString().slice(0, 10); await sbWrite('backup-profiles-' + day + '.json', { at: Date.now(), rows: r.data || [] });
      return res.status(200).json({ ok: true, n: (r.data || []).length }); } catch (e) { return res.status(500).json({ error: 'backup' }); }
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
    // ancienne sauvegarde toujours illisible : on complète avec les stats du profil (une seule fois)
    if ((legacyDown || (doc && doc.prov)) && !(doc && doc.restored)) {
      const rs = await profileRestore(who.sub, doc && doc.save);
      if (rs) { doc = { save: rs, updatedAt: Date.now(), prov: 1, restored: 1 }; try { await sbWrite(name, doc); } catch (_) {} legacyDown = true; }
    }
    return res.status(200).json({ save: (doc && doc.save) || null, updatedAt: (doc && doc.updatedAt) || 0, email: who.email, name: who.name, legacyDown: legacyDown || !!(doc && doc.prov) });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return res.status(400).json({ error: 'bad-body' }); }
    if (!body || typeof body.save !== 'object' || body.save === null) return res.status(400).json({ error: 'bad-body' });
    const doc = { save: body.save, updatedAt: Date.now() };
    if (body.prov) { doc.prov = 1; doc.restored = 1; } // écrit alors que l'ancienne sauvegarde était illisible
    if (JSON.stringify(doc).length > 150000) return res.status(413).json({ error: 'too-big' });
    try { await sbWrite(name, doc); return res.status(200).json({ ok: true }); }
    catch (e) { console.error('save write', e.message); return res.status(502).json({ error: 'write-failed' }); }
  }

  res.setHeader('Allow', 'GET, PUT, POST');
  return res.status(405).json({ error: 'method' });
}
