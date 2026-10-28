// Gabarit de l'e-mail reçu par Dwenyx quand quelqu'un remplit le formulaire.
// Tableaux + styles en ligne : c'est ce que Gmail, Outlook et Apple Mail affichent correctement.

const SITE = "https://dwenyx.vercel.app";
const LOGO = SITE + "/mail/logo.png";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BADGE = {
  marque: { bg: "#efe6ff", fg: "#5b2ad1", icon: "🤝" },
  createur: { bg: "#ffe6f2", fg: "#b0246b", icon: "🎬" },
  autre: { bg: "#eef0f4", fg: "#3d4250", icon: "💬" },
};

export function buildMail(m, typeLabel) {
  const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(m.at || Date.now()));
  const b = BADGE[m.type] || BADGE.autre;
  const initial = esc((m.name.trim()[0] || "?").toUpperCase());
  const replySubject = encodeURIComponent(`Re: ${typeLabel} — Dwenyx`);
  const reply = `mailto:${encodeURIComponent(m.email)}?subject=${replySubject}`;
  const body = esc(m.message).replace(/\r?\n/g, "<br>");
  const preview = esc(m.message.replace(/\s+/g, " ").slice(0, 110));
  const words = m.message.trim().split(/\s+/).length;

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Nouveau message</title></head>
<body style="margin:0;padding:0;background:#f3f0fa;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(m.name)} : ${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0fa;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    <!-- En-tête -->
    <tr><td style="background:#2a1365;background-image:linear-gradient(135deg,#3b1690 0%,#5b2ad1 55%,#9b5cff 100%);border-radius:18px 18px 0 0;padding:24px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="52" valign="middle"><img src="${LOGO}" width="48" height="48" alt="D" style="display:block;border:0;border-radius:12px;"></td>
        <td valign="middle" style="padding-left:14px;">
          <div style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:.5px;">Dwenyx · Page</div>
          <div style="font-size:13px;color:#d8c6ff;margin-top:2px;">Nouveau message depuis ton site</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Carte -->
    <tr><td style="background:#ffffff;padding:28px;border-left:1px solid #e6e0f5;border-right:1px solid #e6e0f5;">

      <!-- Expéditeur -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6fd;border:1px solid #ece6fa;border-radius:14px;">
        <tr><td style="padding:16px 18px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="44" valign="middle"><div style="width:44px;height:44px;line-height:44px;border-radius:50%;background:#9b5cff;color:#ffffff;font-size:19px;font-weight:800;text-align:center;">${initial}</div></td>
            <td valign="middle" style="padding-left:12px;">
              <div style="font-size:16px;font-weight:700;color:#1b1530;">${esc(m.name)}</div>
              <a href="mailto:${esc(m.email)}" style="font-size:14px;color:#5b2ad1;text-decoration:none;">${esc(m.email)}</a>
            </td>
          </tr></table>
        </td></tr>
      </table>

      <!-- Détails -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
        <tr>
          <td style="font-size:12px;color:#8a83a0;text-transform:uppercase;letter-spacing:.8px;padding-bottom:6px;">Sujet</td>
          <td align="right" style="font-size:12px;color:#8a83a0;text-transform:uppercase;letter-spacing:.8px;padding-bottom:6px;">Reçu le</td>
        </tr>
        <tr>
          <td style="padding-right:10px;"><span style="display:inline-block;white-space:nowrap;background:${b.bg};color:${b.fg};font-size:13px;font-weight:700;padding:5px 10px;border-radius:8px;">${esc(typeLabel)}</span></td>
          <td align="right" style="font-size:13px;color:#3d3658;">${esc(when)}</td>
        </tr>
      </table>

      <!-- Message -->
      <div style="font-size:12px;color:#8a83a0;text-transform:uppercase;letter-spacing:.8px;margin:22px 0 8px;">Message · ${words} mot${words > 1 ? "s" : ""}</div>
      <div style="border-left:4px solid #9b5cff;background:#fbfaff;border-radius:0 12px 12px 0;padding:16px 18px;font-size:15px;line-height:1.6;color:#1b1530;word-break:break-word;">${body}</div>

      <!-- Bouton -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
        <td style="border-radius:12px;background:#9b5cff;box-shadow:0 4px 0 #5b2ad1;">
          <a href="${reply}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">Répondre à ${esc(m.name)} →</a>
        </td>
      </tr></table>
      <div style="font-size:13px;color:#8a83a0;margin-top:12px;">Tu peux aussi cliquer sur « Répondre » dans ta messagerie : la réponse part directement à ${esc(m.email)}.</div>
    </td></tr>

    <!-- Pied -->
    <tr><td style="background:#ffffff;border:1px solid #e6e0f5;border-top:1px solid #f0ecf8;border-radius:0 0 18px 18px;padding:16px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:12px;color:#a49dba;">Envoyé via le formulaire de <a href="${SITE}" style="color:#5b2ad1;text-decoration:none;font-weight:700;">dwenyx.vercel.app</a></td>
        <td align="right" style="font-size:12px;color:#a49dba;">💜 Dwenyx</td>
      </tr></table>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  const text = `Nouveau message — Dwenyx · Page

De : ${m.name} <${m.email}>
Sujet : ${typeLabel}
Reçu le : ${when}

${m.message}

—
Réponds directement à cet e-mail pour écrire à ${m.name}.
Envoyé via ${SITE}`;

  return { html, text };
}
