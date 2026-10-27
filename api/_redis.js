// Accès à Upstash Redis via son API REST (aucune dépendance).
// Variables posées automatiquement par l'intégration Vercel ↔ Upstash.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

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
