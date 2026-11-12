import { verifyGoogle, makeSession } from './_auth.js';

// Échange un jeton Google contre une session de 180 jours (reconnexion automatique).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const who = await verifyGoogle(req, false);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const token = makeSession(who);
  if (!token) return res.status(503).json({ error: 'no-secret' });
  return res.status(200).json({ token, name: who.name });
}
