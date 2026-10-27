// Likes du profil : 1 like maximum par visiteur (empreinte anonyme de l'IP).
import { head, put, BlobNotFoundError } from "@vercel/blob";
import { visitorKey, fromOwnSite, rateLimited, readCounter, bumpCounter, countFiles, send } from "./_lib.js";

const COUNTER = "counters/likes.json";
const initial = () => countFiles("likes/");

async function hasLiked(key) {
  try { await head(`likes/${key}.txt`); return true; }
  catch (err) { if (err instanceof BlobNotFoundError) return false; throw err; }
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      let { count } = await readCounter(COUNTER);
      if (count === null) count = await initial();
      // Réponse identique pour tout le monde : mise en cache 30 s par Vercel pour économiser le stockage
      return send(res, 200, { count }, "public, s-maxage=30, stale-while-revalidate=120");
    }
    if (req.method === "POST") {
      if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
      if (rateLimited(req, 5)) return send(res, 429, { error: "Trop de tentatives, attends un peu" });
      const key = visitorKey(req);
      if (!key) return send(res, 400, { error: "Visiteur non identifié" });
      if (await hasLiked(key)) {
        const { count } = await readCounter(COUNTER);
        return send(res, 409, { count: count ?? undefined, liked: true, already: true });
      }
      try {
        await put(`likes/${key}.txt`, "1", { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "text/plain" });
      } catch (err) {
        if (await hasLiked(key)) return send(res, 409, { liked: true, already: true });
        throw err;
      }
      const count = await bumpCounter(COUNTER, async () => Math.max(0, (await initial()) - 1));
      return send(res, 200, { count, liked: true });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Compteur indisponible" });
  }
}
