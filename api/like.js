// Compteur de likes du profil : 1 like maximum par visiteur.
// Chaque like est un fichier "likes/<empreinte>.txt" dans le Blob store "dwenyx-likes".
// L'empreinte est un hash de l'adresse IP du visiteur (avec un sel secret),
// donc pas de doublon possible même en vidant le navigateur ou en revenant plus tard,
// et aucune adresse IP n'est stockée en clair.
import { createHash } from "node:crypto";
import { put, head, list, BlobNotFoundError } from "@vercel/blob";

const SALT = process.env.LIKE_SALT || "";

function visitorKey(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  const ip = (fwd.split(",")[0] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "").trim();
  if (!ip) return null;
  return createHash("sha256").update(SALT + "|" + ip).digest("hex").slice(0, 40);
}

async function hasLiked(key) {
  if (!key) return false;
  try {
    await head(`likes/${key}.txt`);
    return true;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return false;
    throw err;
  }
}

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
  res.setHeader("Cache-Control", "no-store");
  try {
    const key = visitorKey(req);

    if (req.method === "GET") {
      const [count, liked] = await Promise.all([countLikes(), hasLiked(key)]);
      return res.status(200).json({ count, liked });
    }

    if (req.method === "POST") {
      if (!key) return res.status(400).json({ error: "Visiteur non identifié" });
      if (await hasLiked(key)) {
        return res.status(409).json({ count: await countLikes(), liked: true, already: true });
      }
      try {
        await put(`likes/${key}.txt`, "1", {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "text/plain",
        });
      } catch (err) {
        // Deux clics simultanés : le fichier existe déjà, le like est déjà compté
        if (await hasLiked(key)) {
          return res.status(409).json({ count: await countLikes(), liked: true, already: true });
        }
        throw err;
      }
      return res.status(200).json({ count: await countLikes(), liked: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Compteur indisponible" });
  }
}
