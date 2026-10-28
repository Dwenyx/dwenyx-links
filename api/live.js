// Stats lues en direct sur les profils publics :
// - TikTok (abonnés, likes totaux) : gardé 3 minutes
// - YouTube (abonnés, vues totales, likes = somme des likes de chaque vidéo) : gardé 30 minutes (plus lourd à calculer)
import { send } from "./_lib.js";
import { hasRedis, redis } from "./_redis.js";

const ACCOUNTS = ["dwenyxrbx", "dwenyxgames"];
const KEY = "live:all:v2";
const TTL = 180;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function profile(user) {
  const r = await fetch(`https://www.tiktok.com/@${user}?lang=fr`, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8", Accept: "text/html" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`TikTok ${user} ${r.status}`);
  const html = await r.text();
  let stats = null;
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      const u = j?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
      stats = u?.statsV2 || u?.stats || null;
    } catch {}
  }
  if (!stats) {
    // secours : on cherche directement les compteurs dans la page
    const n = (k) => { const x = html.match(new RegExp(`"${k}":"?(\\d+)`)); return x ? Number(x[1]) : null; };
    stats = { followerCount: n("followerCount"), heartCount: n("heartCount") ?? n("heart"), videoCount: n("videoCount") };
  }
  const followers = Number(stats.followerCount), likes = Number(stats.heartCount ?? stats.heart), videos = Number(stats.videoCount);
  if (!Number.isFinite(followers) || !Number.isFinite(likes) || followers <= 0) throw new Error(`TikTok ${user} : stats illisibles`);
  return { followers, likes, videos: Number.isFinite(videos) ? videos : null };
}

/* ---------- YouTube ---------- */
const YT_CHANNEL = "UCtcOZH2ImIsNCCnCWKdRNoQ"; // @Dwenyxrbx
const YT_KEY = "live:youtube:v1", YT_TTL = 1800;
const ytGet = (u) => fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" }, signal: AbortSignal.timeout(7000) })
  .then((r) => { if (!r.ok) throw new Error("YouTube " + r.status); return r.text(); });
const num = (t) => {
  if (!t) return null;
  const m = String(t).replace(/\u00a0/g, " ").match(/([\d.,\s]+)\s*([KM])?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/[\s,]/g, (c) => (c === "," && !m[2] ? "" : c === "," ? "." : "")));
  if (m[2]) n *= m[2].toUpperCase() === "M" ? 1e6 : 1e3;
  return Number.isFinite(n) ? Math.round(n) : null;
};
async function likesOf(id) {
  const h = await ytGet(`https://www.youtube.com/watch?v=${id}`);
  const m = h.match(/like this video along with ([\d,]+) other/);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}
async function youtube() {
  const about = await ytGet(`https://www.youtube.com/channel/${YT_CHANNEL}/about`);
  const views = num((about.match(/"viewCountText":"([^"]+)"/) || about.match(/([\d,]+) views/) || [])[1]);
  const subs = num((about.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/) || about.match(/([\d.,]+K?) subscribers/) || [])[1]);
  const pl = await ytGet(`https://www.youtube.com/playlist?list=UU${YT_CHANNEL.slice(2)}`);
  const ids = [...new Set([...pl.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, 60);
  let likes = 0, ok = 0;
  for (let i = 0; i < ids.length; i += 6) {
    const part = await Promise.allSettled(ids.slice(i, i + 6).map(likesOf));
    part.forEach((r) => { if (r.status === "fulfilled") { likes += r.value; ok++; } });
  }
  return { subs, views, likes: ok ? likes : null, videos: ids.length };
}
async function cachedYoutube() {
  if (hasRedis) {
    const [c] = await redis(["GET", YT_KEY]);
    if (c) return JSON.parse(c);
  }
  const y = await youtube();
  if (hasRedis && (y.subs || y.views || y.likes)) await redis(["SET", YT_KEY, JSON.stringify(y), "EX", String(YT_TTL)]);
  return y;
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Méthode non autorisée" }); }
  const fresh = "public, s-maxage=120, stale-while-revalidate=600";
  try {
    if (hasRedis) {
      const [cached] = await redis(["GET", KEY]);
      if (cached) return send(res, 200, JSON.parse(cached), fresh);
    }
    const out = { at: new Date().toISOString(), tiktok: {}, youtube: null };
    const [yt, ...results] = await Promise.allSettled([cachedYoutube(), ...ACCOUNTS.map(profile)]);
    results.forEach((r, i) => { if (r.status === "fulfilled") out.tiktok[ACCOUNTS[i]] = r.value; else console.error(r.reason?.message || r.reason); });
    if (yt.status === "fulfilled") out.youtube = yt.value; else console.error(yt.reason?.message || yt.reason);
    if (!Object.keys(out.tiktok).length && !out.youtube) return send(res, 200, { at: out.at, tiktok: {} }, "public, s-maxage=60");
    if (hasRedis) await redis(["SET", KEY, JSON.stringify(out), "EX", String(TTL)]);
    return send(res, 200, out, fresh);
  } catch (err) {
    console.error(err);
    return send(res, 200, { tiktok: {} }, "public, s-maxage=60");
  }
}
