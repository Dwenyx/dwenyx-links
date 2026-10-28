// Outils partagés par les API du site (les fichiers commençant par "_" ne sont pas des routes).
import { createHash } from "node:crypto";

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

export function send(res, status, body, cache = "no-store") {
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
