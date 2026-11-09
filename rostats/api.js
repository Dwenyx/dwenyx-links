// RoStats Android — même API window.rostats que la version PC (preload Electron)
(function () {
  const C = window.RoCore;
  const N = window.RoNative;
  const FS = window.mobileFS;
  const call = window.mobileNative.call;

  const wrap = (fn) => async (...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: String(err?.message || err), code: err?.code }; }
  };

  const readJSON = (name, fallback) => { try { const t = FS.read('store/' + name + '.json'); return t == null ? fallback : JSON.parse(t); } catch { return fallback; } };
  const writeJSON = (name, data) => FS.write('store/' + name + '.json', JSON.stringify(data));

  const parseDataUrl = (u) => { const m = /^data:([^;]+);base64,(.*)$/s.exec(u || ''); return m ? { mime: m[1], b64: m[2] } : null; };

  function saveThumb({ dataUrl, meta, baseUrl, id }) {
    id = id && /^\w+$/.test(id) ? id : Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (baseUrl) FS.write('thumbnails/' + id + '_base.txt', baseUrl);
    else if (!FS.read('thumbnails/' + id + '_base.txt') && dataUrl) FS.write('thumbnails/' + id + '_src.txt', dataUrl);
    let old = {};
    try { old = JSON.parse(FS.read('thumbnails/' + id + '.json') || '{}'); } catch {}
    FS.write('thumbnails/' + id + '.json', JSON.stringify({ ...old, ...(meta || {}), id, at: old.at || Date.now() }));
    return id;
  }

  function listThumbs() {
    return FS.list('thumbnails').filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(FS.read('thumbnails/' + f)); } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.at - a.at).slice(0, 24)
      .map((m) => {
        const base = FS.read('thumbnails/' + m.id + '_base.txt');
        if (base) return { ...m, base };
        const src = FS.read('thumbnails/' + m.id + '_src.txt');
        return src ? { ...m, src } : null;
      }).filter(Boolean);
  }

  async function login() {
    await call('login');
    C.resetSession();
    return C.whoAmI().catch(() => null);
  }

  async function sales({ groupIds = [], userId, knownIds = [], sinceMs = 0, deepOwners = [] }) {
    await C.loadRobloxCookie();
    if (!C.getRbx()) { const e = new Error('Connecte ton compte Roblox dans RoStats pour récupérer tes ventes.'); e.code = 'AUTH'; throw e; }
    const results = [];
    const errors = [];
    const owners = [...new Set(groupIds.map(Number).filter(Boolean))].map((g) => ['group:' + g, `https://economy.roblox.com/v2/groups/${g}/transactions`]);
    if (userId) owners.push(['user:' + userId, `https://economy.roblox.com/v2/users/${userId}/transactions`]);
    for (const [owner, base] of owners) {
      const deep = deepOwners.includes(owner);
      try { results.push(...(await C.fetchSalesFor(owner, base, deep ? { knownIds: [], sinceMs: 0, maxPages: 2000 } : { knownIds, sinceMs }))); }
      catch (e) { errors.push({ owner, error: e.message, code: e.code }); }
    }
    return { sales: results, errors };
  }

  window.rostats = {
    resolve: wrap(C.resolveGame),
    games: wrap(C.fetchGames),
    servers: wrap(C.fetchServers),
    sorts: wrap(C.exploreSorts),
    search: wrap(C.searchGames),
    featured: wrap(C.featuredGames),
    groups: wrap(C.fetchGroups),
    me: wrap(C.whoAmI),
    login: wrap(login),
    logout: wrap(async () => { N.clearCookies(); C.resetSession(); return true; }),
    sales: wrap(sales),
    importUser: wrap(C.importUserGames),
    importGroup: wrap(C.importGroupGames),
    revenue: wrap(C.fetchRevenue),
    testKey: wrap(async ({ universeId, keyEnc, store }) => {
      const v = await C.readEntry(universeId, C.decrypt(keyEnc), store || 'RoStats_v1', 'day_' + C.utcDay(0));
      return { found: !!v };
    }),
    encrypt: wrap((t) => C.encrypt(t)),
    get: wrap((name, fallback) => readJSON(name, fallback)),
    set: wrap((name, data) => writeJSON(name, data)),
    notify: wrap(({ title, body }) => { N.notify(String(title || ''), String(body || '')); return true; }),
    openExternal: wrap((url) => { if (/^https:\/\//.test(url)) N.openUrl(url); return true; }),
    exportCsv: wrap(async ({ filename, csv }) => {
      const r = await call('saveText', csv, filename, 'text/csv');
      if (r.error) throw new Error(r.error);
      return r.path;
    }),
    info: wrap(() => ({ version: N.version() + ' (' + (N.platform ? N.platform() : 'Android') + ')', dataDir: '' })),
    openData: wrap(() => true),
    copyTracker: wrap(() => { N.copyText(N.readAsset('www/RoStatsTracker.lua')); return true; }),
    quit: wrap(() => { N.quit(); return true; }),
    usdEur: wrap(C.usdEur),
    aiGenerate: wrap(C.aiGenerate),
    aiSave: wrap(saveThumb),
    aiList: wrap(listThumbs),
    aiDelete: wrap((id) => {
      if (!/^\w+$/.test(String(id))) return false;
      for (const ext of ['.json', '_base.txt', '_src.txt']) FS.remove('thumbnails/' + id + ext);
      return true;
    }),
    aiExport: wrap(async ({ dataUrl, filename }) => {
      const d = parseDataUrl(dataUrl);
      if (!d) throw new Error('Image invalide');
      const r = await call('saveImage', d.b64, filename || 'miniature.png');
      if (r.error) throw new Error(r.error);
      return r.path;
    }),
    aiOpenFolder: wrap(() => true),
  };

  // Bouton retour Android : ferme d'abord les fenêtres ouvertes
  window.__onBack = () => {
    const viewer = document.querySelector('.viewer');
    if (viewer) { viewer.remove(); return 'handled'; }
    const modal = document.getElementById('modal');
    if (modal && !modal.hidden) { document.getElementById('modalClose').click(); return 'handled'; }
    const home = document.querySelector('.nav-item[data-view="overview"]');
    if (home && !home.classList.contains('active')) { home.click(); return 'handled'; }
    return 'no';
  };
})();
