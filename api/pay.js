// Achats de gemmes sur le site web (Stripe Checkout) — l'appli Android utilise Google Play.
import { sbRead, sbWrite } from './_store.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { verifyGoogle } from './_auth.js';

const PACKS = { 20: 99, 60: 249, 150: 499, 400: 999, 1000: 1999 }; // gemmes -> centimes d'euro
const SITE = 'https://paint-clash.vercel.app';
const credPath = sub => 'credits-' + createHash('sha256').update('paint-clash-pay:' + sub).digest('hex') + '.json';

async function rawBody(req) { let raw = ''; for await (const c of req) { raw += c; if (raw.length > 100000) break; } return raw; }
async function readCred(sub) { const r = await sbRead(credPath(sub)); return r.found ? r.data : { list: [] }; }
async function writeCred(sub, doc) { await sbWrite(credPath(sub), doc); }

function stripeSigOk(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, v]));
  const t = parts.t; const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - +t) > 600) return false;
  const exp = createHmac('sha256', secret).update(t + '.' + raw).digest('hex');
  return sigs.some(s => s.length === exp.length && timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const a = (req.query && req.query.a) || new URL(req.url, SITE).searchParams.get('a');
  const key = process.env.STRIPE_SECRET_KEY;

  // 1) Webhook Stripe : paiement confirmé -> crédit de gemmes en attente
  if (a === 'webhook' && req.method === 'POST') {
    const raw = await rawBody(req);
    if (!stripeSigOk(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return res.status(400).json({ error: 'sig' });
    let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: 'json' }); }
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      const s = ev.data && ev.data.object;
      if (s && s.payment_status === 'paid' && s.metadata && s.metadata.sub && PACKS[s.metadata.pack]) {
        const doc = await readCred(s.metadata.sub); doc.list = doc.list || [];
        if (!doc.list.some(c => c.id === s.id)) { doc.list.push({ id: s.id, gems: +s.metadata.pack, at: Date.now(), done: false }); await writeCred(s.metadata.sub, doc); }
      }
    }
    return res.status(200).json({ ok: true });
  }

  const who = await verifyGoogle(req);
  if (who.error) return res.status(who.status).json({ error: who.error });

  // 2) Créer une page de paiement Stripe pour un pack
  if (a === 'checkout' && req.method === 'POST') {
    if (!key) return res.status(503).json({ error: 'disabled' });
    let body = {}; try { body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(await rawBody(req) || '{}'); } catch (e) {}
    const pack = +body.pack; if (!PACKS[pack]) return res.status(400).json({ error: 'pack' });
    const f = new URLSearchParams();
    f.set('mode', 'payment');
    f.set('line_items[0][quantity]', '1');
    f.set('line_items[0][price_data][currency]', 'eur');
    f.set('line_items[0][price_data][unit_amount]', String(PACKS[pack]));
    f.set('line_items[0][price_data][product_data][name]', pack + ' gemmes — Keyboard Rivals');
    f.set('metadata[sub]', who.sub); f.set('metadata[pack]', String(pack));
    if (who.email) f.set('customer_email', who.email);
    f.set('success_url', SITE + '/?paid=1'); f.set('cancel_url', SITE + '/?paid=0');
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return res.status(502).json({ error: 'stripe' });
    return res.status(200).json({ url: j.url });
  }

  // 3) Récupérer les gemmes payées pas encore données
  if (a === 'claim') {
    const doc = await readCred(who.sub); const todo = (doc.list || []).filter(c => !c.done);
    if (!todo.length) return res.status(200).json({ gems: 0 });
    let gems = 0; for (const c of todo) { c.done = true; gems += c.gems; }
    await writeCred(who.sub, doc);
    return res.status(200).json({ gems });
  }

  return res.status(400).json({ error: 'action' });
}
