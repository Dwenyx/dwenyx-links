// RoStats Web (iPhone / navigateur) — remplace le pont natif Android.
// Réseau : passe par le relais /api/rbx du site (Roblox bloque les appels directs depuis un navigateur).
(function () {
  const PFX = 'rostats:';
  const ls = {
    get: (k) => { try { return localStorage.getItem(PFX + k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(PFX + k, v); } catch { /* stockage plein */ } },
    del: (k) => { try { localStorage.removeItem(PFX + k); } catch {} },
    keys: () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) out.push(k.slice(PFX.length)); } } catch {} return out; },
  };
  const done = (id, payload) => setTimeout(() => window.__rn && window.__rn(id, payload), 0);
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
  const b64ToBytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  window.RoNative = {
    request(id, json) {
      fetch('/api/rbx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
        .then((r) => r.json())
        .then((res) => done(id, res))
        .catch((e) => done(id, { error: 'Connexion impossible : ' + (e.message || e) }));
    },
    getCookie: () => '',
    clearCookies: () => {},
    login(id) {
      alert('La connexion au compte Roblox n’est pas disponible sur iPhone. Les joueurs, visites et notes fonctionnent sans connexion.');
      done(id, {});
    },
    readFile: (name) => ls.get('fs:' + name),
    writeFile: (name, data) => ls.set('fs:' + name, String(data)),
    deleteFile: (name) => ls.del('fs:' + name),
    listFiles: (dir) => JSON.stringify(ls.keys().filter((k) => k.startsWith('fs:' + dir + '/')).map((k) => k.slice(('fs:' + dir + '/').length)).filter((k) => !k.includes('/'))),
    readAsset(path) { try { const x = new XMLHttpRequest(); x.open('GET', String(path).replace(/^www\//, ''), false); x.send(); return x.status === 200 ? x.responseText : ''; } catch { return ''; } },
    saveImage(id, b64, name) { dl(new Blob([b64ToBytes(b64)], { type: 'image/png' }), name || 'miniature.png'); done(id, { path: 'Téléchargements' }); },
    saveText(id, text, name, mime) { dl(new Blob([text], { type: mime || 'text/plain' }), name || 'export.txt'); done(id, { path: 'Téléchargements' }); },
    openUrl: (url) => window.open(url, '_blank', 'noopener'),
    copyText: (t) => { try { navigator.clipboard.writeText(t); } catch {} },
    notify(title, body) { try { if (window.Notification && Notification.permission === 'granted') new Notification(title, { body, icon: 'logo.png' }); } catch {} },
    version: () => '1.12',
    quit: () => {},
  };

  // Pas de copier-coller, pas de menu « Enregistrer l'image », pas de zoom à deux doigts
  const editable = (el) => el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]');
  ['copy', 'cut', 'selectstart', 'dragstart'].forEach((ev) => document.addEventListener(ev, (e) => { if (!editable(e.target)) e.preventDefault(); }, true));
  document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); }, true);
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouch < 320 && !editable(e.target)) e.preventDefault(); lastTouch = now; }, { passive: false });
  document.documentElement.classList.add('web');
  // lancée depuis l'écran d'accueil (iPhone / Android) : mode appli, sans bouton Télécharger
  try { if (window.navigator.standalone || matchMedia('(display-mode: standalone)').matches) document.documentElement.classList.add('standalone'); } catch {}
})();
