// Reçoit les chiffres que la tâche programmée (Metricool) calcule chaque heure, sans passer par GitHub.
// Appel : GET /api/push-stats?k=<clé secrète>&v0=<vues YouTube>&v1=<vues TikTok @dwenyxrbx>&v2=<vues TikTok @dwenyxgames>
// Les vues ne peuvent jamais baisser (on garde toujours le plus grand chiffre).
import { createHash, timingSafeEqual } from "node:crypto";
import { send } from "./_lib.js";
import { hasRedis, redis } from "./_redis.js";

const KEY = process.env.STATS_PUSH_KEY || "";
const same = (a, b) => {
  const x = createHash("sha256").update(String(a)).digest(), y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  if (!KEY || !hasRedis) return send(res, 503, { error: "indisponible" });
  if (!same(req.query.k || "", KEY)) return send(res, 403, { error: "refusé" });
  const cmds = [];
  for (const i of [0, 1, 2]) {
    const v = Number(req.query["v" + i]);
    if (Number.isInteger(v) && v > 0 && v < 1e11) cmds.push(["EVAL", "local c=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0') if tonumber(ARGV[2])>c then redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]) end return redis.call('HGET',KEYS[1],ARGV[1])", "1", "stats:views", "v" + i, String(v)]);
  }
  if (!cmds.length) return send(res, 400, { error: "rien à enregistrer" });
  const out = await redis(...cmds, ["HGETALL", "stats:views"], ["DEL", "live:all:v2"]);
  return send(res, 200, { ok: true, saved: out[out.length - 2] });
}
