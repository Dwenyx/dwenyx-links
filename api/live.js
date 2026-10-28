// Stats TikTok EXACTES lues en direct sur les profils publics (abonnés, likes totaux, nombre de vidéos).
// Résultat gardé 3 minutes (Redis + cache Vercel) pour ne pas interroger TikTok à chaque visite.
import { send } from "./_lib.js";
import { hasRedis, redis } from "./_redis.js";

const ACCOUNTS = ["dwenyxrbx", "dwenyxgames"];
const KEY = "live:tiktok:v1";
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

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Méthode non autorisée" }); }
  const fresh = "public, s-maxage=120, stale-while-revalidate=600";
  try {
    if (hasRedis) {
      const [cached] = await redis(["GET", KEY]);
      if (cached) return send(res, 200, JSON.parse(cached), fresh);
    }
    const out = { at: new Date().toISOString(), tiktok: {} };
    const results = await Promise.allSettled(ACCOUNTS.map(profile));
    results.forEach((r, i) => { if (r.status === "fulfilled") out.tiktok[ACCOUNTS[i]] = r.value; else console.error(r.reason?.message || r.reason); });
    if (!Object.keys(out.tiktok).length) return send(res, 200, { at: out.at, tiktok: {} }, "public, s-maxage=60");
    if (hasRedis) await redis(["SET", KEY, JSON.stringify(out), "EX", String(TTL)]);
    return send(res, 200, out, fresh);
  } catch (err) {
    console.error(err);
    return send(res, 200, { tiktok: {} }, "public, s-maxage=60");
  }
}
