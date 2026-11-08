// RoStats Android — couche système (remplace Electron)
// Réseau via le pont natif (pas de restriction CORS), fichiers privés, cookies Roblox.
(function () {
  const N = window.RoNative;
  const pending = new Map();
  let seq = 0;
  window.__rn = (id, payload) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p(payload);
  };
  const nativeCall = (fn, ...args) => new Promise((resolve) => {
    const id = 'c' + (++seq) + '_' + Date.now();
    pending.set(id, resolve);
    N[fn](id, ...args);
  });

  // ---- base64 ----
  const b64ToBytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const bytesToB64 = (u8) => { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  const utf8 = (str) => new TextEncoder().encode(str);

  // Buffer minimal (utilisé par le moteur partagé avec la version PC)
  const withToString = (u) => { u.toString = (enc) => (enc === 'base64' ? bytesToB64(u) : new TextDecoder().decode(u)); return u; };
  window.Buffer = {
    from(x, enc) {
      if (typeof x === 'string') return withToString(enc === 'base64' ? b64ToBytes(x) : utf8(x));
      if (x instanceof ArrayBuffer) return withToString(new Uint8Array(x));
      return withToString(new Uint8Array(x));
    },
  };

  async function encodeBody(body, headers) {
    if (body == null) return '';
    if (typeof body === 'string') return bytesToB64(utf8(body));
    if (body instanceof FormData) {
      const boundary = '----RoStats' + Math.random().toString(16).slice(2);
      const parts = [];
      for (const [name, value] of body.entries()) {
        if (value instanceof Blob) {
          const fname = value.name || 'file';
          parts.push(utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fname}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`));
          parts.push(new Uint8Array(await value.arrayBuffer()));
          parts.push(utf8('\r\n'));
        } else {
          parts.push(utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        }
      }
      parts.push(utf8(`--${boundary}--\r\n`));
      const len = parts.reduce((a, p) => a + p.length, 0);
      const all = new Uint8Array(len);
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
      return bytesToB64(all);
    }
    if (body instanceof Blob) return bytesToB64(new Uint8Array(await body.arrayBuffer()));
    if (body instanceof Uint8Array) return bytesToB64(body);
    return bytesToB64(utf8(String(body)));
  }

  // fetch natif : même interface que fetch() pour le moteur partagé
  window.nativeFetch = async function (url, opts = {}) {
    const headers = {};
    const src = opts.headers || {};
    for (const k of Object.keys(src)) headers[k] = String(src[k]);
    const bodyB64 = await encodeBody(opts.body, headers);
    const res = await nativeCall('request', JSON.stringify({ url: String(url), method: opts.method || 'GET', headers, bodyB64, timeout: opts.timeoutMs || 240000 }));
    if (res.error) throw new Error(res.error);
    const bytes = b64ToBytes(res.bodyB64 || '');
    const h = res.headers || {};
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })), cancel: () => {} }; } },
    };
  };

  // Cookies Roblox (session de la page de connexion)
  window.robloxCookie = () => {
    const all = N.getCookie('https://www.roblox.com') || '';
    const m = all.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/);
    return m ? m[1] : null;
  };

  // Fichiers privés
  window.mobileFS = {
    read: (name) => N.readFile(name),
    write: (name, data) => N.writeFile(name, data),
    remove: (name) => N.deleteFile(name),
    list: (dir) => { try { return JSON.parse(N.listFiles(dir)); } catch { return []; } },
  };
  window.mobileNative = { call: nativeCall, N };
  document.documentElement.classList.add('android');
})();
