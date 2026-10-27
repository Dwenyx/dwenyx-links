// Compteur de visites commun à tout le monde : +1 à chaque ouverture de la page.
// Le total est un petit fichier JSON dans le Blob store "dwenyx-likes".
// Les écritures sont conditionnelles (ETag) : deux visites simultanées ne s'écrasent pas.
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";

const PATH = "counters/visits.json";

async function read() {
  const r = await get(PATH, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { count: 0, etag: null };
  const text = await new Response(r.stream).text();
  let count = 0;
  try { count = Number(JSON.parse(text).count) || 0; } catch {}
  return { count, etag: r.blob?.etag ?? r.etag ?? null };
}

async function increment() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { count, etag } = await read();
    const next = count + 1;
    try {
      await put(PATH, JSON.stringify({ count: next }), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return next;
    } catch (err) {
      // Quelqu'un a écrit entre-temps : on relit et on recommence
      const conflict = err instanceof BlobPreconditionFailedError || /exist|precondition/i.test(String(err?.message));
      if (!conflict) throw err;
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 80));
    }
  }
  throw new Error("Trop de visites simultanées, réessaie");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "POST") return res.status(200).json({ count: await increment() });
    if (req.method === "GET") return res.status(200).json({ count: (await read()).count });
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Compteur indisponible" });
  }
}
