// Généré automatiquement depuis src/main.js — ne pas modifier à la main
(function () {
'use strict';
const fetch = window.nativeFetch;
const Buffer = window.Buffer;
const UA = 'RoStats/1.13 (Android)';
const session = { defaultSession: { cookies: { get: async () => { const v = window.robloxCookie(); return v ? [{ value: v }] : []; } } } };

// ---------- HTTP avec retry / gestion du rate-limit ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Session Roblox (connexion optionnelle pour voir ses jeux restreints) ----------
let rbxCookie = null;
let csrf = '';
async function loadRobloxCookie() {
  try {
    const c = await session.defaultSession.cookies.get({ url: 'https://www.roblox.com', name: '.ROBLOSECURITY' });
    rbxCookie = c[0]?.value || null;
  } catch { rbxCookie = null; }
  return rbxCookie;
}
const isRobloxWeb = (u) => { try { const h = new URL(u).hostname; return h.endsWith('.roblox.com') && !h.startsWith('apis.'); } catch { return false; } };

async function http(url, { headers = {}, method = 'GET', body, retries = 3, timeout = 15000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const auth = rbxCookie && isRobloxWeb(url) && !headers['x-api-key'];
      const doFetch = () => fetch(url, {
        method,
        headers: {
          'User-Agent': UA, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(auth ? { Cookie: '.ROBLOSECURITY=' + rbxCookie, ...(method !== 'GET' && csrf ? { 'x-csrf-token': csrf } : {}) } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
      let res = await doFetch();
      if (auth && res.status === 403 && res.headers.get('x-csrf-token')) { csrf = res.headers.get('x-csrf-token'); res = await doFetch(); }
      if ((res.status === 429 || res.status >= 500) && i < retries) {
        lastErr = new Error('HTTP ' + res.status);
        await sleep(800 * Math.pow(2, i) + Math.random() * 300);
        continue;
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { ok: res.ok, status: res.status, json, text };
    } catch (e) {
      lastErr = e;
      await sleep(600 * (i + 1));
    }
  }
  throw lastErr || new Error('Requête échouée');
}

async function getJSON(url, opts) {
  const r = await http(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${new URL(url).hostname}`);
  return r.json;
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// ---------- API Roblox publiques ----------
async function universeFromPlace(placeId) {
  const r = await http(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  if (r.ok && r.json && r.json.universeId) return r.json.universeId;
  return null;
}

async function resolveGame(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Entre un lien ou un ID de jeu.');
  // Lien roblox.com/games/<placeId>/...
  const m = s.match(/games\/(\d+)/i) || s.match(/placeId=(\d+)/i);
  if (m) {
    const u = await universeFromPlace(m[1]);
    if (!u) throw new Error('Impossible de trouver ce jeu (Place ID ' + m[1] + ').');
    return u;
  }
  if (/^\d+$/.test(s)) {
    // D'abord comme Place ID, sinon comme Universe ID
    const u = await universeFromPlace(s);
    if (u) return u;
    const g = await getJSON(`https://games.roblox.com/v1/games?universeIds=${s}`);
    if (g && g.data && g.data.length) return Number(s);
    throw new Error('Aucun jeu trouvé avec cet ID.');
  }
  throw new Error('Format non reconnu. Colle le lien du jeu ou son Place ID.');
}

async function fastGames(q) {
  const r = await http(`https://games.roblox.com/v1/games?universeIds=${q}`, { retries: 0 });
  if (r.status === 429) { const e = new Error('Limite de requêtes Roblox atteinte'); e.code = 'RATE'; throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status + ' sur games.roblox.com');
  return r.json;
}

async function fetchGames(universeIds, opts = {}) {
  const { votes: wantVotes = true, icons: wantIcons = true } = opts;
  const ids = [...new Set(universeIds.map(Number).filter(Boolean))];
  const out = {};
  for (const part of chunk(ids, 50)) {
    const q = part.join(',');
    const [games, votes, icons, thumbs] = await Promise.allSettled([
      fastGames(q),
      wantVotes ? getJSON(`https://games.roblox.com/v1/games/votes?universeIds=${q}`) : Promise.resolve(null),
      wantIcons ? getJSON(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${q}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`) : Promise.resolve(null),
      wantIcons ? getJSON(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${q}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`) : Promise.resolve(null),
    ]);
    if (games.status === 'fulfilled' && games.value?.data) {
      games.value.data.forEach((g, idx) => {
        if (!g.id || g.isContentRestricted) {
          // Roblox masque ce jeu (contenu restreint) : on le signale au lieu de l'ignorer
          const uid = part.filter((id) => !games.value.data.some((x) => x.id === id) && !out[id])[0];
          if (uid && !out[uid]) out[uid] = { universeId: uid, restricted: true, playing: null, visits: null, favorites: null };
          return;
        }
        out[g.id] = {
          universeId: g.id, placeId: g.rootPlaceId, name: g.name, creator: g.creator?.name || '',
          creatorType: g.creator?.type || '', creatorId: g.creator?.id || null, playing: g.playing ?? 0, visits: g.visits ?? 0,
          favorites: g.favoritedCount ?? 0, maxPlayers: g.maxPlayers ?? 0, created: g.created,
          updated: g.updated, genre: g.genre || '', description: g.description || '', restricted: false,
        };
      });
    } else if (games.status === 'rejected') {
      throw games.reason;
    }
    if (votes.status === 'fulfilled' && votes.value?.data) {
      for (const v of votes.value.data) if (out[v.id]) { out[v.id].up = v.upVotes; out[v.id].down = v.downVotes; }
    }
    if (icons.status === 'fulfilled' && icons.value?.data) {
      for (const ic of icons.value.data) if (out[ic.targetId]) out[ic.targetId].icon = ic.imageUrl;
    }
    if (thumbs.status === 'fulfilled' && thumbs.value?.data) {
      for (const t of thumbs.value.data) { const u = t.thumbnails?.[0]?.imageUrl; if (u && out[t.universeId]) out[t.universeId].thumb = u; }
    }
  }
  return out;
}

async function fetchGroups(groupIds) {
  const ids = [...new Set(groupIds.map(Number).filter(Boolean))];
  const out = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const g = await getJSON(`https://groups.roblox.com/v1/groups/${id}`);
      out[id] = { id, name: g.name, memberCount: g.memberCount ?? 0, owner: g.owner?.username || g.owner?.displayName || '', verified: !!g.hasVerifiedBadge, description: g.description || '' };
    } catch {}
  }));
  for (const part of chunk(ids, 50)) {
    try {
      const r = await getJSON(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${part.join(',')}&size=150x150&format=Png&isCircular=false`);
      for (const ic of r?.data || []) if (out[ic.targetId]) out[ic.targetId].icon = ic.imageUrl;
    } catch {}
  }
  return out;
}

// ---------- Découverte : tendances, recherche, jeux à l'affiche ----------
const SITE_URL = 'https://rostats-app.vercel.app';
const newSession = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(16) + Math.random().toString(16).slice(2));
function pickGame(x) {
  const uid = Number(x.universeId || x.universe_id);
  if (!uid) return null;
  return { universeId: uid, placeId: x.rootPlaceId || x.placeId || null, name: x.name || '', playing: Number(x.playerCount ?? x.playing ?? 0), up: Number(x.totalUpVotes ?? 0), down: Number(x.totalDownVotes ?? 0), creator: x.creatorName || '' };
}
async function exploreSorts() {
  const r = await getJSON(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${newSession()}&device=computer&country=all`);
  return (r.sorts || [])
    .filter((s) => Array.isArray(s.games) && s.games.length)
    .slice(0, 6)
    .map((s) => ({ id: s.sortId || '', title: s.sortDisplayName || s.topic || 'Tendances', games: s.games.map(pickGame).filter(Boolean).slice(0, 20) }));
}
async function searchGames(q) {
  q = String(q || '').trim();
  if (!q) return [];
  // un lien ou un ID de jeu : on le résout directement
  if (/roblox\.com\/games\/\d+|^\d{5,}$/.test(q)) {
    try { const uid = await resolveGame(q); return uid ? [{ universeId: uid }] : []; } catch { /* recherche normale */ }
  }
  const r = await getJSON(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${newSession()}&pageType=all`);
  const out = [];
  for (const grp of r.searchResults || []) {
    if (grp.contentGroupType && grp.contentGroupType !== 'Game') continue;
    for (const c of grp.contents || []) { const g = pickGame(c); if (g && !out.some((o) => o.universeId === g.universeId)) out.push(g); }
  }
  return out.slice(0, 30);
}
async function featuredGames() {
  try {
    const r = await getJSON(`${SITE_URL}/featured.json?t=${Math.floor(Date.now() / 300000)}`);
    return Array.isArray(r.games) ? r.games.filter((g) => Number(g.universeId)) : [];
  } catch { return []; }
}

async function fetchServers(placeId) {
  let cursor = '';
  const servers = [];
  for (let page = 0; page < 5; page++) {
    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=Desc&limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
    const r = await http(url, { retries: 1 });
    if (!r.ok || !r.json) break;
    servers.push(...(r.json.data || []));
    cursor = r.json.nextPageCursor;
    if (!cursor) break;
    await sleep(250);
  }
  const n = servers.length;
  const sum = (k) => servers.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  const withPing = servers.filter((s) => s.ping != null);
  const withFps = servers.filter((s) => s.fps != null);
  return {
    count: n,
    players: sum('playing'),
    avgPlayers: n ? sum('playing') / n : 0,
    full: servers.filter((s) => s.playing >= s.maxPlayers).length,
    avgPing: withPing.length ? withPing.reduce((a, s) => a + s.ping, 0) / withPing.length : null,
    avgFps: withFps.length ? withFps.reduce((a, s) => a + s.fps, 0) / withFps.length : null,
    truncated: !!cursor,
  };
}

async function importUserGames(username) {
  const u = await getJSON('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', body: { usernames: [String(username).trim()], excludeBannedUsers: false },
  });
  const user = u?.data?.[0];
  if (!user) throw new Error('Utilisateur Roblox introuvable.');
  const ids = [];
  let cursor = '';
  for (let i = 0; i < 4; i++) {
    const r = await getJSON(`https://games.roblox.com/v2/users/${user.id}/games?accessFilter=Public&limit=50&sortOrder=Desc${cursor ? '&cursor=' + cursor : ''}`);
    for (const g of r?.data || []) ids.push(g.id);
    cursor = r?.nextPageCursor;
    if (!cursor) break;
  }
  return { userId: user.id, name: user.name, universeIds: ids };
}

async function importGroupGames(groupId) {
  const ids = [];
  let cursor = '';
  for (let i = 0; i < 4; i++) {
    const r = await getJSON(`https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=Public&limit=50&sortOrder=Desc${cursor ? '&cursor=' + cursor : ''}`);
    for (const g of r?.data || []) ids.push(g.id);
    cursor = r?.nextPageCursor;
    if (!cursor) break;
  }
  return { universeIds: ids };
}

// ---------- Revenus via Open Cloud (DataStore écrit par le tracker Luau) ----------
async function readEntry(universeId, apiKey, store, key) {
  const url = `https://apis.roblox.com/datastores/v1/universes/${universeId}/standard-datastores/datastore/entries/entry?datastoreName=${encodeURIComponent(store)}&entryKey=${encodeURIComponent(key)}`;
  const r = await http(url, { headers: { 'x-api-key': apiKey }, retries: 2 });
  if (r.status === 404 || (r.json && /NOT_FOUND|not found/i.test(JSON.stringify(r.json)) && !r.ok)) return null;
  if (r.status === 401 || r.status === 403) {
    const e = new Error('Clé API refusée : vérifie la permission « universe-datastores.objects:read » pour ce jeu et l’adresse IP autorisée.');
    e.code = 'AUTH';
    throw e;
  }
  if (!r.ok) throw new Error('Open Cloud : HTTP ' + r.status);
  return r.json ?? (r.text ? JSON.parse(r.text) : null);
}

function utcDay(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function fetchRevenue({ universeId, keyEnc, store = 'RoStats_v1', days = 7 }) {
  const apiKey = decrypt(keyEnc);
  if (!apiKey) throw new Error('Aucune clé API configurée.');
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = utcDay(i);
    const v = await readEntry(universeId, apiKey, store, 'day_' + day);
    out.push({ day, ...(normalizeDay(v)) });
    if (i < days - 1) await sleep(120);
  }
  return out.reverse();
}

function normalizeDay(v) {
  v = v || {};
  return {
    robux: Number(v.robux) || 0, sales: Number(v.sales) || 0, joins: Number(v.joins) || 0,
    sessions: Number(v.sessions) || 0, playSeconds: Number(v.playSeconds) || 0,
    peak: Number(v.peak) || 0, items: v.items && typeof v.items === 'object' ? v.items : {},
    ccu: v.ccu && typeof v.ccu === 'object' ? v.ccu : {},
  };
}

// ---------- Taux de change USD → EUR (BCE via Frankfurter) ----------
let fxCache = null;
async function usdEur() {
  if (fxCache && Date.now() - fxCache.at < 6 * 3600000) return fxCache;
  const urls = [
    ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR', (j) => j?.rates?.EUR],
    ['https://api.frankfurter.app/latest?from=USD&to=EUR', (j) => j?.rates?.EUR],
    ['https://open.er-api.com/v6/latest/USD', (j) => j?.rates?.EUR],
  ];
  for (const [u, pick] of urls) {
    try {
      const r = await http(u, { retries: 1 });
      const rate = r.ok ? Number(pick(r.json)) : NaN;
      if (rate > 0.3 && rate < 3) { fxCache = { rate, at: Date.now(), date: r.json?.date || null, source: new URL(u).hostname }; return fxCache; }
    } catch {}
  }
  if (fxCache) return fxCache;
  throw new Error('Taux de change indisponible');
}

// ---------- IA : génération de miniatures ----------
const thumbsDir = () => path.join(dataDir(), 'thumbnails');

function parseDataUrl(u) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(u || '');
  return m ? { mime: m[1], b64: m[2] } : null;
}

// Cherche récursivement toutes les images base64 dans une réponse JSON (robuste aux variations d'API)
function findImages(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => findImages(n, out)); return out; }
  const inline = node.inlineData || node.inline_data;
  if (inline && inline.data && /image/.test(inline.mimeType || inline.mime_type || 'image')) {
    out.push(`data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`);
  } else if (node.b64_json) {
    out.push(`data:image/png;base64,${node.b64_json}`);
  } else if (node.type === 'image' && typeof node.data === 'string' && node.data.length > 200) {
    out.push(`data:${node.mime_type || node.mimeType || 'image/png'};base64,${node.data}`);
  } else {
    for (const k of Object.keys(node)) if (k !== 'input') findImages(node[k], out);
  }
  return out;
}

function apiError(r, provider) {
  const msg = r.json?.error?.message || r.json?.message || (r.text || '').slice(0, 300);
  if (r.status === 401 || r.status === 403) return new Error(`${provider} : clé API refusée (${msg || r.status}).`);
  if (r.status === 429) return new Error(`${provider} : quota ou limite atteinte. ${msg}`);
  return new Error(`${provider} : erreur ${r.status}. ${msg}`);
}

async function geminiGenerate({ key, model, prompt, images }) {
  const imgs = images.map(parseDataUrl).filter(Boolean);
  const headers = { 'x-goog-api-key': key };
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const errors = [];
  // 1) API Interactions (format actuel de la doc Nano Banana)
  if (!/^gemini-2\.5/.test(model)) {
    const body = {
      model,
      input: [{ type: 'text', text: prompt }, ...imgs.map((i) => ({ type: 'image', mime_type: i.mime, data: i.b64 }))],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '16:9', image_size: '2K' },
    };
    const r = await http(`${base}/interactions`, { method: 'POST', headers, body, retries: 1, timeout: 180000 });
    if (r.ok) { const f = findImages(r.json); if (f.length) return f; errors.push('aucune image renvoyée'); }
    else if (r.status === 401 || r.status === 403 || r.status === 429) throw apiError(r, 'Gemini');
    else errors.push(apiError(r, 'Gemini').message);
  }
  // 2) generateContent (format classique)
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...imgs.map((i) => ({ inline_data: { mime_type: i.mime, data: i.b64 } }))] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  };
  for (const m of [...new Set([model, 'gemini-2.5-flash-image'])]) {
    const r = await http(`${base}/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers, body, retries: 1, timeout: 180000 });
    if (r.ok) {
      const f = findImages(r.json);
      if (f.length) return f;
      const why = r.json?.candidates?.[0]?.finishReason || r.json?.promptFeedback?.blockReason;
      errors.push(why ? `bloqué (${why})` : 'aucune image renvoyée');
    } else if (r.status === 401 || r.status === 403 || r.status === 429) throw apiError(r, 'Gemini');
    else errors.push(apiError(r, 'Gemini').message);
  }
  throw new Error(errors.join(' · ') || 'Gemini : échec');
}

async function openaiGenerate({ key, model, prompt, images, quality }) {
  const headers = { Authorization: 'Bearer ' + key };
  const tryModel = async (m) => {
    let res;
    if (images.length) {
      const form = new FormData();
      form.append('model', m);
      form.append('prompt', prompt);
      form.append('size', '1536x1024');
      form.append('quality', quality || 'high');
      images.slice(0, 16).forEach((u, i) => {
        const d = parseDataUrl(u);
        if (!d) return;
        const ext = d.mime.includes('jpeg') ? 'jpg' : d.mime.includes('webp') ? 'webp' : 'png';
        form.append('image[]', new Blob([Buffer.from(d.b64, 'base64')], { type: d.mime }), `ref${i}.${ext}`);
      });
      res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { ...headers, 'User-Agent': UA }, body: form, signal: AbortSignal.timeout(240000) });
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ model: m, prompt, size: '1536x1024', quality: quality || 'high' }), signal: AbortSignal.timeout(240000),
      });
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  };
  let r = await tryModel(model);
  if (!r.ok && /model/i.test(r.json?.error?.message || '') && model !== 'gpt-image-1') r = await tryModel('gpt-image-1');
  if (!r.ok) throw apiError(r, 'OpenAI');
  const f = findImages(r.json);
  if (!f.length) throw new Error('OpenAI : aucune image renvoyée');
  return f;
}

// ---------- Moteur gratuit : FLUX.2 klein (Black Forest Labs) sur Hugging Face ZeroGPU ----------
const HF_SPACES = [
  { id: 'black-forest-labs/FLUX.2-klein-4B', host: 'https://black-forest-labs-flux-2-klein-4b.hf.space' },
  { id: 'black-forest-labs/FLUX.2-klein-9B', host: 'https://black-forest-labs-flux-2-klein-9b.hf.space' },
];
const fnCache = {};

async function hfFnIndex(host) {
  if (fnCache[host] != null) return fnCache[host];
  const r = await http(host + '/config', { retries: 1, timeout: 20000 });
  if (!r.ok || !r.json?.dependencies) throw new Error('Serveur IA gratuit indisponible (' + r.status + ')');
  const i = r.json.dependencies.findIndex((d) => ['infer', 'generate'].includes(d.api_name));
  if (i < 0) throw new Error('Serveur IA gratuit : API introuvable');
  fnCache[host] = i;
  return i;
}

async function hfJwt(spaceId, token) {
  if (!token) return null;
  try {
    const r = await http(`https://huggingface.co/api/spaces/${spaceId}/jwt`, { headers: { Authorization: 'Bearer ' + token }, retries: 0 });
    return r.ok ? r.json?.token || null : null;
  } catch { return null; }
}

