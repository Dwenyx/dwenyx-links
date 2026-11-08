// Moteur de graphiques canvas « néon » (aucune dépendance)
// Courbe : verte quand ça monte, rouge quand ça baisse, avec halo lumineux.
(function () {
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const tip = () => document.getElementById('tooltip');
  const UP = '#3dff7a', DOWN = '#ff4157';
  // window.ChartStyle.trend = false → couleur d'accent au lieu du vert/rouge
  const trendOn = () => window.ChartStyle?.trend !== false;
  const accent = () => css('--accent') || '#8b5cff';
  const animOn = () => !document.documentElement.classList.contains('no-anim');

  function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo, hi, ticks };
  }

  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace('.0', '') + ' Md';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.0', '') + ' M';
    if (a >= 1e4) return (n / 1e3).toFixed(0) + ' k';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + ' k';
    return String(Math.round(n * 100) / 100);
  };

  function timeLabel(t, spanMs) {
    const d = new Date(t);
    if (spanMs > 2 * 86400000) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function setup(container) {
    container.querySelectorAll('canvas').forEach((c) => c.remove());
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  function sizeCanvas(canvas, ctx, container) {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth, h = container.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  function showTip(x, y, html) {
    const el = tip();
    el.innerHTML = html;
    el.hidden = false;
    const r = el.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 10;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top < 8) top = y + 14;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  const hideTip = () => { tip().hidden = true; };

  function hexA(hex, a) {
    if (!hex || hex[0] !== '#') return hex;
    const m = hex.replace('#', '');
    const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Grille fine dans les deux sens, comme un écran de bourse
  function grid(ctx, pad, w, h, yTicks, Y, nx, yFormat) {
    ctx.font = '600 11px Figtree, "Segoe UI", system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of yTicks) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = css('--faint'); ctx.fillText((yFormat || compact)(v), pad.l - 10, y);
    }
    for (let i = 0; i <= nx; i++) {
      const x = Math.round(pad.l + ((w - pad.l - pad.r) * i) / nx) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    }
  }

  // Tracé lissé (courbes de Bézier passant par les milieux)
  // Courbe arrondie (interpolation cubique monotone : douce, sans dépasser les vraies valeurs)
  function monoTangents(P) {
    const n = P.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1].x - P[i].x || 1e-6; m[i] = (P[i + 1].y - P[i].y) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
      if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    return t;
  }
  function smoothPath(ctx, P) {
    const n = P.length;
    ctx.moveTo(P[0].x, P[0].y);
    if (n === 2) { ctx.lineTo(P[1].x, P[1].y); return; }
    const t = monoTangents(P);
    for (let i = 0; i < n - 1; i++) {
      const h = (P[i + 1].x - P[i].x) / 3;
      ctx.bezierCurveTo(P[i].x + h, P[i].y + t[i] * h, P[i + 1].x - h, P[i + 1].y - t[i + 1] * h, P[i + 1].x, P[i + 1].y);
    }
  }
  // Position exacte sur la courbe dessinée pour une abscisse donnée
  function curveAt(P, x) {
    if (x <= P[0].x) return P[0].y;
    if (x >= P[P.length - 1].x) return P[P.length - 1].y;
    if (P.length === 2) return P[0].y + (P[1].y - P[0].y) * (x - P[0].x) / (P[1].x - P[0].x || 1);
    const T = monoTangents(P);
    let i = 0; while (i < P.length - 2 && P[i + 1].x < x) i++;
    const h = P[i + 1].x - P[i].x || 1, u = (x - P[i].x) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return h00 * P[i].y + h10 * h * T[i] + h01 * P[i + 1].y + h11 * h * T[i + 1];
  }

  // Regroupe les points par tranches de temps en gardant le PIC (vraies valeurs, pas de moyenne inventée)
  function smoothPoints(pts, buckets) {
    if (pts.length <= buckets) return pts;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, step = (t1 - t0) / buckets || 1;
    const out = [];
    let i = 0;
    for (let k = 0; k < buckets; k++) {
      const end = t0 + step * (k + 1);
      let best = null;
      while (i < pts.length && (pts[i].t <= end || k === buckets - 1)) { if (!best || pts[i].v > best.v) best = pts[i]; i++; }
      if (best) out.push(best);
    }
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  // Dégradé horizontal vert/rouge selon la tendance locale, avec fondu doux
  function trendGradient(ctx, P, fallback) {
    const x0 = P[0].x, x1 = P[P.length - 1].x;
    if (!trendOn() || x1 - x0 < 2) return fallback;
    const n = P.length;
    // direction de chaque segment : +1 monte, -1 baisse
    const dir = [];
    let prev = 1;
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      const d = a.y - b.y;
      prev = Math.abs(d) < 0.4 ? prev : d > 0 ? 1 : -1;
      dir.push(prev);
    }
    // lissage pour un fondu progressif entre les couleurs
    const win = Math.max(1, Math.round(n / 40));
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    const step = Math.max(1, Math.floor(n / 180));
    const U = [61, 255, 122], D = [255, 65, 87];
    for (let i = 0; i < n; i += step) {
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { sum += dir[j]; c++; }
      let t = (sum / c + 1) / 2;            // 0 = rouge, 1 = vert
      t = t * t * (3 - 2 * t);
      const col = U.map((u, k) => Math.round(D[k] + (u - D[k]) * t));
      g.addColorStop(Math.min(1, Math.max(0, (P[i].x - x0) / (x1 - x0))), `rgb(${col.join(',')})`);
    }
    return g;
  }

  // ---------------- Courbe temporelle ----------------
  function line(container, opts) {
    const { canvas, ctx } = setup(container);
    let o = opts;
    let hoverX = null;
    let reveal = 1, revealing = false, hadData = false;
    const pad = { l: 52, r: 16, t: 14, b: 28 };
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');

    function geom(w, h) {
      const all = o.series.flatMap((s) => s.points);
      if (all.length < 2) return null;
      const tMin = o.tMin ?? Math.min(...all.map((p) => p.t));
      const tMax = o.tMax ?? Math.max(...all.map((p) => p.t));
      let vMin = Math.min(...all.map((p) => p.v));
      let vMax = Math.max(...all.map((p) => p.v));
      if (o.zero !== false) vMin = Math.min(0, vMin);
      if (o.zero === false && vMax - vMin < 8) { vMin -= 4; vMax += 4; }
      if (vMax === vMin) vMax = vMin + 1;
      const { lo, hi, ticks } = niceTicks(vMin, vMax + (vMax - vMin) * 0.1, 4);
      const X = (t) => pad.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (w - pad.l - pad.r);
      const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
      return { tMin, tMax, lo, hi, ticks, X, Y };
    }

    function startReveal() {
      if (!animOn()) return;
      reveal = 0; revealing = true;
      const t0 = performance.now();
      const step = (now) => {
        reveal = Math.min(1, (now - t0) / 1100);
        reveal = 1 - Math.pow(1 - reveal, 3);
        draw();
        if (reveal < 1) requestAnimationFrame(step); else revealing = false;
      };
      requestAnimationFrame(step);
    }

    function draw() {
      const { w, h, dpr } = sizeCanvas(canvas, ctx, container);
      ctx.clearRect(0, 0, w, h);
      const g = geom(w, h);
      let empty = container.querySelector('.empty-chart');
      if (!g) {
        if (!empty) { empty = document.createElement('div'); empty.className = 'empty-chart'; container.appendChild(empty); }
        empty.innerHTML = `<div><span class="spinner"></span><div style="margin-top:8px">${o.emptyText || 'Collecte des données en cours… la courbe se remplit au fil des actualisations.'}</div></div>`;
        return;
      }
      if (empty) empty.remove();
      if (!hadData) { hadData = true; startReveal(); }
      const span = g.tMax - g.tMin;
      const nx = Math.max(2, Math.floor((w - pad.l - pad.r) / 120));
      grid(ctx, pad, w, h, g.ticks, g.Y, nx, o.yFormat);
      // Axe X
      ctx.textBaseline = 'top'; ctx.fillStyle = css('--faint');
      for (let i = 0; i <= nx; i++) {
        const t = g.tMin + (span * i) / nx;
        ctx.textAlign = i === 0 ? 'left' : i === nx ? 'right' : 'center';
        ctx.fillText(timeLabel(t, span), g.X(t), h - pad.b + 9);
      }
      // Révélation de gauche à droite
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, pad.l + (w - pad.l) * reveal, h); ctx.clip();
      const single = o.series.length === 1;
      for (const s of o.series) {
        const pts = s.points;
        if (pts.length < 2) continue;
        const base = single ? accent() : s.color;
        // Courbe continue : les périodes sans données (appli fermée) sont reliées, plus de trous
        const segs = [smoothPoints(pts, Math.max(30, Math.min(80, Math.floor((container.clientWidth || 800) / 13))))];
        for (const seg of segs) {
          const P = seg.map((p) => ({ x: g.X(p.t), y: g.Y(p.v) }));
          s._P = P;
          if (P.length < 2) {
            ctx.beginPath(); ctx.arc(P[0].x, P[0].y, 2.5, 0, Math.PI * 2); ctx.fillStyle = base; ctx.fill();
            continue;
          }
          const stroke = single ? trendGradient(ctx, P, base) : base;
          // Remplissage : couleur de tendance qui s'efface vers le bas
          if (o.fill !== false) {
            off.width = canvas.width; off.height = canvas.height;
            octx.setTransform(dpr, 0, 0, dpr, 0, 0);
            octx.beginPath(); smoothPath(octx, P);
            octx.lineTo(P[P.length - 1].x, g.Y(g.lo)); octx.lineTo(P[0].x, g.Y(g.lo)); octx.closePath();
            octx.fillStyle = single ? trendGradient(octx, P, base) : base;
            octx.globalAlpha = 0.5; octx.fill(); octx.globalAlpha = 1;
            octx.globalCompositeOperation = 'destination-in';
            const top = Math.min(...P.map((p) => p.y));
            const v = octx.createLinearGradient(0, top, 0, h - pad.b);
            v.addColorStop(0, 'rgba(0,0,0,0.75)'); v.addColorStop(1, 'rgba(0,0,0,0)');
            octx.fillStyle = v; octx.fillRect(0, 0, w, h);
            octx.globalCompositeOperation = 'source-over';
            ctx.drawImage(off, 0, 0, w, h);
          }
          // Halo lumineux puis trait net
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.save();
          ctx.filter = 'blur(7px)'; ctx.globalAlpha = 0.9;
          ctx.beginPath(); smoothPath(ctx, P); ctx.strokeStyle = stroke; ctx.lineWidth = 6; ctx.stroke();
          ctx.restore();
          ctx.beginPath(); smoothPath(ctx, P); ctx.strokeStyle = stroke; ctx.lineWidth = 2.6; ctx.stroke();
          ctx.globalAlpha = 0.55;
          ctx.beginPath(); smoothPath(ctx, P); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8; ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // Dernier point lumineux
        if (reveal >= 1) {
          const last = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 6)];
          const c = single ? (trendOn() ? (last.v < prev.v ? DOWN : UP) : base) : base;
          const x = g.X(last.t), y = s._P ? curveAt(s._P, x) : g.Y(last.v);
          ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
          ctx.restore();
          ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        }
      }
      ctx.restore();
      // Survol
      if (hoverX != null && !revealing) {
        const t = g.tMin + ((hoverX - pad.l) / (w - pad.l - pad.r)) * span;
        const rows = [];
        let cx = null;
        for (const s of o.series) {
          if (!s.points.length) continue;
          let best = s.points[0];
          for (const p of s.points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
          // le point suit exactement la courbe dessinée, sous la souris
          const P = s._P;
          cx = P && P.length > 1 ? Math.min(Math.max(hoverX, P[0].x), P[P.length - 1].x) : g.X(best.t);
          const cy = P && P.length > 1 ? curveAt(P, cx) : g.Y(best.v);
          const c = single ? accent() : s.color;
          ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
          ctx.restore();
          ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
          rows.push({ s, p: best, c });
        }
        if (cx != null) {
          const vg = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
          vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); vg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = vg; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(cx + 0.5, pad.t); ctx.lineTo(cx + 0.5, h - pad.b); ctx.stroke();
          const r = container.getBoundingClientRect();
          const d = new Date(rows[0].p.t);
          showTip(r.left + cx, r.top + pad.t + 10,
            `<div class="tt-t">${d.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>` +
            rows.map(({ s, p, c }) => `<div class="tt-v"><span style="color:${c}">●</span> ${(o.tipFormat || ((v) => v.toLocaleString('fr-FR')))(p.v)} <span class="muted">${s.name || ''}</span></div>`).join(''));
        }
      }
    }

    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); hoverX = e.clientX - r.left; draw(); });
    canvas.addEventListener('pointerleave', () => { hoverX = null; hideTip(); draw(); });
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    draw();
    let lastSig = '';
    return {
      update(n) {
        // Optimisation : on ne redessine que si les données ont vraiment changé
        const sig = (n.series || []).map((x) => { const l = x.points[x.points.length - 1]; return x.points.length + ':' + (l ? l.t + ':' + l.v : ''); }).join('|') + '#' + Math.round((n.tMin || 0) / 20000) + '#' + trendOn() + accent();
        const was = o.series?.[0]?.points?.length; o = n;
        if (!was) hadData = false;
        if (sig === lastSig && hoverX == null) return;
        lastSig = sig;
        if (!revealing) draw();
      },
      destroy() { ro.disconnect(); hideTip(); },
    };
  }

  // ---------------- Barres néon ----------------
  // Vert si la barre est ≥ la précédente, rouge sinon.
  function bar(container, opts) {
    const { canvas, ctx } = setup(container);
    let o = opts;
    let hover = -1;
    let grow = 1, growing = false, lastKey = '';
    const pad = { l: 48, r: 12, t: 16, b: 28 };
    let rects = [];

    function animate() {
      if (!animOn()) { grow = 1; return; }
      grow = 0; growing = true;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 900);
        grow = 1 - Math.pow(1 - p, 3);
        draw();
        if (p < 1) requestAnimationFrame(step); else growing = false;
      };
      requestAnimationFrame(step);
    }

    function colorAt(i) {
      if (!trendOn()) return accent();
      const v = o.values;
      if (i === 0) return UP;
      return v[i] >= v[i - 1] ? UP : DOWN;
    }

    function draw() {
      const { w, h } = sizeCanvas(canvas, ctx, container);
      ctx.clearRect(0, 0, w, h);
      const vals = o.values;
      const { lo, hi, ticks } = niceTicks(0, Math.max(1, ...vals) * 1.1, 4);
      const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
      const n = vals.length || 1;
      grid(ctx, pad, w, h, ticks, Y, 0, o.yFormat);
      const slot = (w - pad.l - pad.r) / n;
      const bw = Math.min(40, slot * 0.56);
      rects = [];
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      // Ligne de tendance qui relie le haut des barres
      const tops = [];
      vals.forEach((v, i) => {
        const x = pad.l + slot * i + (slot - bw) / 2;
        const y0 = Y(0);
        const full = Math.max(v > 0 ? 3 : 0, y0 - Y(v));
        const hgt = full * grow;
        const c = colorAt(i);
        const on = i === hover;
        if (hgt > 0) {
          const gr = ctx.createLinearGradient(0, y0 - hgt, 0, y0);
          gr.addColorStop(0, hexA(c, on ? 1 : 0.9)); gr.addColorStop(1, hexA(c, on ? 0.35 : 0.12));
          ctx.save();
          ctx.shadowColor = c; ctx.shadowBlur = on ? 22 : 12;
          ctx.fillStyle = gr;
          roundRect(ctx, x, y0 - hgt, bw, hgt, Math.min(8, bw / 2));
          ctx.fill();
          ctx.restore();
          // reflet en haut de la barre
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          roundRect(ctx, x + 2, y0 - hgt + 1, bw - 4, Math.min(2, hgt), 1); ctx.fill();
          tops.push({ x: x + bw / 2, y: y0 - hgt });
        }
        rects.push({ x, w: bw, i });
        ctx.fillStyle = on ? css('--text') : css('--faint');
        ctx.font = `${on ? 700 : 600} 11px Figtree, "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(o.labels[i] ?? '', x + bw / 2, h - pad.b + 9);
      });
      if (tops.length > 2 && o.trendLine !== false) {
        ctx.save(); ctx.globalAlpha = 0.45 * grow; ctx.setLineDash([2, 4]);
        ctx.beginPath(); smoothPath(ctx, tops); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
    }
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const hit = rects.find((rc) => x >= rc.x - 6 && x <= rc.x + rc.w + 6);
      const nh = hit ? hit.i : -1;
      if (nh !== hover) { hover = nh; if (hit) window.Sound?.play('tick'); }
      draw();
      if (hit) showTip(e.clientX, e.clientY, `<div class="tt-t">${o.tipLabels ? o.tipLabels[hit.i] : o.labels[hit.i]}</div><div class="tt-v">${(o.tipFormat || ((v) => v.toLocaleString('fr-FR')))(o.values[hit.i], hit.i)}</div>`);
      else hideTip();
    });
    canvas.addEventListener('pointerleave', () => { hover = -1; hideTip(); draw(); });
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    draw();
    return {
      update(n) {
        const sig = (n.values || []).join(',') + '#' + (n.labels || []).join(',') + '#' + trendOn() + accent();
        if (sig === this._sig && !growing) { o = n; return; }
        this._sig = sig;
        o = n;
        const key = (n.labels || []).join('|') + '#' + (n.values || []).some((v) => v > 0);
        if (key !== lastKey) { lastKey = key; if (n.values?.some((v) => v > 0)) { animate(); return; } }
        if (!growing) draw();
      },
      destroy() { ro.disconnect(); hideTip(); },
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  window.Charts = { line, bar, compact };
})();
