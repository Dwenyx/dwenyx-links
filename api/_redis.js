// Accès à Upstash Redis via son API REST (aucune dépendance).
// Variables posées automatiquement par l'intégration Vercel ↔ Upstash.
// Le préfixe choisi dans Vercel peut varier (KV_, STORAGE_, UPSTASH_REDIS_…) : on cherche la bonne paire.
function findEnv(suffix) {
  const env = process.env;
  for (const k of ["KV_" + suffix, "UPSTASH_REDIS_" + suffix]) if (env[k]) return env[k];
  const key = Object.keys(env).find((k) => k.endsWith("_" + suffix) && !k.includes("READ_ONLY"));
  return key ? env[key] : "";
}
const URL_ = findEnv("REST_API_URL") || findEnv("REST_URL");
const TOKEN = findEnv("REST_API_TOKEN") || findEnv("REST_TOKEN");

export const hasRedis = Boolean(URL_ && TOKEN);

/* Exécute plusieurs commandes en un seul aller-retour */
export async function redis(...commands) {
  const r = await fetch(`${URL_.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

/* Anti-spam partagé entre tous les serveurs : au plus `max` actions par minute et par visiteur */
export async function overLimit(kind, who, max) {
  const key = `rl:${kind}:${who}:${Math.floor(Date.now() / 60000)}`;
  const [n] = await redis(["INCR", key], ["EXPIRE", key, "70"]);
  return Number(n) > max;
}

/* Reprise unique des anciens chiffres (stockage Blob) au premier passage sur Redis */
export async function migrateOnce() {
  const [done] = await redis(["GET", "migrated:v1"]);
  if (done) return;
  const [lock] = await redis(["SET", "migrating:v1", "1", "NX", "EX", "60"]);
  if (lock !== "OK") return;
  try {
    const { list } = await import("@vercel/blob");
    const { readCounter } = await import("./_lib.js");
    const members = [];
    let cursor;
    do {
      const page = await list({ prefix: "likes/", limit: 1000, cursor });
      for (const b of page.blobs) {
        const m = b.pathname.match(/^likes\/(.+)\.txt$/);
        if (m) members.push(m[1]);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const visits = (await readCounter("counters/visits.json")).count || 0;
    const cmds = [];
    if (members.length) cmds.push(["SADD", "likes:visitors", ...members]);
    cmds.push(["INCRBY", "visits", String(visits)]);
    cmds.push(["SET", "migrated:v1", new Date().toISOString()]);
    await redis(...cmds);
  } catch (err) {
    console.error("migration", err);
    await redis(["SET", "migrated:v1", "failed"]);
  }
}

/* Date du jour à Paris (AAAA-MM-JJ) pour ranger les stats par jour */
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
const KEEP = String(60 * 60 * 24 * 400); // les stats journalières sont gardées ~13 mois

/* Commandes pour ajouter +n à un champ d'une stat du jour */
export function dayIncr(hash, field, n = 1) {
  const key = `${hash}:${dayKey()}`;
  return [["HINCRBY", key, field, String(n)], ["EXPIRE", key, KEEP]];
}

export const SOURCES = ["tiktok", "youtube", "discord", "instagram", "snapchat", "twitter", "google", "roblox", "direct", "autre"];
export const LINKS = ["tiktok", "youtube", "tiktok2", "roblox", "email", "email-write", "share", "latest-video", "game-dynamite", "game-dodge", "flipzik"];
