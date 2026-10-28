// Tableau de bord privé : renvoie les stats du site uniquement avec le bon mot de passe.
import { createHash, timingSafeEqual } from "node:crypto";
import { clientIp, send } from "./_lib.js";
import { hasRedis, redis, overLimit, dayKey, SOURCES, LINKS } from "./_redis.js";

const PASSWORD = process.env.ADMIN_PASSWORD || "";
const h = (s) => createHash("sha256").update(String(s)).digest();

function authorized(req) {
  if (!PASSWORD) return false;
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return given.length > 0 && timingSafeEqual(h(given), h(PASSWORD));
}
const toObj = (arr) => {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]) || 0;
  return o;
};

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, { error: "Méthode non autorisée" }); }
    if (!hasRedis) return send(res, 503, { error: "Base de données non connectée" });
    // anti force brute : 8 essais par minute et par adresse
    if (await overLimit("admin", clientIp(req) || "?", 8)) return send(res, 429, { error: "Trop d'essais, attends une minute" });
    if (!authorized(req)) return send(res, 401, { error: "Mot de passe incorrect" });

    const nDays = Math.min(90, Math.max(7, Number(req.query?.days) || 30));
    const days = [];
    for (let i = nDays - 1; i >= 0; i--) days.push(dayKey(new Date(Date.now() - i * 86400000)));
    const cmds = [["GET", "visits"], ["SCARD", "likes:visitors"]];
    for (const d of days) cmds.push(["HGETALL", `d:${d}`], ["HGETALL", `src:${d}`], ["HGETALL", `clk:${d}`]);
    const out = await redis(...cmds);

    const series = [], sources = {}, clicks = {}, devices = { mobile: 0, pc: 0 };
    SOURCES.forEach((s) => (sources[s] = 0));
    LINKS.forEach((l) => (clicks[l] = 0));
    days.forEach((d, i) => {
      const day = toObj(out[2 + i * 3]), src = toObj(out[3 + i * 3]), clk = toObj(out[4 + i * 3]);
      series.push({ day: d, visits: day.visits || 0, likes: day.likes || 0, clicks: Object.values(clk).reduce((a, b) => a + b, 0) });
      devices.mobile += day.mobile || 0; devices.pc += day.pc || 0;
      for (const [k, v] of Object.entries(src)) sources[k] = (sources[k] || 0) + v;
      for (const [k, v] of Object.entries(clk)) clicks[k] = (clicks[k] || 0) + v;
    });
    return send(res, 200, {
      totals: { visits: Number(out[0]) || 0, likes: Number(out[1]) || 0 },
      days: nDays, series, sources, devices, clicks, generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Stats indisponibles" });
  }
}
