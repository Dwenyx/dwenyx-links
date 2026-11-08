// RoStats — logique de l'interface
(() => {
  const api = window.rostats;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $('#main');

  const accentNow = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cff';
  const COLORS = { get blue() { return accentNow(); }, green: '#3dff7a', amber: '#ffc24a', get violet() { return accentNow(); }, red: '#ff4157' };
  const DAY = 86400000, HOUR = 3600000;

  // ---------- État ----------
  let config = { games: [], settings: {} };
  let history = {};          // { uid|'total': [{t,p,v,f}] }
  let records = {};          // { uid: { peak, at } }
  const live = {};           // infos jeu en direct
  let groups = {};           // infos groupes { id: { name, memberCount, icon } }
  let lastGroups = 0;
  let lastSalesGroups = null;
  let me = null;              // compte Roblox connecté
  const servers = {};        // stats serveurs
  const revenue = {};        // { uid: { days, error, at } }
  let view = 'overview';
  let lastRefresh = 0;
  let refreshing = false;
  let refreshError = null;
  let charts = [];
  let ranges = { game: '24h', overview: '24h' };
  let timer = null, revTimer = null, revWeekTimer = null, srvTimer = null, saveTimer = null;
  let saveCounter = 0;
  let pauseUntil = 0, rateHits = 0, lastVotes = 0;
  let fx = { rate: 0.86, live: false };

  const defaults = { interval: 1, notifySales: true, notifyRecord: true, trayOnClose: true, devex: 0.0038 };
  const S = () => ({ ...defaults, ...(config.settings || {}) });

  // ---------- Utilitaires ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const compact = (n) => (n == null ? '—' : Charts.compact(n));
  const robux = (n) => (n == null ? '—' : 'R$ ' + fmt(n));
  // Robux dépensés par les joueurs → Robux gagnés (70 %) → dollars DevEx → euros
  const earned = (gross) => Math.floor((gross || 0) * 0.7);
  const toEur = (gross) => earned(gross) * S().devex * fx.rate;
  const eur = (v, d = 2) => (v == null || isNaN(v) ? '—' : v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (n, d = 1) => (n == null || isNaN(n) ? '—' : fmt(n * 100, d) + ' %');
  const signed = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + fmt(n));
  const dur = (sec) => {
    if (!sec) return '—';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
    return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
  };
  const ago = (iso) => {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'à l’instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  const gameCfg = (uid) => config.games.find((g) => g.universeId === uid);

  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    if (err) window.Sound?.play('error');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 3200);
  }

  async function call(fn, ...args) {
    const r = await fn(...args);
    if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
    return r.data;
  }

  const saveConfig = () => api.set('config', config);
  const saveHistory = () => { api.set('history', history); api.set('records', records); };

  // ---------- Historique ----------
  function pushHistory(key, point) {
    const arr = (history[key] = history[key] || []);
    arr.push(point);
    // compactage : détail complet sur 1 h, 1 point / 15 s sur 24 h, puis 1 / 10 min, max 30 jours
    const now = Date.now();
    if (saveCounter % 60 === 0 || arr.length > 12000) {
      const out = [];
      let bucket = null;
      for (const p of arr) {
        const age = now - p.t;
        if (age > 30 * DAY) continue;
        if (age < HOUR) { out.push(p); bucket = null; continue; }
        const size = age < DAY ? 15000 : 10 * 60000;
        const b = size + ':' + Math.floor(p.t / size);
        // on garde le PIC de joueurs de la tranche (et les dernières visites / favoris)
        if (b === bucket) { const prev = out[out.length - 1]; out[out.length - 1] = { ...p, p: Math.max(prev.p ?? 0, p.p ?? 0) }; }
        else { out.push(p); bucket = b; }
      }
      history[key] = out;
    }
  }

  function seriesFor(key, field, rangeMs) {
    const arr = history[key] || [];
    const from = Date.now() - rangeMs;
    return arr.filter((p) => p.t >= from && p[field] != null).map((p) => ({ t: p.t, v: p[field] }));
  }

  // Points de la courbe enregistrés par Roblox (tracker), utilisés quand l'appli était fermée
  function cloudCcu(uid, rangeMs) {
    const r = revenue[uid];
    if (!r || !r.days) return [];
    const from = Date.now() - rangeMs;
    const pts = [];
    for (const d of r.days) {
      const base = Date.parse(d.day + 'T00:00:00Z');
      for (const [idx, n] of Object.entries(d.ccu || {})) {
        const t = base + Number(idx) * 300000 + 150000;
        if (t >= from && t <= Date.now()) pts.push({ t, v: Number(n) || 0 });
      }
    }
    return pts.sort((a, b) => a.t - b.t);
  }

  // Fusionne : historique local + points Roblox pendant les trous (appli fermée / PC éteint)
  function mergedPlayers(key, rangeMs, cloudPts) {
    const local = seriesFor(key, 'p', rangeMs);
    if (!cloudPts.length) return { pts: local, cloud: [] };
    const gap = 10 * 60000;
    const covered = (t) => {
      let lo = 0, hi = local.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (local[m].t < t) lo = m + 1; else hi = m - 1; }
      return (local[lo] && Math.abs(local[lo].t - t) < gap) || (local[lo - 1] && Math.abs(local[lo - 1].t - t) < gap);
    };
    const fill = cloudPts.filter((p) => !covered(p.t));
    return { pts: [...local, ...fill].sort((a, b) => a.t - b.t), cloud: fill };
  }

  function cloudTotal(rangeMs) {
    const map = new Map();
    for (const c of config.games) for (const p of cloudCcu(c.universeId, rangeMs)) map.set(p.t, (map.get(p.t) || 0) + p.v);
    return [...map.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
  }

  function deltaOver(key, field, ms) {
    const arr = history[key] || [];
    if (arr.length < 2) return null;
    const now = arr[arr.length - 1];
    const target = now.t - ms;
    let base = null;
    for (const p of arr) { if (p.t >= target - 5 * 60000) { base = p; break; } }
    if (!base || now.t - base.t < Math.min(ms * 0.25, 15 * 60000)) return null;
    return { delta: now[field] - base[field], spanMs: now.t - base.t };
  }

  function peakToday(key) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const pts = (history[key] || []).filter((p) => p.t >= start.getTime());
    return pts.length ? Math.max(...pts.map((p) => p.p)) : null;
  }

  function hourlyVisits(key) {
    const arr = history[key] || [];
    const now = Date.now();
    const hours = [];
    for (let i = 23; i >= 0; i--) {
      const end = Math.floor(now / HOUR) * HOUR - (i - 1) * HOUR;
      const start = end - HOUR;
      const inB = arr.filter((p) => p.t >= start && p.t < end);
      const before = arr.filter((p) => p.t < start);
      let v = null;
      if (inB.length) {
        const ref = before.length && start - before[before.length - 1].t < 20 * 60000 ? before[before.length - 1] : inB[0];
        v = Math.max(0, inB[inB.length - 1].v - ref.v);
      }
      hours.push({ start, v });
    }
    return hours;
  }

  // ---------- Lissage du nombre de joueurs ----------
  const rawPlayers = {};
  function stablePlayers(uid, value, t) {
    const win = Math.max(8000, S().interval * 3500);
    const buf = (rawPlayers[uid] = (rawPlayers[uid] || []).filter((x) => t - x.t < win));
    buf.push({ t, v: Number(value) || 0 });
    const vals = buf.map((x) => x.v).sort((a, b) => a - b);
    if (vals.length < 3) return live[uid]?.playing ?? vals[vals.length - 1];
    return vals[Math.floor(vals.length / 2)];
  }

  // ---------- Rafraîchissement ----------
  async function refresh() {
    if (refreshing || !config.games.length) { renderLive(); return; }
    if (Date.now() < pauseUntil) { renderLive(); return; }
    refreshing = true;
    try {
      const ids = config.games.map((g) => g.universeId);
      const needVotes = Date.now() - lastVotes > 30000;
      const needIcons = ids.some((id) => !live[id]?.icon || live[id]?.thumb == null);
      const data = await call(api.games, ids, { votes: needVotes, icons: needIcons });
      if (needVotes) lastVotes = Date.now();
      rateHits = Math.max(0, rateHits - 1);
      const t = Date.now();
      let total = 0, tv = 0, tf = 0;
      for (const uid of ids) {
        const g = data[uid];
        if (!g) continue;
        const prev = live[uid];
        if (g.restricted) { live[uid] = { ...prev, restricted: true }; continue; }
        const cfgG = gameCfg(uid);
        if (cfgG && cfgG.name !== g.name) { cfgG.name = g.name; saveConfig(); }
        // Roblox répond depuis plusieurs serveurs de cache qui ne sont pas toujours d'accord
        // (1, 0, 1, 0…) : on affiche la médiane des dernières lectures, et visites/favoris ne reculent jamais.
        g.playing = stablePlayers(uid, g.playing, t);
        if (prev) {
          if (prev.visits > g.visits && prev.visits - g.visits < 1000) g.visits = prev.visits;
          if (prev.favorites > g.favorites && prev.favorites - g.favorites < 50) g.favorites = prev.favorites;
        }
        live[uid] = { ...prev, ...g, up: g.up ?? prev?.up, down: g.down ?? prev?.down, icon: g.icon || prev?.icon, thumb: g.thumb || prev?.thumb || (g.icon ? '' : undefined) };
        total += g.playing; tv += g.visits; tf += g.favorites;
        pushHistory(uid, { t, p: g.playing, v: g.visits, f: g.favorites });
        // record de joueurs
        const rec = records[uid] || { peak: 0 };
        if (g.playing > rec.peak) {
          if (rec.peak >= 3) window.Sound?.play('record');
          if (rec.peak >= 3 && S().notifyRecord) api.notify({ title: `🏆 Nouveau record sur ${g.name}`, body: `${fmt(g.playing)} joueurs en même temps (avant : ${fmt(rec.peak)})` });
          records[uid] = { peak: g.playing, at: t };
        }
      }
      pushHistory('total', { t, p: total, v: tv, f: tf });
      saveCounter++;
      lastRefresh = t;
      refreshError = null;
    } catch (e) {
      if (e.code === 'RATE') {
        rateHits++;
        pauseUntil = Date.now() + Math.min(60000, 5000 * rateHits);
        refreshError = 'RATE';
      } else refreshError = e.message;
    } finally {
      refreshing = false;
    }
    renderSidebar();
    updateView();
    renderLive();
    refreshGroups();
  }

  let revBusy = false;
  async function refreshRevenue(onlyUid, todayOnly = false) {
    if (revBusy && todayOnly) return;
    revBusy = true;
    const list = config.games.filter((g) => g.keyEnc && (!onlyUid || g.universeId === onlyUid));
    for (const g of list) {
      try {
        const prev = revenue[g.universeId];
        const fast = todayOnly && prev && prev.days && !prev.error;
        let days = await call(api.revenue, { universeId: g.universeId, keyEnc: g.keyEnc, store: g.store || 'RoStats_v1', days: fast ? 1 : 7 });
        if (fast) {
          const old = prev.days.slice();
          if (old[old.length - 1].day === days[0].day) old[old.length - 1] = days[0];
          else { old.push(days[0]); old.shift(); }
          days = old;
        }
        const today = days[days.length - 1];
        if (!me && prev && prev.days && !prev.error && S().notifySales) {
          const pToday = prev.days[prev.days.length - 1];
          if (pToday.day === today.day && today.robux > pToday.robux) {
            const n = today.sales - pToday.sales;
            window.Sound?.play('coin');
            api.notify({ title: `💰 +${eur(toEur(today.robux - pToday.robux))} (${fmt(today.robux - pToday.robux)} R$)`, body: `${n > 1 ? n + ' ventes' : '1 vente'} sur ${live[g.universeId]?.name || 'ton jeu'} · ${eur(toEur(today.robux))} aujourd’hui` });
          }
        }
        revenue[g.universeId] = { days, at: Date.now() };
      } catch (e) {
        revenue[g.universeId] = { ...(revenue[g.universeId] || {}), error: e.message, code: e.code, at: Date.now() };
      }
    }
    revBusy = false;
    updateView();
  }

  const groupIdsOf = () => [...new Set(config.games.map((c) => live[c.universeId]).filter((g) => g && g.creatorType === 'Group' && g.creatorId).map((g) => g.creatorId))];

  async function refreshGroups(force = false) {
    const ids = groupIdsOf();
    const missing = ids.some((id) => !groups[id]);
    if (!ids.length || (!force && !missing && Date.now() - lastGroups < 60000)) return;
    lastGroups = Date.now();
    try {
      const data = await call(api.groups, ids);
      for (const [id, g] of Object.entries(data)) {
        groups[id] = { ...groups[id], ...g, icon: g.icon || groups[id]?.icon };
        pushHistory('grp:' + id, { t: Date.now(), m: g.memberCount });
      }
      renderSidebar();
      updateView();
      const key = groupIdsOf().sort().join(',');
      if (me && key !== lastSalesGroups) { lastSalesGroups = key; refreshSales(); }
    } catch {}
  }

  // Charge immédiatement des jeux qui viennent d'être ajoutés (sans attendre le prochain cycle)
  async function loadGames(ids) {
    const data = await call(api.games, ids, { votes: true, icons: true });
    const t = Date.now();
    for (const id of ids) {
      const g = data[id];
      if (!g) continue;
      if (g.restricted) { live[id] = { ...live[id], restricted: true }; continue; }
      live[id] = { ...live[id], ...g };
      pushHistory(id, { t, p: g.playing, v: g.visits, f: g.favorites });
      if (!records[id] || g.playing > records[id].peak) records[id] = { peak: g.playing, at: t };
    }
    await refreshGroups(true);
    renderSidebar();
    return data;
  }

  function groupBadge(g, small = false) {
    const gr = g && g.creatorType === 'Group' ? groups[g.creatorId] : null;
    if (!gr) return '';
    return `<span class="grp-badge ${small ? 'sm' : ''}">${gr.icon ? `<img src="${esc(gr.icon)}" alt="">` : ''}<b>${esc(gr.name)}</b><span>${fmt(gr.memberCount)} membres</span></span>`;
  }

  function renderAccount() {
    const el = $('#account');
    if (!el) return;
    el.innerHTML = me
      ? `<button class="acct" id="acctBtn" title="Compte Roblox connecté">${me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : ''}<span>${esc(me.displayName || me.name)}</span></button>`
      : `<button class="acct off" id="acctBtn">Se connecter à Roblox</button>`;
    $('#acctBtn').onclick = me ? () => go('settings') : doLogin;
  }

  async function doLogin() {
    const r = await call(api.login).catch(() => null);
    me = r;
    renderAccount();
    if (me) { toast('Connecté en tant que ' + me.name); lastVotes = 0; await refresh(); go(view); refreshSales(true); }
  }

  async function doLogout() {
    await call(api.logout).catch(() => {});
    me = null; sales = []; salesLoaded = false; api.set('sales', []); api.set('salesDeep', []); renderAccount(); toast('Déconnecté de Roblox'); go('settings');
  }

  async function refreshFx() {
    try { const r = await call(api.usdEur); fx = { rate: r.rate, live: true, date: r.date, source: r.source }; }
    catch { /* garde le dernier taux connu */ }
  }

  async function refreshServers(uid) {
    const g = live[uid];
    if (g && g.restricted && !g.placeId) { servers[uid] = { error: 'jeu masqué par Roblox' }; if (view === 'game:' + uid) updateView(); return; }
    if (!g || !g.placeId) return;
    try { servers[uid] = { ...(await call(api.servers, g.placeId)), at: Date.now() }; }
    catch (e) { servers[uid] = { error: e.message }; }
    if (view === 'game:' + uid) updateView();
  }

  function schedule() {
    clearInterval(timer); clearInterval(revTimer); clearInterval(revWeekTimer); clearInterval(saveTimer);
    timer = setInterval(refresh, S().interval * 1000);
    revTimer = setInterval(() => refreshRevenue(null, true), Math.max(5, S().interval) * 1000);
    revWeekTimer = setInterval(() => refreshRevenue(), 5 * 60000);
    saveTimer = setInterval(saveHistory, 30000);
    clearInterval(schedule._sales); schedule._sales = setInterval(() => refreshSales(), 30000);
  }
  setInterval(refreshFx, 3 * 3600000);

  function renderLive() {
    const el = $('#liveState'), txt = $('#liveText');
    if (!config.games.length) { el.className = 'live'; txt.textContent = 'Aucun jeu suivi'; return; }
    if (refreshError === 'RATE') { el.className = 'live err'; txt.textContent = `Roblox limite les requêtes · reprise dans ${Math.max(0, Math.ceil((pauseUntil - Date.now()) / 1000))} s`; return; }
    if (refreshError) { el.className = 'live err'; txt.textContent = 'Hors ligne · nouvelle tentative…'; return; }
    if (!lastRefresh) { el.className = 'live'; txt.textContent = 'Connexion…'; return; }
    const s = Math.round((Date.now() - lastRefresh) / 1000);
    el.className = 'live on';
    txt.textContent = s <= 1 ? `En direct · toutes les ${S().interval} s` : `En direct · actualisé il y a ${s} s`;
  }
  setInterval(renderLive, 500);

  // ---------- Barres latérales (icônes) ----------
  function renderSidebar() {
    const html = config.games.map((cfg) => {
      const g = live[cfg.universeId] || {};
      const active = view === 'game:' + cfg.universeId;
      const name = g.name || cfg.name || (g.restricted ? 'Jeu restreint' : 'Chargement…');
      return `<button class="game-item rg ${active ? 'active' : ''}" data-uid="${cfg.universeId}" title="${esc(name)}${g.playing != null ? ' · ' + fmt(g.playing) + ' en ligne' : ''}">
        ${g.icon ? `<img src="${esc(g.icon)}" alt="">` : `<div class="ph">${g.restricted && !g.name ? '⚠' : g.name ? esc([...g.name.replace(/[^\p{L}\p{N}]/gu, '')][0] || '?') : '<span class="spinner"></span>'}</div>`}
        <i class="st ${g.playing ? 'on' : ''}"></i>
      </button>`;
    }).join('');
    const menuBtn = `<button class="rail-menu" id="pickBtn" title="Choisir un jeu"><svg viewBox="0 0 24 24"><path d="M4 5h6v6H4zm10 0h6v6h-6zM4 13h6v6H4zm10 0h6v6h-6z"/></svg></button><div class="rail-sep"></div>`;
    const full = menuBtn + html;
    if ($('#gameList').dataset.k !== full) { $('#gameList').dataset.k = full; $('#gameList').innerHTML = full; }
    const gids = groupIdsOf().filter((id) => groups[id]);
    const gh = gids.map((id) => { const gr = groups[id]; return `<button class="grp-head rg ${view === 'group:' + id ? 'active' : ''}" data-gid="${id}" title="${esc(gr.name)} · ${fmt(gr.memberCount)} membres">${gr.icon ? `<img src="${esc(gr.icon)}" alt="">` : '<div class="ph"></div>'}</button>`; }).join('');
    const gl = $('#groupList');
    if (gl) { if (gl.innerHTML !== gh) gl.innerHTML = gh; gl.hidden = !gids.length; }
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view || (b.dataset.view === 'overview' && /^(game|group):/.test(view))));
  }
  $('#groupList')?.addEventListener('click', (e) => { const h = e.target.closest('.grp-head'); if (h) go('group:' + h.dataset.gid); });
  // Menu de sélection des jeux (bouton en haut de la colonne de droite)
  function openPicker() {
    const m = $('#pickMenu');
    const gs = sortedGames();
    const gids = groupIdsOf().filter((id) => groups[id]);
    m.innerHTML = `<div class="pm-head"><b>Mes jeux</b><span class="muted small">${gs.length}</span></div>
      <div class="pm-list">${gs.map(({ c, g }) => `<button class="pm-row ${view === 'game:' + c.universeId ? 'on' : ''}" data-uid="${c.universeId}">
        ${g.icon ? `<img src="${esc(g.icon)}" alt="">` : '<div class="ph"></div>'}<div class="gr-t"><b>${esc(g.name || c.name || '…')}</b><span><i class="dot ${g.playing ? 'on' : ''}"></i>${fmt(g.playing)} en ligne</span></div></button>`).join('')}</div>
      ${gids.length ? `<div class="pm-head"><b>Groupes</b></div><div class="pm-list">${gids.map((id) => { const gr = groups[id]; return `<button class="pm-row ${view === 'group:' + id ? 'on' : ''}" data-gid="${id}">${gr.icon ? `<img src="${esc(gr.icon)}" alt="" style="border-radius:50%">` : '<div class="ph"></div>'}<div class="gr-t"><b>${esc(gr.name)}</b><span>${fmt(gr.memberCount)} membres</span></div></button>`; }).join('')}</div>` : ''}
      <button class="btn primary pm-add" id="pmAdd">+ Ajouter un jeu</button>`;
    showBubble(m);
    $('#pmAdd').onclick = () => { closePicker(); openAddModal(); };
    m.onclick = (e) => {
      const r = e.target.closest('.pm-row'); if (!r) return;
      closePicker();
      go(r.dataset.uid ? 'game:' + r.dataset.uid : 'group:' + r.dataset.gid);
    };
  }
  function closePicker() { hideBubble($('#pickMenu')); }
  document.addEventListener('mousedown', (e) => { const m = $('#pickMenu'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('#pickBtn')) closePicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

  $('#gameList').addEventListener('click', (e) => {
    if (e.target.closest('#pickBtn')) { $('#pickMenu').hidden || $('#pickMenu').classList.contains('closing') ? openPicker() : closePicker(); return; }
    const b = e.target.closest('.game-item');
    if (b) go('game:' + b.dataset.uid);
    const h = e.target.closest('.grp-head');
    if (h) api.openExternal(`https://www.roblox.com/communities/${h.dataset.gid}`);
  });
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  // ---------- Menus en bulles ----------
  const ICO = {
    link: '<svg viewBox="0 0 24 24"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8.5 19a4.5 4.5 0 0 1-3.2-7.7l2.1-2.1 1.4 1.4-2.1 2.1a2.5 2.5 0 0 0 3.5 3.5l2.1-2.1 1.4 1.4-2.1 2.1A4.5 4.5 0 0 1 8.5 19zm7.5-4.2-1.4-1.4 2.1-2.1a2.5 2.5 0 0 0-3.5-3.5l-2.1 2.1-1.4-1.4 2.1-2.1a4.5 4.5 0 0 1 6.4 6.4z"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"/></svg>',
    group: '<svg viewBox="0 0 24 24"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.5 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 13c-3.3 0-7 1.6-7 4.5V20h14v-2.5C16 14.6 12.3 13 9 13zm7.5 0c-.6 0-1.2.1-1.8.2 1.4 1 2.3 2.4 2.3 4.3V20h5v-2.2c0-2.7-3-4.8-5.5-4.8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M11 3q1 7 8 8-7 1-8 8-1-7-8-8 7-1 8-8zm8-1q.5 2.5 3 3-2.5.5-3 3-.5-2.5-3-3 2.5-.5 3-3z"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 4 12l4.6-4.6L7.2 6 1.2 12l6 6zm6.8 0L20 12l-4.6-4.6L16.8 6l6 6-6 6z"/></svg>',
  };
  function showBubble(el) { el.hidden = false; el.classList.remove('closing'); window.Sound?.play('open'); }
  function hideBubble(el) {
    if (el.hidden || el.classList.contains('closing')) return;
    el.classList.add('closing');
    setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, 160);
  }
  function openPlus() {
    const m = $('#plusMenu');
    m.innerHTML = [['link', 'Ajouter un jeu', 'Lien ou ID du jeu', () => openAddModal('link')],
      ['user', 'Importer mes jeux', 'Tous les jeux de ton compte', () => openAddModal('user')],
      ['group', 'Importer un groupe', 'Tous les jeux d’un groupe', () => openAddModal('group')],
      ['spark', 'Miniature IA', 'Créer une miniature', () => go('thumbs')],
      ['code', 'Script Luau', 'Stats même PC éteint', () => copyTracker()]]
      .map(([ic, t, sub], i) => `<button class="bm-item" data-i="${i}" style="--d:${i * 30}ms">${ICO[ic]}<span><b>${t}</b><small>${sub}</small></span></button>`).join('');
    const acts = [() => openAddModal('link'), () => openAddModal('user'), () => openAddModal('group'), () => go('thumbs'), () => copyTracker()];
    m.onclick = (e) => { const b = e.target.closest('.bm-item'); if (!b) return; hideBubble(m); $('#plusBtn').classList.remove('on'); acts[b.dataset.i](); };
    showBubble(m);
    $('#plusBtn').classList.add('on');
  }
  $('#plusBtn').addEventListener('click', () => { const m = $('#plusMenu'); if (m.hidden) openPlus(); else { hideBubble(m); $('#plusBtn').classList.remove('on'); } });
  document.addEventListener('mousedown', (e) => { const m = $('#plusMenu'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('#plusBtn')) { hideBubble(m); $('#plusBtn').classList.remove('on'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideBubble($('#plusMenu')); $('#plusBtn').classList.remove('on'); } });

  // ---------- Navigation ----------
  function go(v) {
    view = v;
    charts.forEach((c) => c.destroy());
    charts = [];
    main.scrollTop = 0;
    main.onclick = null; main.onpaste = null;
    renderSidebar();
    clearInterval(srvTimer);
    clearInterval(heroTimer);
    if (v.startsWith('game:')) {
      const uid = Number(v.slice(5));
      mountGame(uid);
      refreshServers(uid);
      srvTimer = setInterval(() => refreshServers(uid), 120000);
      if (gameCfg(uid)?.keyEnc) refreshRevenue(uid);
    } else if (v.startsWith('group:')) mountGroup(Number(v.slice(6)));
    else if (v === 'settings') mountSettings();
    else if (v === 'thumbs') mountThumbs();
    else mountOverview();
  }

  // Optimisation : rien n'est redessiné quand la fenêtre est cachée ou réduite
  document.addEventListener('visibilitychange', () => { document.documentElement.classList.toggle('paused', document.hidden); if (!document.hidden) updateView(); });
  function updateView() {
    if (document.hidden) return;
    if (view === 'overview') updateOverview();
    else if (view.startsWith('game:')) updateGame(Number(view.slice(5)));
    else if (view.startsWith('group:')) updateGroup(Number(view.slice(6)));
  }

  const RANGE_MS = { '1h': HOUR, '24h': DAY, '7j': 7 * DAY, '30j': 30 * DAY };
  const segHTML = (cur, id) => `<div class="seg" id="${id}">${Object.keys(RANGE_MS).map((k) => `<button data-r="${k}" class="${k === cur ? 'on' : ''}">${k}</button>`).join('')}</div>`;

  // ---------- Vue d'ensemble ----------
  let heroTimer = null, heroIdx = 0;
  const greet = () => { const h = new Date().getHours(); return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour'; };
  const sortedGames = () => config.games.map((c) => ({ c, g: live[c.universeId] || {} })).sort((a, b) => (b.g.playing || 0) - (a.g.playing || 0) || (b.g.visits || 0) - (a.g.visits || 0));
  const todayOf = (uid) => (hasSales() ? salesDays(salesOf(uid), 1)[0].net : null);
  const allOf = (uid) => (hasSales() ? salesOf(uid).reduce((a, x) => a + x.net, 0) : null);
  const CHEV = '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function heroHTML(uid, onGamePage = false) {
    const g = live[uid] || {}, c = gameCfg(uid) || {};
    const rating = g.up + g.down ? g.up / (g.up + g.down) : null;
    const gr = g.creatorType === 'Group' ? groups[g.creatorId] : null;
    const desc = (g.description || '').replace(/\s+/g, ' ').trim();
    return `<div class="hero-card ${onGamePage ? 'tall' : ''}" data-uid="${uid}">
      ${g.thumb ? `<div class="hero-img" style="background-image:url('${esc(g.thumb)}')"></div>` : g.icon ? `<div class="hero-img icon" style="background-image:url('${esc(g.icon)}')"></div>` : ''}
      <div class="hero-in">
        <div class="hero-pills">
          <span class="hpill hot">${g.playing ? '🔥 En ligne' : '🎮 Ton jeu'}</span>
          ${gr ? `<span class="hpill round" title="${esc(gr.name)}">${gr.icon ? `<img src="${esc(gr.icon)}" alt="">` : ''}</span>` : ''}
        </div>
        <h2 class="hero-name">${esc(g.name || c.name || 'Chargement…')}</h2>
        ${onGamePage ? `<div class="hero-sub">par ${esc(g.creator || '…')} · mis à jour ${ago(g.updated)}</div>` : desc ? `<p class="hero-desc">${esc(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}</p>` : ''}
        <div class="hero-foot">
          <span class="wpill"><b>${fmt(g.playing)}</b> en ligne</span>
          ${rating != null ? `<span class="wpill">👍 ${pct(rating, 0)}</span>` : ''}
          ${onGamePage ? `<span style="flex:1"></span><button class="btn glass" id="gOpen">Roblox</button><button class="btn glass" id="gDash">Creator Hub</button><button class="btn glass" id="gMore" title="Plus">⋯</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  function mountOverview() {
    if (!config.games.length) {
      main.innerHTML = `<div class="empty-state">
        <h2>Bienvenue sur RoStats</h2>
        <p>Ajoute tes jeux Roblox pour suivre en direct les joueurs connectés, les visites, les favoris, les notes, les serveurs et tes revenus en Robux.</p>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" id="eAdd">Ajouter un jeu</button>
          <button class="btn" id="eImport">Importer tous mes jeux</button>
        </div></div>`;
      $('#eAdd').onclick = () => openAddModal('link');
      $('#eImport').onclick = () => openAddModal('user');
      return;
    }
    main.innerHTML = `
      <div class="greet">${greet()}, <b>${esc(me?.displayName || me?.name || 'toi')}</b></div>
      <div class="ov-top">
        <div class="hero-wrap"><div id="ovHero"></div><div class="hero-dots" id="ovDots"></div></div>
        <div class="glist" id="ovList"></div>
      </div>
      <div class="ov-bottom">
        <div><div class="sec-head"><h3>Joueurs en ligne</h3>${segHTML(ranges.overview, 'ovSeg')}</div><div class="card flat"><div class="chart" id="ovChart"></div></div></div>
        <div><div class="sec-head"><h3>Tes revenus</h3><span class="muted small" id="ovStatHint"></span></div><div class="stat-card" id="ovStat"></div></div>
      </div>`;
    $('#ovSeg').onclick = (e) => { const r = e.target.dataset.r; if (!r) return; ranges.overview = r; $$('#ovSeg button').forEach((b) => b.classList.toggle('on', b.dataset.r === r)); updateOverview(); };
    $('#ovHero').onclick = (e) => { const h = e.target.closest('.hero-card'); if (h) go('game:' + h.dataset.uid); };
    $('#ovDots').onclick = (e) => { const d = e.target.closest('[data-i]'); if (d) { heroIdx = Number(d.dataset.i); updateOverview(); } };
    $('#ovList').onclick = (e) => { const r = e.target.closest('.grow-row'); if (r) go('game:' + r.dataset.uid); };
    charts.push(Charts.line($('#ovChart'), { series: [] }));
    heroTimer = setInterval(() => { heroIdx++; updateOverview(); }, 7000);
    updateOverview();
  }

  function updateOverview() {
    if (!$('#ovHero')) return;
    const gs = sortedGames();
    heroIdx = gs.length ? heroIdx % gs.length : 0;
    const top = gs[heroIdx];
    if (top) {
      const h = heroHTML(top.c.universeId);
      const box = $('#ovHero');
      if (box.dataset.k !== h) { box.dataset.k = h; box.innerHTML = h; }
    }
    const dots = gs.length > 1 ? gs.map((_, i) => `<button data-i="${i}" class="${i === heroIdx ? 'on' : ''}" data-silent></button>`).join('') : '';
    if ($('#ovDots').innerHTML !== dots) $('#ovDots').innerHTML = dots;

    const list = gs.slice(0, 4).map(({ c, g }) => {
      const t = todayOf(c.universeId);
      return `<button class="grow-row" data-uid="${c.universeId}">
        ${g.icon ? `<img src="${esc(g.icon)}" alt="">` : '<div class="ph"></div>'}
        <div class="gr-t"><b>${esc(g.name || c.name || '…')}</b><span>${fmt(g.playing)} en ligne${t ? ` · <em>+${eur(eurNet(t))}</em>` : ''}</span></div>${CHEV}</button>`;
    }).join('') + (gs.length > 4 ? `<div class="muted small" style="padding:4px 8px">+ ${gs.length - 4} autres jeux dans la colonne de droite</div>` : '');
    if ($('#ovList').innerHTML !== list) $('#ovList').innerHTML = list;

    const ms = RANGE_MS[ranges.overview];
    const mo = mergedPlayers('total', ms, cloudTotal(ms));
    charts[0]?.update({ series: [{ name: 'joueurs', color: COLORS.blue, points: mo.pts }], tMin: Date.now() - ms, tMax: Date.now(), gapMs: Math.max(20 * 60000, S().interval * 4000) });

    // Carte revenus : cercle « total gagné » + détail par jeu
    let stat;
    if (hasSales()) {
      const all = sales.reduce((a, x) => a + x.net, 0);
      const today = salesDays(sales, 1)[0].net;
      const per = gs.map(({ c, g }) => ({ g, v: allOf(c.universeId) || 0 })).filter((x) => x.v > 0).slice(0, 3);
      stat = `<div class="blob"><i></i><i></i><i></i><div class="blob-in"><span>Total gagné</span><b>${eur(eurNet(all))}</b><small>${robux(all)}</small></div></div>
        <div class="stat-today">Aujourd’hui <b>${eur(eurNet(today))}</b></div>
        <div class="stat-per">${per.map((x) => `<div>${x.g.icon ? `<img src="${esc(x.g.icon)}" alt="">` : '<div class="ph"></div>'}<b>${eur(eurNet(x.v))}</b></div>`).join('')}</div>`;
      $('#ovStatHint').textContent = salesDeepRunning ? '⏳ historique…' : '';
    } else {
      stat = `<div class="blob"><i></i><i></i><i></i><div class="blob-in"><span>Total gagné</span><b>—</b></div></div>
        <p class="muted small" style="text-align:center;margin:14px 0 0">Connecte ton compte Roblox pour voir tes gains.</p>
        <div style="text-align:center;margin-top:10px"><button class="btn primary" id="ovLogin">Se connecter</button></div>`;
    }
    if ($('#ovStat').dataset.k !== stat) { $('#ovStat').dataset.k = stat; $('#ovStat').innerHTML = stat; if ($('#ovLogin')) $('#ovLogin').onclick = doLogin; }
  }

  function kpi(label, value, foot = '', cls = '', color) {
    return `<div class="kpi ${cls}"><div class="k-label">${color ? `<span class="sw" style="background:${color}"></span>` : ''}${label}</div>
      <div class="k-value">${value}</div><div class="k-foot">${foot}</div></div>`;
  }

  // ---------- Vue groupe ----------
  const groupGames = (id) => config.games.filter((c) => live[c.universeId]?.creatorType === 'Group' && live[c.universeId]?.creatorId == id);
  function groupHeroHTML(id) {
    const gr = groups[id] || {};
    const games = groupGames(id);
    const online = games.reduce((a, c) => a + (live[c.universeId]?.playing || 0), 0);
    const d = deltaOver('grp:' + id, 'm', DAY);
    const desc = (gr.description || '').replace(/\s+/g, ' ').trim();
    return `<div class="hero-card tall group">
      ${gr.icon ? `<div class="hero-img icon grp" style="background-image:url('${esc(gr.icon)}')"></div>` : ''}
      <div class="hero-in">
        <div class="hero-pills"><span class="hpill hot">👥 Groupe</span>${gr.verified ? '<span class="hpill">✔ Vérifié</span>' : ''}</div>
        <h2 class="hero-name">${esc(gr.name || 'Groupe')}</h2>
        <div class="hero-sub">${gr.owner ? 'par ' + esc(gr.owner) : ''}${desc ? ' · ' + esc(desc.slice(0, 110)) + (desc.length > 110 ? '…' : '') : ''}</div>
        <div class="hero-foot">
          <span class="wpill"><b>${fmt(gr.memberCount)}</b> membres</span>
          ${d ? `<span class="wpill">${d.delta >= 0 ? '▲' : '▼'} ${signed(d.delta)} / 24 h</span>` : ''}
          <span class="wpill"><b>${fmt(online)}</b> en ligne</span>
          <span style="flex:1"></span><button class="btn glass" id="grWeb">Voir sur Roblox</button>
        </div>
      </div></div>`;
  }
  function mountGroup(id) {
    main.innerHTML = `
      <div id="grHero"></div>
      <div class="kpis" id="grKpis"></div>
      <div class="ov-bottom">
        <div><div class="sec-head"><h3>Membres du groupe</h3>${segHTML(ranges.group || '7j', 'grSeg')}</div><div class="card flat"><div class="chart" id="grChart"></div></div></div>
        <div><div class="sec-head"><h3>Jeux du groupe</h3></div><div class="glist" id="grGames"></div></div>
      </div>
      <div class="ov-bottom" style="margin-top:22px">
        <div><div class="sec-head"><h3>Robux gagnés par mois</h3><span class="muted small" id="grRevHint"></span></div><div class="card flat"><div class="chart small" id="grRev"></div></div></div>
        <div><div class="sec-head"><h3>Dernières ventes</h3></div><div class="card" id="grSales"></div></div>
      </div>`;
    ranges.group = ranges.group || '7j';
    $('#grSeg').onclick = (e) => { const r = e.target.dataset.r; if (!r) return; ranges.group = r; $$('#grSeg button').forEach((b) => b.classList.toggle('on', b.dataset.r === r)); updateGroup(id); };
    $('#grGames').onclick = (e) => { const r = e.target.closest('.grow-row'); if (r) go('game:' + r.dataset.uid); };
    charts.push(Charts.line($('#grChart'), { series: [], zero: false, emptyText: 'L’évolution des membres se remplit au fil du temps.' }));
    charts.push(Charts.bar($('#grRev'), { labels: [], values: [] }));
    refreshGroups(true);
    updateGroup(id);
  }
  function updateGroup(id) {
    if (!$('#grHero')) return;
    const gr = groups[id] || {};
    const h = groupHeroHTML(id);
    if ($('#grHero').dataset.k !== h) { $('#grHero').dataset.k = h; $('#grHero').innerHTML = h; $('#grWeb').onclick = () => api.openExternal(`https://www.roblox.com/communities/${id}`); }
    const games = groupGames(id);
    const list = hasSales() ? sales.filter((x) => x.owner === 'group:' + id) : null;
    const all = list ? list.reduce((a, x) => a + x.net, 0) : null;
    const today = list ? salesDays(list, 1)[0].net : null;
    const visits = games.reduce((a, c) => a + (live[c.universeId]?.visits || 0), 0);
    const online = games.reduce((a, c) => a + (live[c.universeId]?.playing || 0), 0);
    const d = deltaOver('grp:' + id, 'm', DAY);
    $('#grKpis').innerHTML = `
      ${kpi('Membres', fmt(gr.memberCount), d ? `${signed(d.delta)} sur 24 h` : '')}
      ${kpi('En ligne', fmt(online), `${games.length} jeu${games.length > 1 ? 'x' : ''} suivi${games.length > 1 ? 's' : ''}`)}
      ${kpi('Visites', compact(visits), 'tous les jeux du groupe')}
      ${kpi('Total gagné', all != null ? eur(eurNet(all)) : '—', all != null ? `${robux(all)} · aujourd’hui ${eur(eurNet(today))}` : 'Connecte Roblox')}`;
    const ms = RANGE_MS[ranges.group || '7j'];
    charts[0]?.update({ series: [{ name: 'membres', color: COLORS.blue, points: seriesFor('grp:' + id, 'm', ms) }], zero: false, yFormat: (v) => fmt(v), tMin: Date.now() - ms, tMax: Date.now(), gapMs: 6 * HOUR, emptyText: 'L’évolution des membres se remplit au fil du temps.' });
    const gl = games.map((c) => { const g = live[c.universeId] || {}; const t = allOf(c.universeId);
      return `<button class="grow-row" data-uid="${c.universeId}">${g.icon ? `<img src="${esc(g.icon)}" alt="">` : '<div class="ph"></div>'}<div class="gr-t"><b>${esc(g.name || '…')}</b><span>${fmt(g.playing)} en ligne${t ? ` · <em>${eur(eurNet(t))}</em>` : ''}</span></div>${CHEV}</button>`; }).join('') || '<div class="muted small">Aucun jeu de ce groupe suivi.</div>';
    if ($('#grGames').innerHTML !== gl) $('#grGames').innerHTML = gl;
    if (list) {
      const months = salesMonths(list);
      charts[1]?.update({ labels: months.map((x) => x.date.toLocaleDateString('fr-FR', { month: 'short' })), tipLabels: months.map((x) => x.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })), values: months.map((x) => x.net), tipFormat: (v, i) => `${eur(eurNet(v))} · ${robux(v)} · ${fmt(months[i].count)} ventes` });
      $('#grRevHint').textContent = months.length ? 'depuis ' + months[0].date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
      const last = list.slice().sort((a, b) => b.t - a.t).slice(0, 6);
      $('#grSales').innerHTML = last.length ? `<div class="stat-list">${last.map((x) => `<div class="stat-row"><span><b style="color:var(--text);font-weight:600">${esc(x.item)}</b> <span class="small">· ${esc(x.place || '')} · ${ago(new Date(x.t).toISOString())}</span></span><b>+${fmt(x.net)} R$</b></div>`).join('')}</div>` : '<div class="muted small">Aucune vente pour ce groupe.</div>';
    } else {
      $('#grSales').innerHTML = '<div class="muted small">Connecte ton compte Roblox pour voir les ventes du groupe.</div>';
    }
  }

  // ---------- Vue jeu ----------
  function mountGame(uid) {
    main.innerHTML = `
      <div id="gHero">${heroHTML(uid, true)}</div>
      <div id="gRestricted"></div>
      <div class="kpis" id="gKpis"></div>
      <div class="sec-head"><h3>Joueurs en ligne</h3>${segHTML(ranges.game, 'gSeg')}</div>
      <div class="card flat"><div class="chart" id="gChart"></div></div>
      <div id="gRevenue"></div>
      <div class="sec-head"><h3>Infos</h3></div>
      <div class="card"><div class="info-grid"><div id="gDetails"></div><div id="gServers"></div></div></div>`;
    bindHero(uid);
    $('#gSeg').onclick = (e) => { const r = e.target.dataset.r; if (!r) return; ranges.game = r; $$('#gSeg button').forEach((b) => b.classList.toggle('on', b.dataset.r === r)); updateGame(uid); };
    charts.push(Charts.line($('#gChart'), { series: [] }));
    updateGame(uid);
  }
  function bindHero(uid) {
    $('#gOpen').onclick = () => live[uid]?.placeId && api.openExternal(`https://www.roblox.com/games/${live[uid].placeId}`);
    $('#gDash').onclick = () => api.openExternal(`https://create.roblox.com/dashboard/creations/experiences/${uid}/overview`);
    $('#gMore').onclick = () => {
      openModal(live[uid]?.name || 'Jeu', `<div class="menu-list">
        <button class="btn" id="mRev">Script & clé API (stats même PC éteint)</button>
        <button class="btn" id="mCsv">Exporter en CSV</button>
        <button class="btn danger" id="mDel">Retirer ce jeu</button></div>`);
      $('#mRev').onclick = () => openRevenueModal(uid);
      $('#mCsv').onclick = () => { closeModal(); exportGameCsv(uid); };
      $('#mDel').onclick = () => { closeModal(); removeGame(uid); };
    };
  }

  function updateGame(uid) {
    if (!$('#gKpis')) return;
    const g = live[uid] || {};
    const hh = heroHTML(uid, true), hb = $('#gHero');
    if (hb.dataset.k !== hh) { hb.dataset.k = hh; hb.innerHTML = hh; bindHero(uid); }
    const rb = $('#gRestricted');
    const rKey = g.restricted && !g.name ? (me ? 'me' : 'anon') : '';
    if (rb.dataset.k !== rKey) {
      rb.dataset.k = rKey;
      rb.innerHTML = !rKey ? '' : `<div class="card warn-card"><div class="setup">
        <div class="big-ic" style="background:rgba(245,181,61,.12);color:var(--amber)">⚠</div>
        <div><h3>Roblox masque les statistiques de ce jeu</h3>
        ${me ? `<p>Même connecté en tant que <b style="color:var(--text)">${esc(me.name)}</b>, Roblox renvoie ce jeu comme « contenu restreint ». C’est le cas des jeux privés, pas encore publiés, ou sans <b style="color:var(--text)">questionnaire de maturité</b> rempli. Ouvre le Creator Hub, remplis le questionnaire (Paramètres → Maturité et conformité) et vérifie que le jeu est public.</p>
          <div class="actions"><button class="btn primary" id="rHub">Ouvrir le Creator Hub</button></div>`
        : `<p>Roblox renvoie ce jeu comme « contenu restreint » aux visiteurs anonymes. Connecte ton compte Roblox dans RoStats : l’appli verra tes jeux comme toi. La connexion se fait sur la vraie page roblox.com, ton mot de passe n’est jamais lu par RoStats.</p>
          <div class="actions"><button class="btn primary" id="rLogin">Se connecter à Roblox</button><button class="btn" id="rHub">Ouvrir le Creator Hub</button></div>`}
        </div></div></div>`;
      if ($('#rLogin')) $('#rLogin').onclick = doLogin;
      if ($('#rHub')) $('#rHub').onclick = () => api.openExternal(`https://create.roblox.com/dashboard/creations/experiences/${uid}/overview`);
    }
    const rating = g.up + g.down ? g.up / (g.up + g.down) : null;
    const vh = deltaOver(uid, 'v', HOUR);
    const v24 = deltaOver(uid, 'v', DAY);
    const f24 = deltaOver(uid, 'f', DAY);
    const pk = peakToday(uid);
    const rec = records[uid];
    const favRate = g.visits ? g.favorites / g.visits : null;

    $('#gKpis').innerHTML = `
      ${kpi('En ligne', fmt(g.playing), `Pic du jour ${fmt(pk)} · record ${fmt(rec?.peak)}`)}
      ${kpi('Visites', compact(g.visits), vh ? `${signed(Math.round(vh.delta * HOUR / vh.spanMs))} / h` : fmt(g.visits))}
      ${kpi('Note', rating != null ? pct(rating, 0) : '—', `${fmt(g.up)} j’aime · ${fmt(g.down)} non`)}
      ${kpi('Favoris', compact(g.favorites), f24 ? `${signed(f24.delta)} sur 24 h` : '')}`;

    const ms = RANGE_MS[ranges.game];
    const mg = mergedPlayers(uid, ms, cloudCcu(uid, ms));
    charts[0]?.update({ series: [{ name: 'joueurs', color: COLORS.blue, points: mg.pts }], tMin: Date.now() - ms, tMax: Date.now(), gapMs: Math.max(20 * 60000, S().interval * 4000) });

    $('#gDetails').innerHTML = `
      <div class="stat-list">
        <div class="stat-row"><span>Joueurs max / serveur</span><b>${fmt(g.maxPlayers)}</b></div>
        <div class="stat-row"><span>Créé le</span><b>${dateFr(g.created)}</b></div>
        <div class="stat-row"><span>Dernière mise à jour</span><b>${ago(g.updated)}</b></div>
        <div class="stat-row"><span>Record suivi</span><b>${rec?.peak ? fmt(rec.peak) + ' · ' + new Date(rec.at).toLocaleDateString('fr-FR') : '—'}</b></div>
        ${g.creatorType === 'Group' && groups[g.creatorId] ? (() => { const gr = groups[g.creatorId]; const d = deltaOver('grp:' + g.creatorId, 'm', DAY); return `<div class="stat-row"><span>Membres du groupe</span><b>${fmt(gr.memberCount)}${d ? ` <span class="${d.delta >= 0 ? 'up' : 'down'}" style="font-weight:500">(${signed(d.delta)} / 24 h)</span>` : ''}</b></div>`; })() : ''}
        <div class="stat-row"><span>Universe ID</span><b>${uid}</b></div>
      </div>`;

    const s = servers[uid];
    $('#gServers').innerHTML = !s ? '<div class="muted"><span class="spinner"></span> Chargement…</div>' : s.error ? `<div class="muted small">Indisponible : ${esc(s.error)}</div>` : `
      <div class="stat-list">
        <div class="stat-row"><span>Serveurs actifs</span><b>${fmt(s.count)}${s.truncated ? '+' : ''}</b></div>
        <div class="stat-row"><span>Joueurs / serveur (moy.)</span><b>${fmt(s.avgPlayers, 1)}</b></div>
        <div class="stat-row"><span>Serveurs pleins</span><b>${fmt(s.full)}</b></div>
        <div class="stat-row"><span>Ping moyen</span><b>${s.avgPing != null ? fmt(s.avgPing) + ' ms' : '—'}</b></div>
      </div>`;

    renderRevenue(uid);
  }

  // ---------- Revenus ----------
  // ---------- Revenus ----------
  const eurNet = (net) => (net || 0) * S().devex * fx.rate;   // Robux déjà reçus (après la part Roblox) → €
  const dayKeyLocal = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const salesOf = (uid) => sales.filter((x) => x.uid == uid);
  const hasSales = () => !!me && salesLoaded;

  function salesDays(list, n) {
    const days = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push({ key: dayKeyLocal(d), date: d, net: 0, count: 0 });
    }
    const idx = Object.fromEntries(days.map((d, i) => [d.key, i]));
    for (const x of list) { const i = idx[dayKeyLocal(x.t)]; if (i != null) { days[i].net += x.net; days[i].count++; } }
    return days;
  }

  const revRange = {};
  function salesMonths(list) {
    if (!list.length) return [];
    const first = new Date(Math.min(...list.map((x) => x.t))); first.setDate(1); first.setHours(0, 0, 0, 0);
    const out = [];
    const now = new Date();
    for (const d = new Date(first); d <= now; d.setMonth(d.getMonth() + 1)) out.push({ key: d.getFullYear() * 12 + d.getMonth(), date: new Date(d), net: 0, count: 0 });
    const base = out[0].key;
    for (const x of list) { const d = new Date(x.t); const m = out[d.getFullYear() * 12 + d.getMonth() - base]; if (m) { m.net += x.net; m.count++; } }
    return out;
  }

  function renderRevenue(uid) {
    const box = $('#gRevenue');
    if (!box) return;
    const cfg = gameCfg(uid);
    const money = hasSales() ? 'sales' : cfg?.keyEnc ? 'tracker' : 'none';
    const mode = money + '|' + (cfg?.keyEnc ? 'eng' : 'noeng');
    if (box.dataset.mode !== mode) {
      box.dataset.mode = mode;
      box.innerHTML = `
        ${money === 'none' ? `<div class="card"><div class="card-head"><h3>Revenus</h3></div><p class="muted" style="margin:0 0 12px">Connecte ton compte Roblox pour voir tous tes Robux gagnés.</p><button class="btn primary" id="revLogin">Se connecter à Roblox</button></div>` : `
        <h2 class="section-title">Revenus</h2>
        <div class="kpis" id="rKpis"></div>
        <div class="grid-2">
          <div class="card"><div class="card-head"><h3 id="rChartTitle">Robux gagnés par jour</h3>${money === 'sales' ? `<div class="seg" id="rRange"><button data-v="day">14 jours</button><button data-v="month">Par mois</button></div>` : ''}</div><div class="chart small" id="rChart"></div><div class="hint" id="rChartHint" style="margin-top:6px"></div></div>
          <div class="card"><div class="card-head"><h3>Dernières ventes</h3><span class="hint" id="rLastHint"></span></div><div id="rLast"></div></div>
        </div>
        <div class="card"><div class="card-head"><h3>Meilleures ventes</h3><span class="hint" id="rTopHint"></span></div><div id="rTop"></div></div>`}
        ${cfg?.keyEnc ? `<div class="card"><div class="card-head"><h3>Engagement aujourd’hui</h3><span class="hint">enregistré par le script, même PC éteint</span></div><div id="rEng"></div></div>`
          : ''}`;
      if ($('#revLogin')) $('#revLogin').onclick = doLogin;
      if ($('#revSetup')) $('#revSetup').onclick = () => openRevenueModal(uid);
      if ($('#revCopy')) $('#revCopy').onclick = copyTracker;
      if ($('#rRange')) $('#rRange').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v) { revRange[uid] = v; renderRevenue(uid); } };
      if ($('#rChart')) { charts.push(Charts.bar($('#rChart'), { labels: [], values: [], color: COLORS.green })); box._chart = charts[charts.length - 1]; }
    }
    const r = revenue[uid];
    // --- engagement (script) ---
    if ($('#rEng')) {
      const t = r?.days?.[r.days.length - 1];
      $('#rEng').innerHTML = !r ? '<div class="muted"><span class="spinner"></span> Lecture…</div>' : r.error && !r.days
        ? `<div class="err-box">${esc(r.error)} <button class="btn" id="rFix" style="margin-left:8px">Modifier la clé</button></div>`
        : `<div class="stat-list">
          <div class="stat-row"><span>Entrées de joueurs</span><b>${fmt(t.joins)}</b></div>
          <div class="stat-row"><span>Sessions terminées</span><b>${fmt(t.sessions)}</b></div>
          <div class="stat-row"><span>Durée moyenne de session</span><b>${t.sessions ? dur(t.playSeconds / t.sessions) : '—'}</b></div>
          <div class="stat-row"><span>Temps de jeu total</span><b>${t.playSeconds ? fmt(t.playSeconds / 3600, 1) + ' h' : '—'}</b></div>
          <div class="stat-row"><span>Pic dans un serveur</span><b>${fmt(t.peak)}</b></div></div>`;
      if ($('#rFix')) $('#rFix').onclick = () => openRevenueModal(uid);
    }
    if (money === 'none' || !$('#rKpis')) return;

    if (money === 'sales') {
      const list = salesOf(uid);
      const days = salesDays(list, 14);
      const t = days[days.length - 1], y = days[days.length - 2];
      const week = days.slice(-7).reduce((a, x) => a + x.net, 0);
      const weekCount = days.slice(-7).reduce((a, x) => a + x.count, 0);
      const all = list.reduce((a, x) => a + x.net, 0);
      const pending = list.filter((x) => x.pending).reduce((a, x) => a + x.net, 0);
      const diff = y.net ? (t.net - y.net) / y.net : null;
      const joins = r?.days?.[r.days.length - 1]?.joins;
      const first = list.length ? Math.min(...list.map((x) => x.t)) : null;
      $('#rKpis').innerHTML = `
        ${kpi('Aujourd’hui', eur(eurNet(t.net)), `${robux(t.net)} · ${fmt(t.count)} vente${t.count > 1 ? 's' : ''}`)}
        ${kpi('7 jours', eur(eurNet(week)), `${robux(week)} · ${fmt(weekCount)} ventes`)}
        ${kpi('Total', eur(eurNet(all)), `${robux(all)} · ${fmt(list.length)} ventes${salesDeepRunning ? ' · ⏳' : ''}`)}
        ${kpi('En attente', robux(pending), pending ? eur(eurNet(pending)) : 'Tout est disponible')}`;
      const range = revRange[uid] || (list.length && !days.some((x) => x.count) ? 'month' : 'day');
      $$('#rRange button').forEach((b) => b.classList.toggle('on', b.dataset.v === range));
      if (range === 'month') {
        const months = salesMonths(list);
        $('#rChartTitle').textContent = 'Robux gagnés par mois';
        const best = months.reduce((a, x) => (x.net > (a?.net || 0) ? x : a), null);
        $('#rChartHint').textContent = months.length ? `Depuis ${months[0].date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}${best ? ` · meilleur mois : ${best.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} (${eur(eurNet(best.net))})` : ''}` : '';
        box._chart?.update({
          labels: months.map((x) => x.date.toLocaleDateString('fr-FR', { month: 'short' })),
          tipLabels: months.map((x) => x.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })),
          values: months.map((x) => x.net), color: COLORS.green,
          tipFormat: (v, i) => `${eur(eurNet(v))} · ${robux(v)} reçus · ${fmt(months[i].count)} ventes`,
        });
      } else {
      $('#rChartTitle').textContent = 'Robux gagnés par jour';
      $('#rChartHint').textContent = '';
      box._chart?.update({
        labels: days.map((x, i) => (i % 2 === 1 || i === days.length - 1 ? x.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '')),
        tipLabels: days.map((x) => x.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })),
        values: days.map((x) => x.net), color: COLORS.green,
        tipFormat: (v, i) => `${eur(eurNet(v))} · ${robux(v)} reçus · ${fmt(days[i].count)} ventes`,
      });
      }
      const last = [...list].sort((a, b) => b.t - a.t).slice(0, 6);
      $('#rLastHint').textContent = list.length ? 'en direct' : '';
      $('#rLast').innerHTML = last.length ? `<div class="stat-list">${last.map((x) => `<div class="stat-row"><span><b style="color:var(--text);font-weight:500">${esc(x.item)}</b> <span class="small">· ${esc(x.buyer)} · ${ago(new Date(x.t).toISOString())}${x.pending ? ' · <span class="pill amber">en attente</span>' : ''}</span></span><b>+${fmt(x.net)} R$</b></div>`).join('')}</div>`
        : '<div class="muted small">Aucune vente trouvée pour ce jeu dans l’historique Roblox.</div>';
      const agg = {};
      for (const x of list) {
        const k = x.type + ':' + (x.itemId || x.item);
        const a = (agg[k] = agg[k] || { n: x.item, c: 0, r: 0, type: /pass/i.test(x.type) ? 'Game Pass' : /product/i.test(x.type) ? 'Produit dev' : x.type || 'Autre' });
        a.c++; a.r += x.net;
      }
      const top = Object.values(agg).sort((a, b) => b.r - a.r).slice(0, 10);
      const maxR = Math.max(1, ...top.map((x) => x.r));
      $('#rTopHint').textContent = 'depuis le début';
      $('#rTop').innerHTML = top.length ? `<table><thead><tr><th>Article</th><th>Type</th><th class="r">Ventes</th><th class="r">Reçus · €</th></tr></thead><tbody>
        ${top.map((x) => `<tr><td>${esc(x.n)}</td><td><span class="pill">${esc(x.type)}</span></td><td class="r">${fmt(x.c)}</td>
        <td class="r"><div class="bar-cell"><b>${robux(x.r)}</b><span class="muted small">${eur(eurNet(x.r))}</span><div class="mini-bar"><span style="width:${(x.r / maxR) * 100}%"></span></div></div></td></tr>`).join('')}
        </tbody></table>` : '<div class="muted small">Aucune vente pour l’instant.</div>';
      return;
    }

    // --- argent depuis le script (si pas connecté à Roblox) ---
    if (!r) { $('#rKpis').innerHTML = '<div class="muted"><span class="spinner"></span> Lecture des revenus…</div>'; return; }
    if (r.error && !r.days) { $('#rKpis').innerHTML = `<div class="err-box" style="grid-column:1/-1">${esc(r.error)}</div>`; return; }
    const d = r.days, t = d[d.length - 1];
    const week = d.reduce((a, x) => a + x.robux, 0);
    $('#rKpis').innerHTML = `
      ${kpi('Gagné aujourd’hui', eur(toEur(t.robux)), `${robux(earned(t.robux))} gagnés`, 'money', COLORS.green)}
      ${kpi('Ventes aujourd’hui', fmt(t.sales), robux(t.robux) + ' dépensés')}
      ${kpi('7 derniers jours', eur(toEur(week)), robux(week))}
      ${kpi('Anciennes ventes', '—', '<a href="#" id="rLoginLink">Connecte Roblox</a> pour tout l’historique')}`;
    if ($('#rLoginLink')) $('#rLoginLink').onclick = (e) => { e.preventDefault(); doLogin(); };
    $('#rChartHint').textContent = '7 jours · journées UTC';
    box._chart?.update({ labels: d.map((x) => new Date(x.day + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short' })), values: d.map((x) => earned(x.robux)), color: COLORS.green, tipFormat: (v) => `${eur(eurNet(v))} · ${robux(v)}` });
    $('#rLastHint').textContent = '';
    $('#rLast').innerHTML = '<div class="muted small">Connecte ton compte Roblox pour voir le détail de chaque vente.</div>';
    const agg = {};
    for (const day of d) for (const [k, it] of Object.entries(day.items || {})) { const a = (agg[k] = agg[k] || { n: it.n || k, c: 0, r: 0 }); a.c += Number(it.c) || 0; a.r += Number(it.r) || 0; }
    const top = Object.values(agg).sort((a, b) => b.r - a.r).slice(0, 10);
    $('#rTopHint').textContent = '7 jours';
    $('#rTop').innerHTML = top.length ? `<table><thead><tr><th>Article</th><th class="r">Ventes</th><th class="r">Robux</th></tr></thead><tbody>${top.map((x) => `<tr><td>${esc(x.n)}</td><td class="r">${fmt(x.c)}</td><td class="r">${robux(x.r)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">Aucune vente sur 7 jours.</div>';
  }

  // ---------- Historique des ventes Roblox ----------
  let sales = [];
  let salesLoaded = false;
  let salesBusy = false;
  let salesError = null;
  let salesDeepRunning = false;
  async function refreshSales(full = false) {
    if (!me) return;
    if (salesBusy) { setTimeout(() => refreshSales(full), 3000); return; }
    salesBusy = true;
    try {
      const groupIds = groupIdsOf();
      lastSalesGroups = [...groupIds].sort().join(',');
      const knownIds = full ? [] : sales.slice(0, 300).map((x) => x.id);
      // première fois pour un groupe / compte : on récupère TOUT l'historique, sans limite de date
      const owners = [...groupIds.map((g) => 'group:' + g), 'user:' + me.id];
      const deepDone = (await call(api.get, 'salesDeep', [])) || [];
      const deepOwners = owners.filter((o) => !deepDone.includes(o));
      salesDeepRunning = deepOwners.length > 0;
      if (salesDeepRunning) updateView();
      const res = await call(api.sales, { groupIds, userId: me.id, knownIds, sinceMs: Date.now() - 400 * DAY, deepOwners });
      const failed = new Set((res.errors || []).map((e) => e.owner));
      const nowDone = [...new Set([...deepDone, ...deepOwners.filter((o) => !failed.has(o))])];
      if (deepOwners.length) api.set('salesDeep', nowDone);
      salesDeepRunning = false;
      const known = new Set(sales.map((x) => x.id));
      const fresh = res.sales.filter((x) => x.id && !known.has(x.id));
      // une vente « en attente » peut passer « disponible » : on met à jour l'état
      const byId = new Map(res.sales.map((x) => [x.id, x]));
      sales = sales.map((x) => byId.get(x.id) || x);
      sales = [...fresh, ...sales].sort((a, b) => b.t - a.t).slice(0, 50000);
      if (salesLoaded && fresh.length) window.Sound?.play('coin');
      if (salesLoaded && fresh.length && S().notifySales) {
        const sum = fresh.reduce((a, x) => a + x.net, 0);
        api.notify({ title: `💰 +${eur(eurNet(sum))} (${fmt(sum)} R$)`, body: fresh.length > 1 ? `${fresh.length} ventes` : `${fresh[0].item} acheté par ${fresh[0].buyer}` });
      }
      salesLoaded = true;
      salesError = res.errors?.length ? res.errors.map((e) => e.error).join(' · ') : null;
      api.set('sales', sales);
    } catch (e) {
      salesError = e.message;
    }
    salesDeepRunning = false;
    salesBusy = false;
    updateView();
  }

  async function copyTracker() {
    try { await call(api.copyTracker); toast('Script Luau copié — colle-le dans un Script de ServerScriptService'); }
    catch (e) { toast(e.message, true); }
  }

  function openRevenueModal(uid) {
    const cfg = gameCfg(uid);
    const g = live[uid] || {};
    openModal('Revenus — ' + (g.name || 'jeu'), `
      <ol class="steps">
        <li>Dans Roblox Studio, ajoute un <b>Script</b> dans <b>ServerScriptService</b> et colle le script RoStats <button class="btn" id="mCopy" style="padding:3px 9px;margin-left:4px">Copier</button></li>
        <li>Publie le jeu. Les achats de <b>Game Pass</b> sont suivis automatiquement ; pour les <b>Developer Products</b>, lis le commentaire en haut du script.</li>
        <li>Sur le <a href="#" id="mCred">Creator Hub → Clés API</a>, crée une clé : permission <code>universe-datastores.objects</code> → ton jeu → <b>Read Entry</b>, IP autorisée <code>0.0.0.0/0</code>.</li>
        <li>Colle la clé ci-dessous.</li>
      </ol>
      <div class="field"><label>Clé API Open Cloud</label>
        <input class="input" id="mKey" type="password" placeholder="${cfg?.keyEnc ? '•••••••• (clé enregistrée — laisse vide pour la garder)' : 'Colle ta clé ici'}" autocomplete="off" spellcheck="false">
        <div class="help">Chiffrée sur ton PC avec la protection Windows. Elle sert uniquement à lire les statistiques de ce jeu.</div></div>
      <div class="field"><label>Nom du DataStore</label><input class="input" id="mStore" value="${esc(cfg?.store || 'RoStats_v1')}"></div>
      <div id="mMsg"></div>
      <div class="modal-foot">
        ${cfg?.keyEnc ? '<button class="btn danger" id="mRemove">Supprimer la clé</button>' : ''}
        <button class="btn" id="mTest">Tester</button>
        <button class="btn primary" id="mSave">Enregistrer</button>
      </div>`);
    $('#mCopy').onclick = copyTracker;
    $('#mCred').onclick = (e) => { e.preventDefault(); api.openExternal('https://create.roblox.com/dashboard/credentials'); };
    const getEnc = async () => {
      const k = $('#mKey').value.trim();
      return k ? await call(api.encrypt, k) : cfg?.keyEnc;
    };
    $('#mTest').onclick = async () => {
      const msg = $('#mMsg');
      msg.innerHTML = '<div class="muted small"><span class="spinner"></span> Test en cours…</div>';
      try {
        const keyEnc = await getEnc();
        if (!keyEnc) throw new Error('Colle une clé d’abord.');
        const r = await call(api.testKey, { universeId: uid, keyEnc, store: $('#mStore').value.trim() });
        msg.innerHTML = `<div class="small" style="color:var(--green);margin-bottom:10px">✓ Clé valide. ${r.found ? 'Des données du jour ont été trouvées.' : 'Pas encore de données aujourd’hui — normal si le script vient d’être ajouté.'}</div>`;
      } catch (e) { msg.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
    };
    $('#mSave').onclick = async () => {
      const keyEnc = await getEnc();
      if (!keyEnc) { $('#mMsg').innerHTML = '<div class="err-box">Colle une clé API.</div>'; return; }
      cfg.keyEnc = keyEnc;
      cfg.store = $('#mStore').value.trim() || 'RoStats_v1';
      await saveConfig();
      delete revenue[uid];
      closeModal();
      if ($('#gRevenue')) $('#gRevenue').dataset.mode = '';
      go('game:' + uid);
      toast('Suivi des revenus activé');
    };
    if ($('#mRemove')) $('#mRemove').onclick = async () => {
      delete cfg.keyEnc; delete revenue[uid];
      await saveConfig(); closeModal(); go('game:' + uid);
    };
  }

  // ---------- Ajout de jeux ----------
  function openAddModal(tab = 'link') {
    openModal('Ajouter des jeux', `
      <div class="tabs" id="aTabs">
        <button data-t="link" class="${tab === 'link' ? 'on' : ''}">Lien ou ID</button>
        <button data-t="user" class="${tab === 'user' ? 'on' : ''}">Mon compte</button>
        <button data-t="group" class="${tab === 'group' ? 'on' : ''}">Groupe</button>
      </div>
      <div id="aBody"></div><div id="aMsg"></div>`);
    const body = {
      link: `<div class="field"><label>Lien du jeu, Place ID ou Universe ID</label>
        <input class="input" id="aIn" placeholder="https://www.roblox.com/games/1234567890/Mon-Jeu" spellcheck="false">
        <div class="help">Copie l’adresse de la page du jeu sur roblox.com, ou le Place ID depuis Studio (Fichier → Paramètres du jeu).</div></div>`,
      user: `<div class="field"><label>Ton pseudo Roblox</label><input class="input" id="aIn" placeholder="Pseudo" spellcheck="false">
        <div class="help">Importe tous les jeux publics de ce compte.</div></div>`,
      group: `<div class="field"><label>ID du groupe</label><input class="input" id="aIn" placeholder="ex. 1234567" spellcheck="false">
        <div class="help">Le nombre dans l’adresse de la page du groupe (roblox.com/groups/<b>1234567</b>/…).</div></div>`,
    };
    let cur = tab;
    const draw = () => {
      $('#aBody').innerHTML = body[cur] + `<div class="modal-foot"><button class="btn primary" id="aGo">${cur === 'link' ? 'Ajouter' : 'Importer'}</button></div>`;
      $('#aMsg').innerHTML = '';
      $('#aIn').focus();
      $('#aIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      $('#aGo').onclick = submit;
    };
    $('#aTabs').onclick = (e) => { const t = e.target.dataset.t; if (!t) return; cur = t; $$('#aTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); draw(); };
    async function submit() {
      const v = $('#aIn').value.trim();
      if (!v) return;
      const btn = $('#aGo');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        let ids = [];
        if (cur === 'link') ids = [await call(api.resolve, v)];
        else if (cur === 'user') ids = (await call(api.importUser, v)).universeIds;
        else ids = (await call(api.importGroup, v.replace(/\D/g, ''))).universeIds;
        const fresh = ids.filter((id) => !gameCfg(id));
        if (!ids.length) throw new Error('Aucun jeu public trouvé.');
        if (!fresh.length) throw new Error(ids.length > 1 ? 'Tous ces jeux sont déjà suivis.' : 'Ce jeu est déjà suivi.');
        fresh.forEach((id) => config.games.push({ universeId: id, addedAt: Date.now() }));
        await saveConfig();
        btn.innerHTML = '<span class="spinner"></span> Chargement des statistiques…';
        try { await loadGames(fresh); } catch { /* le cycle suivant réessaiera */ }
        closeModal();
        toast(fresh.length > 1 ? `${fresh.length} jeux ajoutés` : 'Jeu ajouté');
        window.Sound?.play('success');
        go(fresh.length === 1 ? 'game:' + fresh[0] : 'overview');
      } catch (e) {
        $('#aMsg').innerHTML = `<div class="err-box">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = cur === 'link' ? 'Ajouter' : 'Importer';
      }
    }
    draw();
  }

  async function removeGame(uid) {
    const name = live[uid]?.name || 'ce jeu';
    openModal('Retirer le jeu', `<p class="muted">Retirer <b style="color:var(--text)">${esc(name)}</b> de RoStats ? L’historique enregistré et la clé API de ce jeu seront effacés de ton PC. Ton jeu Roblox n’est pas modifié.</p>
      <div class="modal-foot"><button class="btn" id="dNo">Annuler</button><button class="btn primary" id="dYes" style="background:var(--red);border-color:var(--red)">Retirer</button></div>`);
    $('#dNo').onclick = closeModal;
    $('#dYes').onclick = async () => {
      config.games = config.games.filter((g) => g.universeId !== uid);
      delete history[uid]; delete records[uid]; delete live[uid]; delete revenue[uid];
      await saveConfig(); saveHistory(); closeModal(); go('overview');
    };
  }

  // ---------- Miniatures IA ----------
  // Direction artistique : miniatures Roblox « YouTube » (rendu 3D brillant, bacon hair, monstres géants en voxels, contour blanc)
  const DA_STYLE = `Art direction: a top-tier Roblox game thumbnail exactly like the most popular Roblox games and Roblox YouTube thumbnails.
RENDER: high-end 3D render (Blender look), glossy cartoon materials, soft global illumination, bright midday sun, strong warm key light and rim light, very saturated vivid colors, crisp and clean, high contrast.
CHARACTERS: Roblox avatars with blocky Roblox bodies (square head, cylinder-like limbs). Default hero is the popular "bacon hair" Roblox avatar (big swept orange-brown hair, black jacket, blue t-shirt, dark green camo pants, black and white sneakers) or the classic yellow Roblox noob (yellow head and arms, blue shirt, green pants). Very expressive cartoon faces: strained grimace with clenched teeth, terrified face with a sweat drop, or smug confident smile. Dynamic exaggerated pose.
WORLD: bright blue sky with soft fluffy white clouds, Roblox green studded baseplate grass with blocky brown dirt edges, low-poly cube-shaped trees, vivid turquoise cartoon water with white splash rings, wooden docks.
SUBJECT: one giant subject (creature, monster, treasure or overpowered item) with a huge scale contrast against the small player, often built from cubes / voxels, open mouth with big teeth, glowing eyes.
EFFECTS: speed lines, motion trails, glowing fire or golden trails, sparkles, water splashes, coins.
OUTLINE: a thick clean white sticker outline around the main character and the key item.
COMPOSITION: simple and bold, the player on one side and the giant subject or reward on the other side, low dramatic camera angle, wide angle perspective, nothing cluttered.
IMPORTANT: do NOT write any text, letters, numbers, logos or UI in the image.`;

  const STYLE_PRESETS = [
    ['Classique', ''],
    ['Monstre géant', 'Theme: a gigantic monster bursting out and attacking, the small player fighting back or hiding, extreme scale contrast, open jaws.'],
    ['Riche / Argent', 'Theme: wealth, piles of gold coins, cash and glowing gems, golden sparkles and glow.'],
    ['Pêche / Eau', 'Theme: fishing from a wooden dock on turquoise ocean, bent fishing rod, huge catch emerging with big splashes.'],
    ['Forge / Upgrade', 'Theme: crafting and upgrading, hammer hits with fire sparks, an epic glowing legendary item as the reward.'],
    ['Cache-cache / Peur', 'Theme: hide and seek, the scared player hiding while a huge creature searches for him.'],
    ['Simulateur', 'Theme: simulator progression, the player growing stronger, glowing orbs, pets, rewards popping out.'],
    ['Combat / Action', 'Theme: intense battle, impact flashes, motion blur, dynamic angle.'],
  ];
  const PANEL_MOODS = ['bright blue sky', 'warm orange sunset sky', 'magical purple sky'];

  // Styles de texte (fidèles à la D.A : contour noir épais, dégradés)
  const TEXT_STYLES = [
    { name: 'Blanc', stops: ['#ffffff', '#f1f1f1'] },
    { name: 'Jaune', stops: ['#fff36b', '#ffb300'] },
    { name: 'Vert', stops: ['#c3ff70', '#20c53a'] },
    { name: 'Rouge', stops: ['#ff7a6b', '#e3121f'] },
    { name: 'Bleu', stops: ['#8fe6ff', '#1d86ff'] },
    { name: 'Arc-en-ciel', rainbow: true },
  ];
  const FONTS = ['Luckiest Guy', 'Lilita One'];
  const MAX_LIB = 60;

  const ai = { refs: [], library: [], results: [], history: [], preset: 0, count: 2, busy: 0, quality: 'fast', layout: 'single', panels: [{}, {}, {}] };

  let fontsReady = null;
  const ensureFonts = () => (fontsReady = fontsReady || Promise.all(FONTS.map((f) => document.fonts.load(`100px "${f}"`, 'LEVEL +1M $'))).catch(() => {}));
  const setSpacing = (g, px) => { try { g.letterSpacing = `${Math.round(px * 0.04)}px`; g.wordSpacing = `${Math.round(px * 0.18)}px`; } catch {} };

  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  async function shrinkImage(dataUrl, max = 1280, type = 'image/jpeg') {
    try {
      const img = await loadImg(dataUrl);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL(type, 0.9);
    } catch { return null; }
  }

  // ---- Rendu des calques (textes + autocollants) ----
  function textFill(g, st, x0, x1, y0, y1) {
    if (st.rainbow) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      ['#ff3b3b', '#ff9a1f', '#ffe92e', '#4cff5c', '#2ee6ff', '#3d7bff', '#c04dff'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
      return gr;
    }
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, st.stops[0]); gr.addColorStop(1, st.stops[1]);
    return gr;
  }

  function layerBox(g, L, W, H) {
    const px = L.size * H;
    if (L.type === 'text') {
      g.font = `${px}px "${L.font || FONTS[0]}"`;
      setSpacing(g, px);
      const lines = String(L.text || '').split('\n');
      const w = Math.max(...lines.map((l) => g.measureText(l).width), px * 0.5);
      const h = lines.length * px * 1.05;
      return { w: w + px * 0.4, h: h + px * 0.3 };
    }
    return { w: px * 1.6, h: px * 1.2 };
  }

  function drawText(g, L, W, H) {
    const px = L.size * H;
    const st = TEXT_STYLES[L.style || 0] || TEXT_STYLES[0];
    g.font = `${px}px "${L.font || FONTS[0]}"`;
    setSpacing(g, px);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.miterLimit = 2;
    const lines = String(L.text || '').split('\n');
    const lh = px * 1.05;
    lines.forEach((line, i) => {
      const y = (i - (lines.length - 1) / 2) * lh;
      const w = g.measureText(line).width;
      // ombre portée
      g.save(); g.translate(0, px * 0.07);
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = px * 0.24; g.strokeText(line, 0, y); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(line, 0, y);
      g.restore();
      // contour noir épais
      g.strokeStyle = '#121212'; g.lineWidth = px * 0.22; g.strokeText(line, 0, y);
      // remplissage
      g.fillStyle = textFill(g, st, -w / 2, w / 2, y - px / 2, y + px / 2);
      g.fillText(line, 0, y);
      // reflet discret en haut
      g.save(); g.globalAlpha = 0.25; g.beginPath(); g.rect(-w / 2, y - px * 0.5, w, px * 0.32); g.clip();
      g.fillStyle = '#fff'; g.fillText(line, 0, y); g.restore();
    });
  }

  function drawSticker(g, L, W, H) {
    const s = L.size * H;
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (L.kind === 'arrow') {
      // flèche rouge courbe à contour noir
      const path = () => {
        g.beginPath();
        g.moveTo(-s * 0.75, s * 0.25);
        g.quadraticCurveTo(-s * 0.1, -s * 0.55, s * 0.45, -s * 0.05);
      };
      const head = () => {
        g.beginPath();
        g.moveTo(s * 0.72, s * 0.22); g.lineTo(s * 0.18, s * 0.2); g.lineTo(s * 0.55, -s * 0.32); g.closePath();
      };
      g.strokeStyle = '#121212'; g.lineWidth = s * 0.3; path(); g.stroke(); head(); g.lineWidth = s * 0.1; g.stroke(); g.fillStyle = '#121212'; g.fill();
      g.strokeStyle = '#ff2b2b'; g.lineWidth = s * 0.19; path(); g.stroke(); head(); g.fillStyle = '#ff2b2b'; g.fill();
    } else if (L.kind === 'burst') {
      // éclats jaunes « ! »
      const rays = [[-0.55, -0.15, 0.62], [-0.05, -0.62, 0.6], [0.5, -0.35, 0.5]];
      for (const [dx, dy, len] of rays) {
        const ang = Math.atan2(dy, dx);
        const x0 = Math.cos(ang) * s * 0.18, y0 = Math.sin(ang) * s * 0.18;
        const x1 = x0 + Math.cos(ang) * s * len, y1 = y0 + Math.sin(ang) * s * len;
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const poly = () => { g.beginPath(); g.moveTo(x0 + nx * s * 0.03, y0 + ny * s * 0.03); g.lineTo(x1 + nx * s * 0.09, y1 + ny * s * 0.09); g.lineTo(x1 - nx * s * 0.09, y1 - ny * s * 0.09); g.lineTo(x0 - nx * s * 0.03, y0 - ny * s * 0.03); g.closePath(); };
        poly(); g.strokeStyle = '#121212'; g.lineWidth = s * 0.08; g.stroke();
        poly(); g.fillStyle = '#ffd21f'; g.fill();
      }
    } else if (L.kind === 'divider') {
      // séparateur blanc vertical pour les comparaisons
      g.fillStyle = '#121212'; g.fillRect(-s * 0.05, -H, s * 0.1, H * 2);
      g.fillStyle = '#ffffff'; g.fillRect(-s * 0.035, -H, s * 0.07, H * 2);
    }
  }

  function drawLayers(g, layers, W, H, selected = -1) {
    layers.forEach((L, i) => {
      g.save();
      g.translate(L.x * W, L.y * H);
      g.rotate(((L.rot || 0) * Math.PI) / 180);
      if (L.flip) g.scale(-1, 1);
      if (L.type === 'text') drawText(g, L, W, H); else drawSticker(g, L, W, H);
      g.restore();
      if (i === selected) {
        const b = layerBox(g, L, W, H);
        g.save(); g.translate(L.x * W, L.y * H); g.rotate(((L.rot || 0) * Math.PI) / 180);
        g.strokeStyle = '#4c8dff'; g.setLineDash([10, 6]); g.lineWidth = 3; g.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
        g.restore();
      }
    });
  }

  async function composeThumb(baseSrc, layers, scale = 1) {
    await ensureFonts();
    const W = Math.round(1920 * scale), H = Math.round(1080 * scale);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = await loadImg(baseSrc);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, W, H);
    drawLayers(g, layers || [], W, H);
    return c.toDataURL('image/png');
  }

  // Assemble l'image de fond (1 image plein cadre, ou 2-3 panneaux de comparaison)
  async function composeBase(srcs, layout) {
    const W = 1920, H = 1080;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const n = srcs.length;
    for (let i = 0; i < n; i++) {
      const img = await loadImg(srcs[i]);
      const pw = W / n, x0 = pw * i;
      const k = Math.max(pw / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      g.save(); g.beginPath(); g.rect(x0, 0, pw, H); g.clip();
      g.drawImage(img, x0 + (pw - w) / 2, (H - h) / 2, w, h);
      g.restore();
    }
    return c.toDataURL('image/jpeg', 0.93);
  }

  function defaultLayers(layout, text, panels) {
    const L = [];
    if (layout === 'single') {
      if (text) L.push({ type: 'text', text, x: 0.5, y: 0.15, size: text.length > 14 ? 0.1 : 0.14, style: 0, rot: -2, font: FONTS[0] });
      return L;
    }
    const n = layout === 'split3' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const p = panels[i] || {};
      const cx = (i + 0.5) / n;
      const last = i === n - 1;
      if (p.title) L.push({ type: 'text', text: p.title, x: cx, y: 0.11, size: n === 3 ? 0.085 : 0.11, style: last ? (n === 3 ? 5 : 1) : 0, rot: 0, font: FONTS[0] });
      if (p.sub) L.push({ type: 'text', text: p.sub, x: cx, y: 0.86, size: n === 3 ? 0.12 : 0.13, style: last ? 2 : i === 0 ? 0 : 1, rot: 0, font: FONTS[0] });
      if (i < n - 1) L.push({ type: 'sticker', kind: 'divider', x: (i + 1) / n, y: 0.5, size: 0.12, rot: 3 });
    }
    return L;
  }

  // ---- Bibliothèque de style (l'IA s'inspire de ces images) ----
  const libKey = 'ailibrary';
  function saveLibrary() { api.set(libKey, ai.library); }

  function pickStyleRefs(nSlots) {
    if (nSlots <= 0 || !ai.library.length) return [];
    const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const same = shuffle(ai.library.filter((x) => x.tag === ai.preset));
    const liked = shuffle(ai.library.filter((x) => x.liked && x.tag !== ai.preset));
    const rest = shuffle(ai.library.filter((x) => !x.liked && x.tag !== ai.preset));
    return [...same, ...liked, ...rest].slice(0, nSlots).map((x) => x.src);
  }

  const readFile = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(file); });

  async function addImages(files, target) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (target === 'ref' && ai.refs.length >= 3) { toast('Maximum 3 images à toi par miniature', true); break; }
      if (target === 'lib' && ai.library.length >= MAX_LIB) { toast(`Bibliothèque pleine (${MAX_LIB} images)`, true); break; }
      const raw = await readFile(f);
      const small = raw && (await shrinkImage(raw, target === 'lib' ? 768 : 1024));
      if (!small) continue;
      if (target === 'lib') ai.library.push({ id: Date.now() + Math.random().toString(36).slice(2, 6), src: small, tag: -1, liked: false });
      else ai.refs.push(small);
    }
    if (target === 'lib') { saveLibrary(); toast('Ajoutée(s) à la bibliothèque de style'); }
    saveDraft();
    drawRefs();
  }

  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => api.set('aidraft', { prompt: ai.prompt || '', text: ai.text || '', refs: ai.refs, preset: ai.preset, count: ai.count, quality: ai.quality, layout: ai.layout, panels: ai.panels }), 400);
  }

  function drawRefs() {
    const r = $('#aiRefs');
    if (r) r.innerHTML = ai.refs.map((src, i) => `<div class="ref"><img src="${src}" alt=""><button data-k="ref" data-i="${i}" title="Retirer">✕</button></div>`).join('');
    const l = $('#aiLib');
    if (l) l.innerHTML = ai.library.map((x, i) => `<div class="ref lib ${x.liked ? 'liked' : ''}" title="${x.tag >= 0 ? STYLE_PRESETS[x.tag][0] : 'Toutes ambiances'}${x.liked ? ' · une de tes préférées' : ''}"><img src="${x.src}" alt="">${x.liked ? '<span class="heart">♥</span>' : ''}<button data-k="lib" data-i="${i}" title="Retirer">✕</button></div>`).join('');
    const n = $('#aiLibCount'); if (n) n.textContent = `${ai.library.length} / ${MAX_LIB}`;
  }

  const isFree = () => !config.ai?.provider || config.ai.provider === 'free';
  function aiReady() { return isFree() || !!config.ai?.keyEnc; }

  async function mountThumbs() {
    if (!ai.loaded) {
      ai.library = (await call(api.get, libKey, null)) || [];
      const old = (await call(api.get, 'aistyle', [])) || [];
      if (old.length) { old.forEach((src) => ai.library.push({ id: Math.random().toString(36).slice(2), src, tag: -1, liked: false })); saveLibrary(); api.set('aistyle', []); }
      const d = (await call(api.get, 'aidraft', null)) || {};
      Object.assign(ai, { prompt: d.prompt || '', text: d.text || '', refs: (d.refs || []).slice(0, 3), preset: Math.min(d.preset || 0, STYLE_PRESETS.length - 1), count: d.count || 2, quality: d.quality || 'fast', layout: d.layout || 'single', panels: d.panels || [{}, {}, {}] });
      ai.loaded = true;
    }
    const prov = isFree() ? 'Gratuit · FLUX.2' + (config.ai?.keyEnc ? ' (compte Hugging Face)' : '') : config.ai?.provider === 'openai' ? 'OpenAI · GPT Image' : 'Google · Nano Banana';
    const split = ai.layout !== 'single';
    const nP = ai.layout === 'split3' ? 3 : 2;
    main.innerHTML = `
      <div class="page-head"><div class="grow"><h1>Miniatures IA</h1><div class="sub">Style « miniature Roblox YouTube » · l’IA dessine la scène, RoStats ajoute les textes et effets sans fautes.</div></div>
        <div class="actions"><button class="btn" id="aiFolder">Dossier des miniatures</button></div></div>
      <div class="ai-layout">
        <div class="ai-form">
          <div class="card">
            <div class="engine-line"><span class="dot ${aiReady() ? 'on' : ''}"></span><span style="flex:1">${aiReady() ? 'Moteur : <b>' + prov + '</b>' : 'Moteur IA non configuré'}</span><button class="btn" id="aiEngine">${aiReady() ? 'Modifier' : 'Configurer'}</button></div>
          </div>
          <div class="card">
            <div class="field"><label>Mise en page</label><div class="seg" id="aiLayout">${[['single', 'Image unique'], ['split2', 'Comparaison ×2'], ['split3', 'Comparaison ×3']].map(([k, n]) => `<button data-l="${k}" class="${k === ai.layout ? 'on' : ''}">${n}</button>`).join('')}</div></div>
            <div class="field"><label>${split ? 'Décris la scène (commune à tous les panneaux)' : 'Décris ta miniature'}</label>
              <textarea class="input" id="aiPrompt" placeholder="${split ? 'Ex : mon avatar qui fait des ricochets avec une pierre sur une rivière' : 'Ex : mon avatar sur un ponton qui pêche un kraken géant violet en cubes qui sort de l’eau'}">${esc(ai.prompt || '')}</textarea></div>
            ${split ? `<div class="panels">${Array.from({ length: nP }, (_, i) => { const p = ai.panels[i] || {}; return `<div class="panel-box"><div class="panel-n">Panneau ${i + 1}</div>
                <input class="input pin" data-p="${i}" data-f="desc" placeholder="${['Version faible (ex : petite pierre grise)', 'Version moyenne (ex : pierre en or)', 'Version ultime (ex : pierre de lave en feu)'][nP === 2 && i === 1 ? 2 : i]}" value="${esc(p.desc || '')}">
                <div class="row"><input class="input pin" data-p="${i}" data-f="title" placeholder="Titre (LEVEL ${[1, 100, 999][nP === 2 && i === 1 ? 2 : i]})" value="${esc(p.title || '')}"><input class="input pin" data-p="${i}" data-f="sub" placeholder="Bas (ex : +1)" value="${esc(p.sub || '')}"></div></div>`; }).join('')}</div>`
            : `<div class="field"><label>Titre sur la miniature (optionnel)</label>
              <input class="input" id="aiText" placeholder="Ex : SOLD, SECRET, +1M" value="${esc(ai.text || '')}"><div class="help">Ajouté par RoStats avec la police style Roblox : orthographe parfaite, modifiable après.</div></div>`}
            <div class="field"><label>Thème</label><div class="chips" id="aiPresets">${STYLE_PRESETS.map(([n], i) => `<button class="chip ${i === ai.preset ? 'on' : ''}" data-i="${i}">${n}</button>`).join('')}</div></div>
            <div class="field"><label>Tes images (ton avatar, objets du jeu) — glisse, clique ou Ctrl+V</label>
              <div class="drop" id="aiDrop">Déposer jusqu’à 3 images</div>
              <div class="refs" id="aiRefs"></div></div>
          </div>
          <div class="card">
            <div class="card-head" style="margin-bottom:8px"><h3>Bibliothèque de style</h3><span class="hint" id="aiLibCount"></span></div>
            <div class="help small muted" style="line-height:1.5;margin-bottom:8px">Mets ici un maximum de miniatures que tu aimes. À chaque génération, l’IA en prend 2 au hasard comme modèles. Tes miniatures notées ♥ y sont ajoutées automatiquement.</div>
            <div class="drop" id="aiLibDrop">Ajouter des miniatures modèles</div>
            <div class="refs lib-grid" id="aiLib"></div>
          </div>
          <div class="card">
            <div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap">
              <div class="field" style="margin:0"><label>Variantes</label><div class="seg" id="aiCount">${[1, 2, 4].map((n) => `<button data-n="${n}" class="${n === ai.count ? 'on' : ''}">${n}</button>`).join('')}</div></div>
              <div class="field" style="margin:0"><label>Qualité</label><div class="seg" id="aiQual">${[['fast', 'Rapide'], ['hq', 'Haute qualité']].map(([k, n]) => `<button data-q="${k}" class="${k === ai.quality ? 'on' : ''}">${n}</button>`).join('')}</div></div>
            </div>
            <button class="btn primary gen-btn" id="aiGo" style="margin-top:14px">✨ Générer la miniature</button>
            <div class="help small muted" style="margin-top:8px;line-height:1.5">${isFree() ? `100 % gratuit · ${config.ai?.keyEnc ? 'environ 60' : 'environ 20'} images par jour en Rapide, ${config.ai?.keyEnc ? 'environ 8' : 'environ 3'} en Haute qualité.${split ? ` Une comparaison ×${nP} utilise ${nP} images.` : ''}` : 'Chaque image est facturée par le fournisseur IA sur ton compte.'}</div>
          </div>
          <input type="file" id="aiFile" accept="image/*" multiple hidden>
        </div>
        <div>
          <div class="card-head" style="margin-bottom:10px"><h3 style="margin:0;font-size:15px">Résultats</h3><span class="hint" id="aiHint"></span></div>
          <div class="results" id="aiResults"></div>
        </div>
      </div>`;
    drawRefs();
    drawResults();
    if (!ai.historyLoaded) {
      call(api.aiList).then(async (h) => {
        ai.history = h || []; ai.historyLoaded = true;
        for (const x of ai.history) if (!x.src && x.base) x.src = await composeThumb(x.base, x.layers || [], 0.5).catch(() => x.base);
        drawResults();
      }).catch(() => {});
    }

    let fileTarget = 'ref';
    const pick = (t) => { fileTarget = t; $('#aiFile').value = ''; $('#aiFile').click(); };
    $('#aiFile').onchange = (e) => addImages([...e.target.files], fileTarget);
    for (const [id, t] of [['#aiDrop', 'ref'], ['#aiLibDrop', 'lib']]) {
      const z = $(id);
      z.onclick = () => pick(t);
      z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); };
      z.ondragleave = () => z.classList.remove('over');
      z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); addImages([...e.dataTransfer.files], t); };
    }
    main.onpaste = (e) => {
      if (view !== 'thumbs' || e.target.matches('input, textarea')) return;
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); addImages(files, 'ref'); }
    };
    main.onclick = (e) => {
      const b = e.target.closest('.ref button');
      if (!b) return;
      if (b.dataset.k === 'lib') { ai.library.splice(Number(b.dataset.i), 1); saveLibrary(); }
      else ai.refs.splice(Number(b.dataset.i), 1);
      saveDraft(); drawRefs();
    };
    $('#aiPrompt').oninput = (e) => { ai.prompt = e.target.value; saveDraft(); };
    if ($('#aiText')) $('#aiText').oninput = (e) => { ai.text = e.target.value; saveDraft(); };
    $$('.pin').forEach((inp) => (inp.oninput = () => { const i = Number(inp.dataset.p); ai.panels[i] = { ...ai.panels[i], [inp.dataset.f]: inp.value }; saveDraft(); }));
    const seg = (id, attr, fn) => ($(id).onclick = (e) => { const v = e.target.dataset[attr]; if (v == null) return; fn(v); saveDraft(); $$(id + ' button').forEach((c) => c.classList.toggle('on', c.dataset[attr] === v)); });
    seg('#aiCount', 'n', (v) => (ai.count = Number(v)));
    seg('#aiQual', 'q', (v) => (ai.quality = v));
    $('#aiLayout').onclick = (e) => { const v = e.target.dataset.l; if (!v) return; ai.layout = v; saveDraft(); mountThumbs(); };
    $('#aiPresets').onclick = (e) => { const i = e.target.dataset.i; if (i == null) return; ai.preset = Number(i); saveDraft(); $$('#aiPresets .chip').forEach((c) => c.classList.toggle('on', c.dataset.i === i)); };
    $('#aiEngine').onclick = openEngineModal;
    $('#aiFolder').onclick = () => api.aiOpenFolder();
    $('#aiGo').onclick = generate;
  }

  function buildPrompt(scene, panelInfo, styleCount) {
    const parts = [DA_STYLE];
    if (STYLE_PRESETS[ai.preset][1]) parts.push(STYLE_PRESETS[ai.preset][1]);
    parts.push(`SCENE (written by the user, possibly in French): ${scene}`);
    if (panelInfo) parts.push(panelInfo);
    let idx = 1;
    if (ai.refs.length) {
      const r = ai.refs.length === 1 ? 'Image 1 is' : `Images 1 to ${ai.refs.length} are`;
      parts.push(`${r} the user's own Roblox avatar / game objects: keep them recognizable (same outfit, colors, shapes) and make them the hero of the scene.`);
      idx += ai.refs.length;
    }
    if (styleCount) parts.push(`${styleCount === 1 ? `Image ${idx} is a style example` : `Images ${idx} to ${idx + styleCount - 1} are style examples`}: copy their art direction exactly (rendering, colors, lighting, white outlines, composition, camera) but do NOT copy their characters, objects or text.`);
    if (!panelInfo && (ai.text || '').trim()) parts.push('Keep the top fifth of the image simple (sky) because a big title will be added there later.');
    parts.push('Wide landscape thumbnail.');
    return parts.join('\n\n');
  }

  async function generate() {
    if (!aiReady()) { openEngineModal(); return; }
    if (!(ai.prompt || '').trim()) { toast('Décris d’abord ta miniature', true); $('#aiPrompt').focus(); return; }
    const layout = ai.layout;
    const nP = layout === 'split3' ? 3 : layout === 'split2' ? 2 : 1;
    const panels = ai.panels.slice(0, nP).map((p) => ({ ...p }));
    const meta = { prompt: ai.prompt, text: layout === 'single' ? ai.text : '', preset: STYLE_PRESETS[ai.preset][0], presetIndex: ai.preset, layout, panels };
    const jobs = Array.from({ length: ai.count }, (_, i) => ({ key: Date.now() + '_' + i, status: 'loading', meta }));
    ai.results.unshift(...jobs);
    ai.busy += jobs.length;
    drawResults();
    const size = nP === 3 ? { width: 608, height: 1024 } : nP === 2 ? { width: 912, height: 1024 } : { width: 1024, height: 576 };
    await Promise.all(jobs.map(async (job, j) => {
      try {
        if (j) await new Promise((r) => setTimeout(r, j * 800));
        const srcs = [];
        for (let i = 0; i < nP; i++) {
          const styleSlots = Math.max(0, Math.min(2, 4 - ai.refs.length));
          const styles = pickStyleRefs(styleSlots);
          let panelInfo = '';
          if (nP > 1) {
            const p = panels[i] || {};
            const strength = i === 0 ? 'the weakest / most basic version' : i === nP - 1 ? 'the ultimate, overpowered, legendary version with epic glow and effects' : 'an improved, stronger version';
            panelInfo = `This image is panel ${i + 1} of ${nP} of a "level up" comparison thumbnail, tall format. Show ${strength}${p.desc ? ': ' + p.desc : ''}. Background: ${PANEL_MOODS[i] || PANEL_MOODS[0]}, same world style as the other panels.`;
          }
          const prompt = buildPrompt(ai.prompt.trim(), panelInfo, styles.length);
          const out = await call(api.aiGenerate, { provider: config.ai.provider, keyEnc: config.ai.keyEnc, model: config.ai.model, quality: isFree() ? ai.quality : config.ai.quality, prompt, images: [...ai.refs, ...styles], ...size });
          srcs.push(out[out.length - 1]);
        }
        job.base = await composeBase(srcs, layout);
        job.layers = defaultLayers(layout, (meta.text || '').trim(), panels);
        job.src = await composeThumb(job.base, job.layers);
        job.status = 'done';
        job.id = await call(api.aiSave, { dataUrl: job.src, baseUrl: job.base, meta: { ...meta, layers: job.layers } }).catch(() => null);
      } catch (e) {
        job.status = 'failed'; job.error = e.message;
      }
      ai.busy--;
      drawResults();
    }));
  }

  function drawResults() {
    const el = $('#aiResults');
    if (!el) return;
    const sessionIds = new Set(ai.results.map((r) => r.id).filter(Boolean));
    const items = [...ai.results, ...ai.history.filter((h) => !sessionIds.has(h.id)).map((h) => ({ ...h, status: 'done', meta: h }))];
    $('#aiHint').textContent = ai.busy ? `Génération en cours… (${ai.busy})` : items.length ? `${items.length} miniature${items.length > 1 ? 's' : ''}` : '';
    if (!items.length) {
      el.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;padding:50px 20px"><div class="muted" style="line-height:1.7">Tes miniatures apparaîtront ici.<br>Astuce : ajoute une capture de ton avatar, et remplis la bibliothèque de style avec les miniatures que tu aimes.</div></div>`;
      return;
    }
    el.innerHTML = items.map((r, i) => `<div class="result ${r.status}" data-i="${i}">
      <div class="img">${r.status === 'done' ? `<img src="${r.src}" alt="" data-act="view">` : r.status === 'failed' ? esc(r.error) : `<div style="text-align:center"><span class="spinner"></span><div class="small muted" style="margin-top:8px">Génération… (${ai.quality === 'hq' ? '30 à 90 s' : '5 à 30 s'})</div></div>`}</div>
      <div class="bar"><span class="p" title="${esc(r.meta?.prompt)}">${esc(r.meta?.prompt || '')}</span>
        ${r.status === 'done' ? `<button class="icon-btn like ${r.liked ? 'on' : ''}" data-act="like" title="J’aime : l’IA s’en inspirera">♥</button><button class="btn" data-act="texts">Textes & effets</button><button class="btn" data-act="save">Enregistrer</button><button class="btn" data-act="edit">Retoucher</button><button class="icon-btn" data-act="del" title="Supprimer">✕</button>` : r.status === 'failed' ? `<button class="icon-btn" data-act="del" title="Retirer">✕</button>` : ''}
      </div></div>`).join('');
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const r = items[Number(b.closest('.result').dataset.i)];
      const act = b.dataset.act;
      const full = async () => (r.base ? composeThumb(r.base, r.layers || []) : r.src);
      if (act === 'view') {
        const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<img src="${await full()}" alt="">`;
        v.onclick = () => v.remove(); document.body.appendChild(v);
      } else if (act === 'save') {
        const name = 'miniature_' + (r.meta?.text || r.meta?.prompt || 'roblox').slice(0, 30).replace(/[^\wÀ-ÿ -]/g, '').trim().replace(/\s+/g, '_') + '.png';
        const p = await call(api.aiExport, { dataUrl: await full(), filename: name }).catch((er) => toast(er.message, true));
        if (p) toast('Enregistrée : ' + p);
      } else if (act === 'like') {
        if (r.liked) return;
        r.liked = true;
        const tag = r.meta?.presetIndex ?? ai.preset;
        const src = await shrinkImage(await full(), 768);
        if (ai.library.length >= MAX_LIB) { const k = ai.library.findIndex((x) => !x.liked); ai.library.splice(k >= 0 ? k : 0, 1); }
        ai.library.push({ id: Date.now().toString(36), src, tag, liked: true });
        saveLibrary(); drawRefs(); drawResults();
        toast('♥ Ajoutée à ta bibliothèque : l’IA s’en inspirera');
      } else if (act === 'texts') {
        if (!r.base) { toast('Cette ancienne miniature n’a pas de calques modifiables', true); return; }
        openLayerEditor(r);
      } else if (act === 'edit') {
        const small = await shrinkImage(r.base || r.src, 1024, 'image/jpeg');
        ai.refs = [small, ...ai.refs].slice(0, 3);
        ai.layout = 'single';
        ai.prompt = 'Garde exactement cette image (image 1) et change seulement : ';
        saveDraft();
        mountThumbs();
        const t = $('#aiPrompt'); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
      } else if (act === 'del') {
        if (r.id) await call(api.aiDelete, r.id).catch(() => {});
        ai.results = ai.results.filter((x) => x !== r && (!r.id || x.id !== r.id));
        ai.history = ai.history.filter((x) => x.id !== r.id);
        drawResults();
      }
    };
  }

  // ---- Éditeur de textes & effets ----
  function openLayerEditor(r) {
    const layers = JSON.parse(JSON.stringify(r.layers || []));
    let sel = layers.findIndex((l) => l.type === 'text');
    openModal('Textes & effets', `
      <div class="le">
        <div class="le-canvas"><canvas id="leC" width="1920" height="1080"></canvas></div>
        <div class="le-tools">
          <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">
            <button class="btn" data-add="text">+ Texte</button><button class="btn" data-add="plus">+ « +1 »</button>
            <button class="btn" data-add="arrow">+ Flèche</button><button class="btn" data-add="burst">+ Éclats</button>
          </div>
          <div id="leProps"></div>
          <div class="help small muted" style="margin-top:10px">Clique sur un élément pour le sélectionner, fais-le glisser pour le déplacer.</div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" id="leCancel">Annuler</button><button class="btn primary" id="leSave">Appliquer</button></div>`);
    $('.modal').classList.add('wide');
    const cv = $('#leC'), g = cv.getContext('2d');
    let baseImg = null;
    loadImg(r.base).then((i) => { baseImg = i; draw(); });
    ensureFonts().then(() => draw());
    function draw() {
      g.clearRect(0, 0, 1920, 1080);
      if (baseImg) g.drawImage(baseImg, 0, 0, 1920, 1080);
      drawLayers(g, layers, 1920, 1080, sel);
    }
    function props() {
      const L = layers[sel];
      const el = $('#leProps');
      if (!L) { el.innerHTML = '<div class="muted small">Aucun élément sélectionné.</div>'; return; }
      el.innerHTML = `
        ${L.type === 'text' ? `<div class="field"><label>Texte (Entrée = nouvelle ligne)</label><textarea class="input" id="lpText" rows="2" style="min-height:56px">${esc(L.text)}</textarea></div>
        <div class="field"><label>Couleur</label><div class="chips">${TEXT_STYLES.map((s, i) => `<button class="chip sw ${i === (L.style || 0) ? 'on' : ''}" data-st="${i}"><span style="background:${s.rainbow ? 'linear-gradient(90deg,#ff3b3b,#ffe92e,#4cff5c,#2ee6ff,#c04dff)' : `linear-gradient(${s.stops[0]},${s.stops[1]})`}"></span>${s.name}</button>`).join('')}</div></div>
        <div class="field"><label>Police</label><div class="seg" id="lpFont">${FONTS.map((f) => `<button data-f="${f}" class="${(L.font || FONTS[0]) === f ? 'on' : ''}" style="font-family:'${f}'">${f}</button>`).join('')}</div></div>` : ''}
        <div class="field"><label>Taille</label><input type="range" id="lpSize" min="0.03" max="0.35" step="0.005" value="${L.size}"></div>
        <div class="field"><label>Inclinaison</label><input type="range" id="lpRot" min="-45" max="45" step="1" value="${L.rot || 0}"></div>
        ${L.type === 'sticker' && L.kind !== 'divider' ? '<div class="field"><button class="btn" id="lpFlip">Retourner</button></div>' : ''}
        <button class="btn danger" id="lpDel">Supprimer cet élément</button>`;
      if ($('#lpText')) $('#lpText').oninput = (e) => { L.text = e.target.value; draw(); };
      $$('#leProps [data-st]').forEach((b) => (b.onclick = () => { L.style = Number(b.dataset.st); props(); draw(); }));
      if ($('#lpFont')) $('#lpFont').onclick = (e) => { if (!e.target.dataset.f) return; L.font = e.target.dataset.f; props(); draw(); };
      $('#lpSize').oninput = (e) => { L.size = Number(e.target.value); draw(); };
      $('#lpRot').oninput = (e) => { L.rot = Number(e.target.value); draw(); };
      if ($('#lpFlip')) $('#lpFlip').onclick = () => { L.flip = !L.flip; draw(); };
      $('#lpDel').onclick = () => { layers.splice(sel, 1); sel = -1; props(); draw(); };
    }
    $$('.le-tools [data-add]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.add;
      if (k === 'text') layers.push({ type: 'text', text: 'TEXTE', x: 0.5, y: 0.5, size: 0.12, style: 0, rot: 0, font: FONTS[0] });
      else if (k === 'plus') layers.push({ type: 'text', text: '+1', x: 0.6, y: 0.4, size: 0.1, style: 0, rot: -8, font: FONTS[0] });
      else layers.push({ type: 'sticker', kind: k, x: 0.5, y: 0.5, size: k === 'arrow' ? 0.22 : 0.16, rot: 0 });
      sel = layers.length - 1; props(); draw();
    }));
    // sélection + glisser
    const toLocal = (e) => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; };
    let drag = null;
    cv.onpointerdown = (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch {}
      const p = toLocal(e);
      sel = -1;
      for (let i = layers.length - 1; i >= 0; i--) {
        const L = layers[i];
        if (L.kind === 'divider') continue;
        const bx = layerBox(g, L, 1920, 1080);
        if (Math.abs(p.x * 1920 - L.x * 1920) < bx.w / 2 && Math.abs(p.y * 1080 - L.y * 1080) < bx.h / 2) { sel = i; break; }
      }
      if (sel >= 0) drag = { dx: p.x - layers[sel].x, dy: p.y - layers[sel].y };
      props(); draw();
    };
    cv.onpointermove = (e) => {
      if (!drag || sel < 0) return;
      const p = toLocal(e);
      layers[sel].x = Math.max(0, Math.min(1, p.x - drag.dx));
      layers[sel].y = Math.max(0, Math.min(1, p.y - drag.dy));
      draw();
    };
    window.onpointerup = () => (drag = null);
    props();
    $('#leCancel').onclick = () => { $('.modal').classList.remove('wide'); closeModal(); };
    $('#leSave').onclick = async () => {
      r.layers = layers;
      r.src = await composeThumb(r.base, layers);
      if (r.id) await call(api.aiSave, { id: r.id, dataUrl: r.src, meta: { layers } }).catch(() => {});
      const h = ai.history.find((x) => x.id === r.id); if (h) { h.layers = layers; h.src = r.src; }
      $('.modal').classList.remove('wide'); closeModal(); drawResults();
      toast('Miniature mise à jour');
    };
  }

  function openEngineModal() {
    const c = config.ai || {};
    const models = { free: '', gemini: 'gemini-nano-banana-2.1', openai: 'gpt-image-2' };
    const curProv = c.provider || 'free';
    openModal('Moteur IA', `
      <p class="muted small" style="margin-top:0;line-height:1.6">Par défaut, RoStats utilise <b style="color:var(--text)">FLUX.2 klein</b> de Black Forest Labs, hébergé gratuitement sur Hugging Face : aucun compte ni carte bancaire, et il garde ton avatar à partir de tes images.</p>
      <div class="field"><label>Moteur</label>
        <select class="input" id="eProv"><option value="free" ${curProv === 'free' ? 'selected' : ''}>Gratuit · FLUX.2 klein (recommandé)</option><option value="gemini" ${curProv === 'gemini' ? 'selected' : ''}>Google Gemini · Nano Banana (payant)</option><option value="openai" ${curProv === 'openai' ? 'selected' : ''}>OpenAI · GPT Image (payant)</option></select></div>
      <div class="field"><label id="eKeyLabel">Clé API</label>
        <input class="input" id="eKey" type="password" autocomplete="off" spellcheck="false" placeholder="${c.keyEnc ? '•••••••• (enregistrée — laisse vide pour la garder)' : 'Colle ta clé ici'}">
        <div class="help" id="eHelp"></div></div>
      <div class="field"><label>Modèle</label><input class="input" id="eModel" spellcheck="false" value="${esc(c.model || '')}" placeholder="">
        <div class="help">Laisse vide pour le modèle par défaut.</div></div>
      <div class="field" id="eQualWrap"><label>Qualité (OpenAI)</label>
        <select class="input" id="eQual">${['high', 'medium', 'low'].map((q) => `<option value="${q}" ${(c.quality || 'high') === q ? 'selected' : ''}>${{ high: 'Haute', medium: 'Moyenne', low: 'Rapide' }[q]}</option>`).join('')}</select></div>
      <div class="modal-foot">${c.keyEnc ? '<button class="btn danger" id="eDel">Supprimer la clé</button>' : ''}<button class="btn primary" id="eSave">Enregistrer</button></div>`);
    const sync = () => {
      const p = $('#eProv').value;
      $('#eModel').placeholder = models[p];
      $('#eModel').closest('.field').style.display = p === 'free' ? 'none' : '';
      $('#eQualWrap').style.display = p === 'openai' ? '' : 'none';
      $('#eKeyLabel').textContent = p === 'free' ? 'Token Hugging Face (facultatif)' : 'Clé API';
      if (p === 'free') {
        $('#eHelp').innerHTML = 'Sans token : environ 20 miniatures par jour. Avec un token gratuit (compte sur huggingface.co, puis <a href="#" id="eLink">Settings → Access Tokens</a>, type « Read ») : environ 60 par jour. Chiffré sur ton PC.';
        $('#eLink').onclick = (ev) => { ev.preventDefault(); api.openExternal('https://huggingface.co/settings/tokens'); };
        return;
      }
      $('#eHelp').innerHTML = p === 'openai'
        ? 'Crée une clé sur <a href="#" id="eLink">platform.openai.com/api-keys</a>. Chiffrée sur ton PC.'
        : 'Crée une clé sur <a href="#" id="eLink">aistudio.google.com/apikey</a>. Chiffrée sur ton PC.';
      $('#eLink').onclick = (ev) => { ev.preventDefault(); api.openExternal(p === 'openai' ? 'https://platform.openai.com/api-keys' : 'https://aistudio.google.com/apikey'); };
    };
    $('#eProv').onchange = () => { $('#eModel').value = ''; sync(); };
    sync();
    $('#eSave').onclick = async () => {
      const k = $('#eKey').value.trim();
      const prov = $('#eProv').value;
      const keyEnc = k ? await call(api.encrypt, k) : (prov === curProv ? c.keyEnc : null);
      if (!keyEnc && prov !== 'free') { toast('Colle ta clé API', true); return; }
      config.ai = { provider: prov, keyEnc, model: $('#eModel').value.trim(), quality: $('#eQual').value };
      await saveConfig(); closeModal(); mountThumbs(); toast('Moteur IA enregistré');
    };
    if ($('#eDel')) $('#eDel').onclick = async () => { config.ai = { provider: curProv }; await saveConfig(); closeModal(); mountThumbs(); };
  }

  // ---------- Paramètres ----------
  async function mountSettings() {
    const s = S();
    const info = await call(api.info).catch(() => ({}));
    main.innerHTML = `
      <div class="page-head"><div class="grow"><h1>Paramètres</h1><div class="sub">RoStats ${esc(info.version || '')}</div></div></div>
      <div class="card" style="max-width:760px">
        <div class="switch"><div class="s-text"><b>Compte Roblox</b><span>${me ? `Connecté en tant que ${esc(me.displayName)} (@${esc(me.name)}) — permet de voir tes jeux restreints` : 'Non connecté — nécessaire si Roblox masque un de tes jeux'}</span></div>
          ${me ? '<button class="btn" id="sLogout">Se déconnecter</button>' : '<button class="btn primary" id="sLogin">Se connecter</button>'}</div>
      </div>
      ${appearanceHTML()}
      <div class="card" style="max-width:760px">
        <div class="switch"><div class="s-text"><b>Fréquence d’actualisation</b><span>Joueurs, visites, favoris et notes</span></div>
          <select class="input" id="sInt" style="width:170px">${[1, 2, 5, 15, 30, 60].map((v) => `<option value="${v}" ${v === s.interval ? 'selected' : ''}>${v === 1 ? 'Chaque seconde' : v < 60 ? 'Toutes les ' + v + ' s' : 'Chaque minute'}</option>`).join('')}</select></div>
        <div class="switch"><div class="s-text"><b>Taux DevEx</b><span>Dollars reçus par Robux gagné · 1 $ = ${fmt(fx.rate, 4)} € ${fx.live ? '(BCE, ' + esc(fx.date || 'aujourd’hui') + ')' : '(estimation hors ligne)'}</span></div>
          <select class="input" id="sDevex" style="width:250px">${[[0.0038, 'Standard · 0,0038 $'], [0.0054, 'Joueurs US 18+ vérifiés · 0,0054 $'], [0.0035, 'Avant sept. 2025 · 0,0035 $']].map(([v, l]) => `<option value="${v}" ${v === s.devex ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${toggle('sSales', 'Notification à chaque vente', 'Une alerte Windows quand des Robux arrivent', s.notifySales)}
        ${toggle('sRec', 'Notification de record', 'Quand un jeu bat son record de joueurs connectés', s.notifyRecord)}
        ${toggle('sTray', 'Continuer en arrière-plan', 'Fermer la fenêtre la réduit près de l’horloge pour garder le suivi et les alertes', s.trayOnClose)}
      </div>
      <div class="card" style="max-width:760px">
        <div class="card-head"><h3>Données</h3></div>
        <p class="muted small" style="margin-top:0;line-height:1.6">L’historique est enregistré sur ton PC uniquement (30 jours). Le graphique se remplit tant que RoStats est ouvert ou en arrière-plan. Les euros sont une estimation : Robux dépensés × 70 % (ta part) × taux DevEx × taux de change. Roblox exige 30 000 Robux gagnés minimum pour encaisser.</p>
        <div class="actions"><button class="btn" id="sCopy">Copier le script Luau</button><button class="btn" id="sData">Ouvrir le dossier des données</button><button class="btn danger" id="sClear">Effacer l’historique</button><button class="btn" id="sQuit">Quitter RoStats</button></div>
      </div>`;
    bindAppearance();
    const upd = async (k, v) => { config.settings = { ...config.settings, [k]: v }; await saveConfig(); schedule(); };
    $('#sInt').onchange = (e) => upd('interval', Number(e.target.value));
    if ($('#sLogin')) $('#sLogin').onclick = doLogin;
    if ($('#sLogout')) $('#sLogout').onclick = doLogout;
    $('#sDevex').onchange = (e) => { upd('devex', Number(e.target.value)); };
    $('#sSales').onchange = (e) => upd('notifySales', e.target.checked);
    $('#sRec').onchange = (e) => upd('notifyRecord', e.target.checked);
    $('#sTray').onchange = (e) => upd('trayOnClose', e.target.checked);
    $('#sCopy').onclick = copyTracker;
    $('#sData').onclick = () => api.openData();
    $('#sQuit').onclick = () => { saveHistory(); api.quit(); };
    $('#sClear').onclick = () => { history = {}; records = {}; saveHistory(); toast('Historique effacé'); };
  }

  const toggle = (id, title, sub, on) => `<div class="switch"><div class="s-text"><b>${title}</b><span>${sub}</span></div>
    <label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label></div>`;

  // ---------- Export CSV ----------
  const csvLine = (a) => a.map((x) => (/[;"\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(';');
  async function exportGameCsv(uid) {
    const g = live[uid] || {};
    const rows = [['date', 'joueurs_en_ligne', 'visites', 'favoris']];
    for (const p of history[uid] || []) rows.push([new Date(p.t).toLocaleString('fr-FR'), p.p, p.v, p.f]);
    const r = revenue[uid];
    if (r?.days) {
      rows.push([], ['jour_utc', 'robux', 'ventes', 'entrees', 'sessions', 'temps_de_jeu_s']);
      for (const d of r.days) rows.push([d.day, d.robux, d.sales, d.joins, d.sessions, Math.round(d.playSeconds)]);
    }
    const path = await call(api.exportCsv, { filename: `RoStats_${(g.name || uid).replace(/[\\/:*?"<>|]/g, '')}.csv`, csv: rows.map(csvLine).join('\r\n') });
    if (path) toast('Exporté : ' + path);
  }
  async function exportOverviewCsv() {
    const rows = [['jeu', 'universe_id', 'en_ligne', 'visites', 'favoris', 'jaime', 'jaime_pas', 'robux_aujourdhui']];
    for (const c of config.games) {
      const g = live[c.universeId] || {}, r = revenue[c.universeId];
      rows.push([g.name, c.universeId, g.playing, g.visits, g.favorites, g.up, g.down, r?.days ? r.days[r.days.length - 1].robux : '']);
    }
    const path = await call(api.exportCsv, { filename: 'RoStats_jeux.csv', csv: rows.map(csvLine).join('\r\n') });
    if (path) toast('Exporté : ' + path);
  }

  // ---------- Modale ----------
  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    if ($('#modal').hidden) window.Sound?.play('open');
    $('#modal').hidden = false;
  }
  function closeModal() { if (!$('#modal').hidden) window.Sound?.play('close'); $('#modal').hidden = true; $('#modalBody').innerHTML = ''; $('.modal').classList.remove('wide'); window.onpointerup = null; }
  $('#modalClose').onclick = closeModal;
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });


  // ---------- Apparence (thèmes personnalisables) ----------
  const ACCENTS = [['Bleu', '#3b82ff'], ['Vert', '#22e06b'], ['Jaune', '#ffd60a'], ['Orange', '#ff8a1f'], ['Rouge', '#ff3b4e'], ['Rose', '#ff3fa4'], ['Violet', '#8b5cff'], ['Cyan', '#22d3ee'], ['Corail', '#ff6b5b']];
  const BACKGROUNDS = [
    ['aurora', 'Aurore', 'url(bg/aurora.jpg) center bottom / cover'],
    ['vague', 'Vague', 'url(bg/vague.webp) center / cover'],
    ['lumiere', 'Lumière', 'url(bg/lumiere.webp) center / cover'],
    ['neon', 'Néon', 'url(bg/neon.webp) center / cover'],
    ['noir', 'Noir pur', '#000'],
    ['custom', 'Ton image', ''],
  ];
  const BG_IDS = BACKGROUNDS.map((b) => b[0]);
  const PRESETS = [
    ['Aurore violette', { bg: 'aurora', accent: '#8b5cff', tint: true }],
    ['Vague', { bg: 'vague', accent: '#8b5cff', tint: false }],
    ['Lumière', { bg: 'lumiere', accent: '#a78bfa', tint: false }],
    ['Néon bleu', { bg: 'neon', accent: '#3b82ff', tint: true }],
    ['Rose bonbon', { bg: 'noir', accent: '#ff3fa4' }],
    ['Noir & vert', { bg: 'noir', accent: '#22e06b' }],
  ];
  const themeDefaults = { bg: 'aurora', accent: '#8b5cff', tint: true, radius: 18, glass: 55, blur: 22, density: 'std', anim: true, sound: true, vol: 50, trend: true, customOp: 60 };
  const T = () => { const t = { ...themeDefaults, ...(config?.theme || {}) }; if (!BG_IDS.includes(t.bg) || t.bg === 'custom') t.bg = 'aurora'; t.radius = 18; t.glass = 55; t.blur = 22; t.density = 'std'; t.vol = 50; return t; };
  let customBg = null;
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function hueOf(h) {
    const [r, g, b] = hexRgb(h).map((x) => x / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  }
  function applyTheme() {
    const t = T();
    const root = document.documentElement;
    root.dataset.bg = t.bg === 'custom' && !customBg ? 'aurora' : t.bg;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--acc', hexRgb(t.accent).join(', '));
    const native = { neon: 222, vague: 248, lumiere: 240 }[t.bg] || 262;
    root.style.setProperty('--hue', t.tint ? Math.round(hueOf(t.accent) - native) + 'deg' : '0deg');
    root.style.setProperty('--radius', t.radius + 'px');
    root.style.setProperty('--glass', (t.glass / 100).toFixed(2));
    root.style.setProperty('--blur', t.blur + 'px');
    root.style.setProperty('--custom-op', (t.customOp / 100).toFixed(2));
    if (customBg) root.style.setProperty('--custom-bg', `url("${customBg}")`);
    root.classList.toggle('dense', t.density === 'dense');
    root.classList.toggle('airy', t.density === 'airy');
    root.classList.toggle('no-anim', !t.anim);
    window.Sound?.set({ on: t.sound, vol: t.vol / 100 });
    window.ChartStyle = { trend: t.trend };
  }
  function setTheme(patch, redraw = false) {
    config.theme = { ...T(), ...patch };
    applyTheme();
    clearTimeout(setTheme._t);
    setTheme._t = setTimeout(saveConfig, 300);
    if (redraw) updateView();
  }

  function appearanceHTML() {
    const t = T();
    return `
      <div class="card" style="max-width:760px" id="apCard">
        <div class="card-head"><h3>Apparence</h3></div>
        <div class="field"><label>Thème</label><div class="ap-grid">${BACKGROUNDS.filter(([k]) => k !== 'custom').map(([k, l, bg]) => `<button class="bg-opt ${t.bg === k ? 'on' : ''}" data-bg="${k}" style="background:${bg}"><span>${l}</span></button>`).join('')}</div></div>
        <div class="field"><label>Couleur</label><div class="swatches">${ACCENTS.map(([n, c]) => `<button class="swatch ${c === t.accent ? 'on' : ''}" title="${n}" style="--c:${c}" data-c="${c}"></button>`).join('')}</div></div>
        ${toggle('apTrend', 'Courbes vert / rouge', 'Vert quand ça monte, rouge quand ça baisse', t.trend)}
        ${toggle('apAnim', 'Animations', 'Transitions et apparitions animées', t.anim)}
        ${toggle('apSound', 'Sons', 'Petits sons au clic et à chaque vente', t.sound)}
      </div>`;
  }
  function bindAppearance() {
    const card = $('#apCard'); if (!card) return;
    $$('.bg-opt', card).forEach((b) => (b.onclick = () => { setTheme({ bg: b.dataset.bg, tint: b.dataset.bg === 'aurora' || b.dataset.bg === 'neon' }); $$('.bg-opt', card).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('.swatch[data-c]', card).forEach((b) => (b.onclick = () => { setTheme({ accent: b.dataset.c }, true); $$('.swatch', card).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#apTrend').onchange = (e) => setTheme({ trend: e.target.checked }, true);
    $('#apAnim').onchange = (e) => setTheme({ anim: e.target.checked });
    $('#apSound').onchange = (e) => { setTheme({ sound: e.target.checked }); if (e.target.checked) window.Sound?.play('on'); };
  }

  // ---------- Écran de chargement ----------
  const boot = { t0: performance.now(), done: false };
  const bootMsgs = ['Connexion à Roblox…', 'Chargement de tes jeux…', 'Récupération des joueurs en ligne…', 'Calcul de tes revenus…'];
  boot.iv = setInterval(() => { const el = $('#bootSub'); if (el) el.textContent = bootMsgs[(boot.i = ((boot.i || 0) + 1) % bootMsgs.length)]; }, 1400);
  function bootDone() {
    if (boot.done) return;
    boot.done = true;
    const wait = Math.max(0, 1600 - (performance.now() - boot.t0));
    setTimeout(() => { clearInterval(boot.iv); $('#boot')?.classList.add('done'); window.Sound?.play('ready'); setTimeout(() => $('#boot')?.remove(), 800); }, wait);
  }
  setTimeout(bootDone, 15000); // sécurité : jamais bloqué sur l'écran de chargement

  // ---------- Démarrage ----------
  (async () => {
    config = (await call(api.get, 'config', null)) || { games: [], settings: {} };
    config.games = config.games || [];
    history = (await call(api.get, 'history', {})) || {};
    records = (await call(api.get, 'records', {})) || {};
    customBg = (await call(api.get, 'bgimage', null)) || null;
    applyTheme();
    config.ai = config.ai || { provider: 'free' };
    if (!config.ai.keyEnc && config.ai.provider !== 'free') config.ai = { provider: 'free' };
    if (!config.aiFree14) { if (config.ai.provider === 'gemini') config.ai = { provider: 'free' }; config.aiFree14 = true; saveConfig(); }
    me = await call(api.me).catch(() => null);
    renderAccount();
    renderSidebar();
    mountOverview();
    refreshFx().then(updateView);
    sales = (await call(api.get, 'sales', [])) || [];
    if (sales.length && me) salesLoaded = true;
    await refresh().catch(() => {});
    bootDone();
    refreshRevenue();
    schedule();
    if (me) setTimeout(() => refreshSales(!sales.length), 1500);
  })();
  window.addEventListener('beforeunload', saveHistory);
})();
