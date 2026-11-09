import { put, get } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { verifyGoogle } from './_auth.js';

const pathFor = sub => 'saves/' + createHash('sha256').update('paint-clash:' + sub).digest('hex') + '.json';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw new Error('too-big'); }
  return JSON.parse(raw || '{}');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const who = await verifyGoogle(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const path = pathFor(who.sub);

  if (req.method === 'GET') {
    try {
      const r = await get(path, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return res.status(200).json({ save: null, email: who.email, name: who.name });
      const txt = await new Response(r.stream).text();
      const data = JSON.parse(txt);
      return res.status(200).json({ save: data.save || null, updatedAt: data.updatedAt || 0, email: who.email, name: who.name });
    } catch (e) {
      if (e && (e.name === 'BlobNotFoundError' || /not.?found/i.test(String(e.message)))) return res.status(200).json({ save: null, email: who.email, name: who.name });
      return res.status(500).json({ error: 'read-failed' });
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return res.status(400).json({ error: 'bad-body' }); }
    if (!body || typeof body.save !== 'object' || body.save === null) return res.status(400).json({ error: 'bad-body' });
    const doc = JSON.stringify({ save: body.save, updatedAt: Date.now() });
    if (doc.length > 150000) return res.status(413).json({ error: 'too-big' });
    try {
      await put(path, doc, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'write-failed' });
    }
  }

  res.setHeader('Allow', 'GET, PUT, POST');
  return res.status(405).json({ error: 'method' });
}