function friendlyHfError(msg) {
  const m = String(msg || '');
  if (/quota|exceeded/i.test(m)) {
    const wait = (m.match(/(\d+:\d+:\d+|\d+\s*(?:s|sec|min|h)\b)/i) || [])[0];
    return new Error(`Quota gratuit du jour atteint${wait ? ' (réessaie dans ' + wait + ')' : ''}. Ajoute un token Hugging Face gratuit dans « Moteur IA » pour en avoir plus.`);
  }
  return new Error('IA gratuite : ' + (m || 'erreur inconnue'));
}

async function hfGenerateOn(space, { token, prompt, images, width = 1024, height = 576, quality = 'fast' }) {
  const fn = await hfFnIndex(space.host);
  const jwt = await hfJwt(space.id, token);
  const auth = { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(jwt ? { 'x-zerogpu-token': jwt } : {}) };
  // 1) envoi des images de référence
  let gallery = [];
  if (images.length) {
    const form = new FormData();
    images.slice(0, 8).forEach((u, i) => {
      const d = parseDataUrl(u);
      if (d) form.append('files', new Blob([Buffer.from(d.b64, 'base64')], { type: d.mime }), `ref${i}.${d.mime.includes('png') ? 'png' : 'jpg'}`);
    });
    const up = await fetch(space.host + '/gradio_api/upload', { method: 'POST', headers: { 'User-Agent': UA, ...auth }, body: form, signal: AbortSignal.timeout(60000) });
    if (!up.ok) throw new Error('Envoi des images impossible (' + up.status + ')');
    const paths = await up.json();
    gallery = paths.map((p) => ({ image: { path: p, meta: { _type: 'gradio.FileData' } }, caption: null }));
  }
  // 2) file d'attente
  const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const join = await fetch(space.host + '/gradio_api/queue/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...auth },
    body: JSON.stringify({ data: [prompt, gallery, quality === 'hq' ? 'Base (50 steps)' : 'Distilled (4 steps)', 0, true, Math.min(1024, width), Math.min(1024, height), quality === 'hq' ? 50 : 4, quality === 'hq' ? 4 : 1, false], fn_index: fn, session_hash: session }),
    signal: AbortSignal.timeout(30000),
  });
  if (!join.ok) throw new Error('Serveur IA gratuit occupé (' + join.status + ')');
  // 3) lecture du flux de résultats
  const res = await fetch(space.host + '/gradio_api/queue/data?session_hash=' + session, { headers: { 'User-Agent': UA, Accept: 'text/event-stream', ...auth }, signal: AbortSignal.timeout(240000) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      let msg; try { msg = JSON.parse(line.slice(5)); } catch { continue; }
      if (msg.msg === 'process_completed') {
        try { reader.cancel(); } catch {}
        if (!msg.success) throw friendlyHfError(msg.output?.error || msg.title);
        const file = msg.output?.data?.[0];
        const url = file?.url || (file?.path ? space.host + '/gradio_api/file=' + file.path : null);
        if (!url) throw new Error('IA gratuite : aucune image renvoyée');
        const img = await fetch(url, { headers: { 'User-Agent': UA, ...auth }, signal: AbortSignal.timeout(60000) });
        const bytes = Buffer.from(await img.arrayBuffer());
        return [`data:${img.headers.get('content-type') || 'image/webp'};base64,${bytes.toString('base64')}`];
      }
    }
  }
  throw new Error('IA gratuite : connexion interrompue');
}

