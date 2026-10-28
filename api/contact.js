// Formulaire de contact : le message est enregistré (visible dans /admin)
// et envoyé par e-mail à Dwenyx si une clé Resend est configurée.
import { fromOwnSite, visitorKey, send } from "./_lib.js";
import { hasRedis, redis, overLimit, dayKey } from "./_redis.js";

const TO = process.env.CONTACT_TO || "contactdwenyx@gmail.com";
const RESEND = process.env.RESEND_API_KEY || "";
const FROM = process.env.CONTACT_FROM || "Dwenyx · Page <onboarding@resend.dev>";
const TYPES = { marque: "Partenariat de marque", createur: "Collab entre créateurs", jeu: "Jeu Roblox", autre: "Autre" };

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
const isEmail = (s) => /^[^\s@<>()"',;:]{1,64}@[^\s@<>()"',;:]{1,190}\.[a-z]{2,24}$/i.test(s);

async function sendMail(m) {
  if (!RESEND) return false;
  const text = `Nouveau message depuis dwenyx.vercel.app\n\nDe : ${m.name}\nE-mail : ${m.email}\nSujet : ${TYPES[m.type]}\n\n${m.message}\n\n— Réponds directement à cet e-mail pour lui écrire.`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [TO], reply_to: m.email, subject: `💜 ${TYPES[m.type]} — ${m.name}`, text }),
  });
  if (!r.ok) console.error("Resend", r.status, await r.text().catch(() => ""));
  return r.ok;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Méthode non autorisée" }); }
    if (!fromOwnSite(req)) return send(res, 403, { error: "Requête refusée" });
    if (!hasRedis) return send(res, 503, { error: "Messagerie indisponible pour le moment" });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    b = b || {};
    // Piège à robots : ce champ est invisible pour les humains
    if (clean(b.website, 200)) return send(res, 200, { ok: true });
    const m = {
      name: clean(b.name, 60), email: clean(b.email, 254).toLowerCase(),
      type: TYPES[b.type] ? b.type : "autre", message: clean(b.message, 2000),
    };
    if (m.name.length < 2) return send(res, 400, { error: "Indique ton nom ou pseudo" });
    if (!isEmail(m.email)) return send(res, 400, { error: "Adresse e-mail invalide" });
    if (m.message.length < 10) return send(res, 400, { error: "Ton message est trop court" });

    const who = visitorKey(req) || "?";
    if (await overLimit("msg", who, 2)) return send(res, 429, { error: "Attends une minute avant de renvoyer un message" });
    const dayK = `msgday:${who}:${dayKey()}`;
    const [n] = await redis(["INCR", dayK], ["EXPIRE", dayK, "90000"]);
    if (Number(n) > 6) return send(res, 429, { error: "Tu as déjà envoyé plusieurs messages aujourd'hui" });

    const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...m, mailed: false };
    entry.mailed = await sendMail(entry).catch(() => false);
    await redis(["LPUSH", "msgs", JSON.stringify(entry)], ["LTRIM", "msgs", "0", "499"], ["INCR", "msgs:unread"]);
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Envoi impossible, réessaie plus tard" });
  }
}
