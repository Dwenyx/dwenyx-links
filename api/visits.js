// Visites : un compteur commun à tout le monde + stats journalières (source, appareil) pour le tableau de bord.
import { fromOwnSite, rateLimited, readCounter, bumpCounter, visitorKey, send } from "./_lib.js";
import { hasRedis, redis, overLimit, migrateOnce, dayIncr, SOURCES } from "./_redis.js";

const COUNTER = "counters/visits.json";

function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  try {
    if (hasRedis) {
      await migrateOnce();
      if (req.method === "GET") {
        const [count] = await redis(["GET", "visits"]);
        return send(res, 200, { count: Number(count) || 0 }, "public, s-maxage=15, stale-while-revalidate=60");
      }
      if (req.method === "POST") {
        if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
        const who = visitorKey(req) || "?";
        if (await overLimit("visit", who, 4)) {
          const [count] = await redis(["GET", "visits"]);
          return send(res, 200, { count: Number(count) || 0, counted: false });
        }
        const b = body(req);
        const src = SOURCES.includes(b.src) ? b.src : "autre";
        const dev = b.dev === "mobile" ? "mobile" : "pc";
        const out = await redis(
          ["INCR", "visits"],
          ...dayIncr("d", "visits"),
          ...dayIncr("d", dev),
          ...dayIncr("src", src),
        );
        return send(res, 200, { count: Number(out[0]) || 0, counted: true });
      }
    } else {
      if (req.method === "GET") {
        const { count } = await readCounter(COUNTER);
        return send(res, 200, { count: count ?? 0 }, "public, s-maxage=30, stale-while-revalidate=120");
      }
      if (req.method === "POST") {
        if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
        if (rateLimited(req, 4)) {
          const { count } = await readCounter(COUNTER);
          return send(res, 200, { count: count ?? 0, counted: false });
        }
        return send(res, 200, { count: await bumpCounter(COUNTER), counted: true });
      }
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Compteur indisponible" });
  }
}
