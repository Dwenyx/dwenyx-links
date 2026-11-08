// Petits sons d'interface, synthétisés en direct (aucun fichier audio).
// Doux, courts et discrets. Réglables dans Paramètres → Apparence.
(function () {
  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.5;
  let last = {};

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume * 0.35;
      // léger filtre pour adoucir les aigus
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7000;
      master.connect(lp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // note : fréquence, départ, durée, type d'onde, volume, glissando
  function tone(f, t0, dur, type = 'sine', vol = 1, f2 = null) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + t0;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(t0, dur, vol = 0.3, from = 900, to = 3000) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + t0;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    // clic de bouton : petite goutte
    tap() { tone(1250, 0, 0.06, 'sine', 0.35, 720); },
    // navigation / changement d'onglet : bulle douce
    nav() { tone(520, 0, 0.09, 'sine', 0.32, 880); tone(1320, 0.015, 0.05, 'sine', 0.08); },
    // interrupteur
    on() { tone(660, 0, 0.07, 'triangle', 0.28); tone(990, 0.05, 0.09, 'triangle', 0.26); },
    off() { tone(780, 0, 0.07, 'triangle', 0.24); tone(520, 0.05, 0.09, 'triangle', 0.22); },
    // ouverture de fenêtre : souffle
    open() { noise(0, 0.16, 0.16, 600, 2600); tone(880, 0.02, 0.12, 'sine', 0.12, 1180); },
    close() { noise(0, 0.12, 0.12, 2400, 700); },
    // jeu ajouté / action réussie : petit arpège montant
    success() { [784, 988, 1319].forEach((f, i) => tone(f, i * 0.07, 0.22, 'triangle', 0.26)); tone(2637, 0.21, 0.25, 'sine', 0.06); },
    // nouvelle vente : « cling » de pièce
    coin() { tone(1568, 0, 0.12, 'square', 0.07); tone(2093, 0.07, 0.45, 'sine', 0.3); tone(4186, 0.07, 0.3, 'sine', 0.05); },
    // record de joueurs
    record() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.3, 'triangle', 0.24)); },
    // erreur : deux notes qui descendent
    error() { tone(330, 0, 0.12, 'triangle', 0.3); tone(247, 0.1, 0.18, 'triangle', 0.3); },
    // prêt (fin du chargement)
    ready() { tone(660, 0, 0.18, 'sine', 0.22, 990); tone(1320, 0.12, 0.35, 'sine', 0.12); },
    // survol d'une barre : tic très discret
    tick() { tone(2300, 0, 0.018, 'sine', 0.05); },
    // couleur choisie
    pick() { tone(1046, 0, 0.08, 'sine', 0.25); tone(1568, 0.04, 0.12, 'sine', 0.15); },
  };

  // Tes effets sonores (fichiers dans sfx/) : son → [fichier, volume]
  const SAMPLES = {
    tap: ['tap', 0.35], pick: ['tap', 0.4], on: ['tap', 0.4], off: ['tap', 0.3],
    nav: ['menu', 0.45], open: ['menu', 0.55],
    success: ['coin', 0.6], coin: ['coin', 0.75],
    ready: ['chime', 0.7], record: ['chime', 0.85],
  };
  const cache = {};
  function sample(file) {
    if (!cache[file]) { const a = new Audio(`sfx/${file}.mp3`); a.preload = 'auto'; cache[file] = a; }
    return cache[file];
  }
  Object.values(SAMPLES).forEach(([f]) => sample(f)); // préchargement

  function play(name) {
    if (!enabled) return;
    const now = performance.now();
    if (last[name] && now - last[name] < 45) return; // évite les doublons
    last[name] = now;
    const smp = SAMPLES[name];
    if (smp) {
      try {
        const a = sample(smp[0]).cloneNode();
        a.volume = Math.min(1, smp[1] * volume * 2);
        a.play().catch(() => {});
        return;
      } catch {}
    }
    if (SOUNDS[name]) try { SOUNDS[name](); } catch {}
  }

  // Sons automatiques sur les clics de l'interface
  document.addEventListener('pointerdown', () => ac(), { once: true, capture: true });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .game-item, .grp-head, tr.click, .bg-opt, a');
    if (!el || el.disabled || el.dataset.silent != null) return;
    if (el.classList.contains('swatch')) return play('pick');
    if (el.matches('.nav-item, .game-item, .grp-head, tr.click, .seg button, .tabs button')) return play('nav');
    play('tap');
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target.matches('.toggle input')) play(e.target.checked ? 'on' : 'off');
  }, true);

  window.Sound = {
    play,
    set({ on, vol } = {}) {
      if (on != null) enabled = !!on;
      if (vol != null) { volume = Math.max(0, Math.min(1, vol)); if (master) master.gain.value = volume * 0.35; }
    },
  };
})();
