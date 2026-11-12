// Paint Clash : appli installable + jeu hors ligne contre les bots
const V = 'pc-v36';
const CORE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.allSettled(CORE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.origin === location.origin && u.pathname.startsWith('/api/')) return;      // comptes, amis : toujours en ligne
  if (/supabase|googleapis\.com\/(?!css)|accounts\.google|gstatic\.com\/_\/|oauth2/.test(u.href) && !/fonts\./.test(u.host)) return;
  // page : réseau d'abord (toujours la dernière version), cache si hors ligne
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put('/', cp)); return res; })
      .catch(() => caches.match('/')));
    return;
  }
  // images, police, three.js : cache d'abord, mis à jour en arrière-plan
  if (u.origin === location.origin || /cdnjs|fonts\.(googleapis|gstatic)|jsdelivr/.test(u.host)) {
    e.respondWith(caches.open(V).then(async c => {
      const hit = await c.match(r);
      const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
