// Likes du profil : 1 like maximum par visiteur (empreinte anonyme de l'IP).
// L'ensemble Redis "likes:visitors" garantit l'unicité de façon atomique.
import { visitorKey, fromOwnSite, send } from "./_lib.js";
import { hasRedis, redis, overLimit } from "./_redis.js";

export default async function handler(req, res) {
  try {
    if (!hasRedis) return send(res, 503, { error: "Compteur indisponible" });
    if (req.method === "GET") {
      const [count] = await redis(["SCARD", "likes:visitors"]);
      return send(res, 200, { count: Number(count) || 0 }, "public, s-maxage=15, stale-while-revalidate=60");
    }
    if (req.method === "POST") {
      if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
      const key = visitorKey(req);
      if (!key) return send(res, 400, { error: "Visiteur non identifié" });
      if (await overLimit("like", key, 5)) return send(res, 429, { error: "Trop de tentatives, attends un peu" });
      const [added, count] = await redis(["SADD", "likes:visitors", key], ["SCARD", "likes:visitors"]);
      if (Number(added) === 0) return send(res, 409, { count: Number(count) || 0, liked: true, already: true });
      return send(res, 200, { count: Number(count) || 0, liked: true });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Compteur indisponible" });
  }
}
