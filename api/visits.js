// Visites : un compteur commun à tout le monde.
import { fromOwnSite, visitorKey, send } from "./_lib.js";
import { hasRedis, redis, overLimit } from "./_redis.js";

export default async function handler(req, res) {
  try {
    if (!hasRedis) return send(res, 503, { error: "Compteur indisponible" });
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
      const [count] = await redis(["INCR", "visits"]);
      return send(res, 200, { count: Number(count) || 0, counted: true });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Compteur indisponible" });
  }
}
