// Outils partagés par les API du site (les fichiers commençant par "_" ne sont pas des routes).
import { createHash } from "node:crypto";
import { get, put, list, BlobPreconditionFailedError } from "@vercel/blob";

const SALT = process.env.LIKE_SALT || "";
/* Seules les adresses exactes de TON site sont acceptées (production + déploiement en cours) */
const SITE_HOSTS = [
  ...(process.env.SITE_HOSTS || "dwenyx.vercel.app").split(","),
  process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL,
].map((h) => String(h || "").trim().toLowerCase()).filter(Boolean);

/* Adresse IP du visiteur : on prend les en-têtes posés par Vercel lui-même, pas ceux que le navigateur pourrait inventer */
export function clientIp(req) {
  const h = req.headers;
  const ip = h["x-real-ip"] || String(h["x-vercel-forwarded-for"] || "").split(",")[0] || String(h["x-forwarded-for"] || "").split(",")[0];
  return String(ip || "").trim();
}

/* Empreinte anonyme du visiteur (aucune IP stockée en clair) */
export function visitorKey(req) {
  const ip = clientIp(req);
  if (!ip) return null;
  return createHash("sha256").update(SALT + "|" + ip).digest("hex").slice(0, 40);
}

/* Refuse les requêtes envoyées depuis un autre site (protection CSRF) */
export function fromOwnSite(req) {
  const site = String(req.headers["sec-fetch-site"] || "");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return SITE_HOSTS.includes(host.toLowerCase());
  } catch { return false; }
}

/* Anti-spam simple en mémoire : au plus N actions par IP et par minute (par instance du serveur) */
const hits = new Map();
export function rateLimited(req, max = 6, windowMs = 60_000) {
  const ip = clientIp(req) || "?";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

/* Compteur stocké dans un seul petit fichier, mis à jour avec écriture conditionnelle (pas d'écrasement) */
export async function readCounter(path) {
  const r = await get(path, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { count: null, etag: null };
  let count = 0;
  try { count = Number(JSON.parse(await new Response(r.stream).text()).count) || 0; } catch {}
  return { count, etag: r.blob?.etag ?? null };
}

export async function bumpCounter(path, initial = async () => 0) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let { count, etag } = await readCounter(path);
    if (count === null) count = await initial();
    const next = count + 1;
    try {
      await put(path, JSON.stringify({ count: next }), {
        access: "private", addRandomSuffix: false, contentType: "application/json",
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return next;
    } catch (err) {
      const conflict = err instanceof BlobPreconditionFailedError || /exist|precondition/i.test(String(err?.message));
      if (!conflict) throw err;
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 80));
    }
  }
  throw new Error("conflit");
}

/* Comptage des anciens fichiers de like : utilisé une seule fois pour initialiser le compteur */
export async function countFiles(prefix) {
  let n = 0, cursor;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    n += page.blobs.filter((b) => !b.pathname.endsWith("/")).length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return n;
}

export function send(res, status, body, cache = "no-store") {
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
