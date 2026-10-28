// Dernière vidéo de la chaîne YouTube, lue depuis le flux public de YouTube (mise en cache 30 min).
import { send } from "./_lib.js";

const CHANNEL_ID = "UCtcOZH2ImIsNCCnCWKdRNoQ"; // @Dwenyxrbx

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export default async function handler(req, res) {
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, { headers: { "User-Agent": "dwenyx-links" } });
    if (!r.ok) throw new Error("YouTube " + r.status);
    const xml = await r.text();
    const entry = (xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1];
    if (!entry) return send(res, 200, { video: null }, "public, s-maxage=1800, stale-while-revalidate=3600");
    const pick = (re) => ((entry.match(re) || [])[1] || "").trim();
    const id = pick(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/);
    const title = decode(pick(/<title>([\s\S]*?)<\/title>/)).slice(0, 140);
    const published = pick(/<published>([^<]+)<\/published>/);
    const link = pick(/<link rel="alternate" href="([^"]+)"/);
    if (!id) return send(res, 200, { video: null }, "public, s-maxage=1800");
    const isShort = /\/shorts\//.test(link);
    return send(res, 200, {
      video: {
        id, title, published, isShort,
        url: isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      },
    }, "public, s-maxage=1800, stale-while-revalidate=3600");
  } catch (err) {
    console.error(err);
    return send(res, 200, { video: null }, "public, s-maxage=300");
  }
}
