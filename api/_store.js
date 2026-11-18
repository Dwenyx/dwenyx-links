// Stockage des sauvegardes : Supabase Storage (bucket privé "saves").
// Vercel Blob reste lu en secours pour récupérer les anciennes sauvegardes.
import { get as blobGet } from '@vercel/blob';

const BUCKET = 'saves';
const base = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1';
export const storeReady = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

async function sbFetch(path, opt = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const h = Object.assign({ apikey: key }, opt.headers || {});
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  let r = await fetch(base() + path, Object.assign({}, opt, { headers: h }));
  if ((r.status === 401 || r.status === 403 || r.status === 400) && !h.Authorization) {
    h.Authorization = 'Bearer ' + key;
    r = await fetch(base() + path, Object.assign({}, opt, { headers: h }));
  }
  return r;
}

let bucketOk = false;
async function ensureBucket() {
  if (bucketOk) return;
  const r = await sbFetch('/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (r.ok || r.status === 409 || r.status === 400) bucketOk = true; // 400/409 = existe déjà
}

// renvoie {found:true,data} / {found:false} ; lève une erreur si le service ne répond pas
export async function sbRead(name) {
  const r = await sbFetch('/object/' + BUCKET + '/' + name, { method: 'GET' });
  if (r.status === 404 || r.status === 400) return { found: false };
  if (!r.ok) throw new Error('sb-read ' + r.status);
  const t = await r.text();
  return { found: true, data: JSON.parse(t) };
}

export async function sbWrite(name, obj) {
  const body = JSON.stringify(obj);
  const go = () => sbFetch('/object/' + BUCKET + '/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }, body });
  let r = await go();
  if (!r.ok) { await ensureBucket(); r = await go(); }
  if (!r.ok) throw new Error('sb-write ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

// ancien stockage : {found,data} ou {down:true}
export async function blobRead(path) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { found: false };
  try {
    const r = await blobGet(path, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return { found: false };
    return { found: true, data: JSON.parse(await new Response(r.stream).text()) };
  } catch (e) {
    if (e && (e.name === 'BlobNotFoundError' || /not.?found/i.test(String(e.message)))) return { found: false };
    return { down: true };
  }
}
