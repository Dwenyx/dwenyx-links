// Clics sur les liens de la page (pour le tableau de bord privé). Aucune donnée personnelle.
import { fromOwnSite, visitorKey, send } from "./_lib.js";
import { hasRedis, redis, overLimit, dayIncr, LINKS } from "./_redis.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Méthode non autorisée" }); }
    if (!hasRedis) return send(res, 204, {});
    if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    const id = b && LINKS.includes(b.id) ? b.id : null;
    if (!id) return send(res, 400, { error: "Lien inconnu" });
    if (await overLimit("track", visitorKey(req) || "?", 30)) return send(res, 200, { ok: true, counted: false });
    await redis(...dayIncr("clk", id));
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Indisponible" });
  }
}
