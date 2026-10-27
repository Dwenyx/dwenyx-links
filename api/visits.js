// Visites : un compteur commun à tout le monde.
import { fromOwnSite, rateLimited, readCounter, bumpCounter, send } from "./_lib.js";

const COUNTER = "counters/visits.json";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { count } = await readCounter(COUNTER);
      return send(res, 200, { count: count ?? 0 }, "public, s-maxage=30, stale-while-revalidate=120");
    }
    if (req.method === "POST") {
      if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
      if (rateLimited(req, 4)) {
        // Rafale suspecte depuis la même adresse : on ne compte pas, on renvoie juste le total
        const { count } = await readCounter(COUNTER);
        return send(res, 200, { count: count ?? 0, counted: false });
      }
      return send(res, 200, { count: await bumpCounter(COUNTER), counted: true });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Compteur indisponible" });
  }
}
