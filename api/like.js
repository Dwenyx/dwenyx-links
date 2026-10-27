// Compteur de likes du profil.
// Chaque like est un petit fichier dans le Blob store "dwenyx-likes" :
// pas d'écrasement possible entre deux likes simultanés, le total = nombre de fichiers.
import { put, list } from "@vercel/blob";

async function countLikes() {
  let count = 0;
  let cursor;
  do {
    const page = await list({ prefix: "likes/", limit: 1000, cursor });
    count += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return count;
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await put(`likes/${id}.txt`, "1", {
        access: "private",
        addRandomSuffix: false,
        contentType: "text/plain",
      });
      const count = await countLikes();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ count });
    }
    if (req.method === "GET") {
      const count = await countLikes();
      // Mis en cache 15 s par Vercel pour limiter les appels au stockage
      res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
      return res.status(200).json({ count });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Compteur indisponible" });
  }
}