async function hfGenerate(opts) {
  let lastErr;
  for (const space of HF_SPACES) {
    try { return await hfGenerateOn(space, opts); }
    catch (e) { lastErr = e; if (/Quota gratuit/.test(e.message)) throw e; }
  }
  throw lastErr;
}

async function aiGenerate({ provider, keyEnc, model, prompt, images = [], quality, width, height }) {
  if (!provider || provider === 'free') return hfGenerate({ token: decrypt(keyEnc), prompt, images, width, height, quality });
  const key = decrypt(keyEnc);
  if (!key) throw new Error('Ajoute ta clé API IA dans le panneau « Moteur IA ».');
  if (provider === 'openai') return openaiGenerate({ key, model: model || 'gpt-image-2', prompt, images, quality });
  return geminiGenerate({ key, model: model || 'gemini-nano-banana-2.1', prompt, images });
}


async function whoAmI() {
  await loadRobloxCookie();
  if (!rbxCookie) return null;
  const r = await http('https://users.roblox.com/v1/users/authenticated', { retries: 1 });
  if (!r.ok || !r.json?.id) return null;
  let avatar = '';
  try {
    const t = await getJSON(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${r.json.id}&size=150x150&format=Png&isCircular=true`);
    avatar = t?.data?.[0]?.imageUrl || '';
  } catch {}
  return { id: r.json.id, name: r.json.name, displayName: r.json.displayName, avatar };
}

function normSale(tx, owner) {
  const d = tx.details || {};
  return {
    id: String(tx.idHash || tx.id || tx.purchaseToken || ''),
    t: Date.parse(tx.created) || Date.now(),
    net: Number(tx.currency?.amount) || 0,
    pending: !!tx.isPending,
    item: d.name || 'Article',
    type: d.type || '',
    itemId: d.id || null,
    uid: d.place?.universeId || null,
    place: d.place?.name || '',
    buyer: tx.agent?.name || '',
    owner,
  };
}

async function fetchSalesFor(owner, base, { knownIds = [], sinceMs = 0, maxPages = 40 }) {
  const known = new Set(knownIds);
  const out = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const url = `${base}?transactionType=Sale&limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
    const r = await http(url, { retries: 2 });
    if (r.status === 401) { const e = new Error('Connecte ton compte Roblox dans RoStats pour récupérer tes ventes.'); e.code = 'AUTH'; throw e; }
    if (r.status === 403) { const e = new Error('Ton compte n’a pas accès aux revenus de ce groupe.'); e.code = 'FORBIDDEN'; throw e; }
    if (!r.ok) throw new Error('Ventes Roblox : HTTP ' + r.status);
    const data = r.json?.data || [];
    let stop = false;
    for (const tx of data) {
      const s = normSale(tx, owner);
      if (known.has(s.id) || (sinceMs && s.t < sinceMs)) { stop = true; break; }
      out.push(s);
    }
    cursor = r.json?.nextPageCursor;
    if (stop || !cursor) break;
    await sleep(350);
  }
  return out;
}


function encrypt(text) { return text ? 'raw:' + btoa(unescape(encodeURIComponent(text))) : ''; }
function decrypt(blob) {
  if (!blob) return '';
  try { if (blob.startsWith('raw:')) return decodeURIComponent(escape(atob(blob.slice(4)))); } catch { return ''; }
  return '';
}

window.RoCore = {
  resolveGame, fetchGames, exploreSorts, searchGames, featuredGames, fetchServers, fetchGroups, importUserGames, importGroupGames,
  fetchRevenue, readEntry, utcDay, usdEur, aiGenerate, whoAmI, fetchSalesFor, loadRobloxCookie,
  encrypt, decrypt,
  getRbx: () => rbxCookie,
  resetSession() { rbxCookie = null; csrf = ''; },
};
})();
