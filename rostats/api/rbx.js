// Relais RoStats : la version web (iPhone) ne peut pas appeler Roblox directement (CORS).
// Seuls les domaines utiles à RoStats sont autorisés.
const ALLOWED = [
  /(^|\.)roblox\.com$/, /(^|\.)rbxcdn\.com$/, /^api\.frankfurter\.dev$/, /^api\.frankfurter\.app$/, /^open\.er-api\.com$/,
  /\.hf\.space$/, /^huggingface\.co$/,
];
const DROP = new Set(['host', 'cookie', 'origin', 'referer', 'connection', 'content-length', 'accept-encoding']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  try {
    const { url, method = 'GET', headers = {}, bodyB64 = '', timeout = 30000 } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED.some((r) => r.test(u.hostname))) return res.status(200).json({ error: 'Domaine non autorisé : ' + u.hostname });
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (!DROP.has(k.toLowerCase())) h[k] = String(v);
    h['User-Agent'] = 'RoStats-Web/1.12';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(Number(timeout) || 30000, 55000));
    const r = await fetch(u, {
      method,
      headers: h,
      body: ['GET', 'HEAD'].includes(method.toUpperCase()) || !bodyB64 ? undefined : Buffer.from(bodyB64, 'base64'),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4_000_000) return res.status(200).json({ error: 'Réponse trop lourde' });
    const outHeaders = {};
    r.headers.forEach((v, k) => { outHeaders[k.toLowerCase()] = v; });
    return res.status(200).json({ status: r.status, headers: outHeaders, bodyB64: buf.toString('base64') });
  } catch (e) {
    return res.status(200).json({ error: String(e.name === 'AbortError' ? 'Délai dépassé' : e.message || e) });
  }
}
