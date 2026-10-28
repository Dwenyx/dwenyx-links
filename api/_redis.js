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

/* Date du jour à Paris (AAAA-MM-JJ) pour ranger les stats par jour */
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
