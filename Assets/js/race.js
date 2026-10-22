// Chicane race renderer: an isometric 2.5D view of the track model (PixiJS 8 + GSAP 3).
// The model (track.js) is top-down; everything here projects it iso: X = (x - y)·cos30, Y = (x + y)·sin30 - z.
// Road, verge, shadow, kerbs, gravel, skid marks and stands are single meshes, rebuilt only when the display
// path changes (mount, transition frames). Trees and roadside props are ParticleContainers chunked by screen
// area so offscreen chunks are culled; the crowd is one dynamic ParticleContainer.
// Classic script: defines window.ChicaneRace and, unless live.js has defined window.ChicaneLive, boots the
// page once from the chicane-config JSON.
(function () {
  'use strict';
  var P = window.PIXI, G = window.gsap, C = window.Chicane;

  G.ticker.lagSmoothing(0); // tweens finish on time even if a frame hitches
  try { if (P.Assets && P.Assets.setPreferences) P.Assets.setPreferences({ preferWorkers: false }); } catch (e) { /* no workers under CSP */ }
  // The IIFE unsafe-eval shim patches its own bundled copy of ParticleBuffer, not PIXI.ParticleBuffer, so
  // ParticleContainer would still hit `new Function` under CSP. Point the real class at the polyfill.
  if (P.ParticleBuffer && P.generateParticleUpdatePolyfill) P.ParticleBuffer.prototype.generateParticleUpdate = P.generateParticleUpdatePolyfill;
  if (P.CullerPlugin) P.extensions.add(P.CullerPlugin); // skips `cullable` objects outside the screen

  var CO = Math.cos(Math.PI / 6), SI = 0.5, RH = 5, VREP = 48, CURB_TH = 0.0045;
  var DECIMATE = 2;  // display path keeps every 2nd model point (8 px)
  var CHUNK = 1600;  // screen-space cell for culled tree/prop chunks
  var CAR_COLORS = [0xff4d4d, 0x2f81f7, 0xf9c513, 0x3fb950, 0xdb61a2, 0xff8c42, 0xa371f7, 0x56d4dd];
  var CROWD = [0xff6b6b, 0xffd166, 0x4dabf7, 0x63e6be, 0xf783ac, 0xffffff, 0xb197fc, 0xffa94d, 0x8ce99a, 0x74c0fc];
  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  var HZ = {
    pothole: { col: 0xd0d7de, label: 'Pothole · closed early' },
    debris: { col: 0xff8c1a, label: 'Debris · stalled 3+ days' },
    wreck: { col: 0xff4d4d, label: 'Wreck · abandoned' },
    slick: { col: 0xb392f0, label: 'Oil slick · reopened' }
  };

  var S = null;         // renderer state of the mounted view
  var mapOnly = false;  // survives mount/destroy so setMapOnly can be called first

  function IX(x, y) { return (x - y) * CO; }
  function IY(x, y, z) { return (x + y) * SI - (z || 0); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shade(c, f) {
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    if (f <= 1) { r *= f; g *= f; b *= f; } else { var k = f - 1; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    return (clamp(r | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(b | 0, 0, 255);
  }
  function mix(c1, c2, t) {
    return (Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t)) << 16) | (Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t)) << 8) | Math.round(lerp(c1 & 255, c2 & 255, t));
  }
  function carColor(d) { return CAR_COLORS[d.color % CAR_COLORS.length]; }

  // Every tween goes through here so destroy() can kill the lot, including delayed and repeating ones.
  function tw(target, vars) { var t = G.to(target, vars); S.tweens.push(t); return t; }
  function twFromTo(target, from, to) { var t = G.fromTo(target, from, to); S.tweens.push(t); return t; }
  function pruneTweens() { S.tweens = S.tweens.filter(function (t) { return t.totalProgress() < 1; }); }

  // ---------- procedural textures (original art) ----------
  function canvasTex(w, h, draw, style) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    var opts = { resource: c, autoGenerateMipmaps: true, magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 };
    for (var k in style || {}) opts[k] = style[k];
    var src = new P.CanvasSource(opts); S.sources.push(src);
    return new P.Texture({ source: src });
  }

  // Road atlas: left half PAVED (dark tarmac, rubbered-in racing lines, crisp paint), right half RAW
  // (compacted gravel, ruts, no paint, orange survey ticks: the road still to build).
  function roadTexture(nLanes, roadW, laneW) {
    var HW = 256, H = 128, PAD = 6, inner = HW - PAD * 2;
    return canvasTex(HW * 2, H, function (ctx) {
      [0, 1].forEach(function (half) {
        var x0 = half * HW, paved = half === 0, r = rng(half + 7), i, j, k;
        function U(d) { return x0 + PAD + (d / roadW) * inner; } // d in world units from the left edge
        function W(d) { return (d / roadW) * inner; }
        if (paved) {
          ctx.fillStyle = '#23262c'; ctx.fillRect(x0, 0, HW, H);
          for (i = 0; i < 1600; i++) { var l = 28 + r() * 34; ctx.fillStyle = 'rgba(' + l + ',' + l + ',' + (l + 5) + ',' + (0.3 + r() * 0.4) + ')'; ctx.fillRect(x0 + r() * HW, r() * H, 1.1, 1.1); }
          for (k = 0; k < nLanes; k++) { // racing line down each lane
            var cx = U(6 + laneW * (k + 0.5)), gr = ctx.createLinearGradient(cx - 16, 0, cx + 16, 0);
            gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gr; ctx.fillRect(cx - 16, 0, 32, H);
          }
          ctx.fillStyle = '#2c3037'; ctx.fillRect(x0, 0, U(5) - x0, H); ctx.fillRect(U(roadW - 5), 0, x0 + HW - U(roadW - 5), H);
          ctx.fillStyle = '#ffffff'; ctx.fillRect(U(3.5), 0, W(3), H); ctx.fillRect(U(roadW - 6.5), 0, W(3), H);
          ctx.fillStyle = '#f5f7fa'; for (j = 1; j < nLanes; j++) ctx.fillRect(U(6 + j * laneW - 0.9), 0, W(1.8), H * 0.5);
          ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x0, 0, HW, 2);
        } else {
          ctx.fillStyle = '#9c917d'; ctx.fillRect(x0, 0, HW, H);
          for (i = 0; i < 2600; i++) { var t = r(), sz = 0.8 + r() * 2.2; ctx.fillStyle = t < 0.45 ? 'rgba(110,100,85,0.55)' : t < 0.8 ? 'rgba(190,182,165,0.6)' : 'rgba(70,64,56,0.5)'; ctx.fillRect(x0 + r() * HW, r() * H, sz, sz); }
          for (k = 0; k < nLanes; k++) { var rx = U(6 + laneW * (k + 0.5)); ctx.fillStyle = 'rgba(80,70,58,0.12)'; ctx.fillRect(rx - W(7), 0, W(3), H); ctx.fillRect(rx + W(4), 0, W(3), H); }
          for (var y = 0; y < H; y += 3) { // ragged, unpainted shoulders
            var a = W(3 + r() * 4), b = W(3 + r() * 4); ctx.fillStyle = 'rgba(96,82,60,0.75)'; ctx.fillRect(x0, y, PAD + a, 3); ctx.fillRect(x0 + HW - PAD - b, y, PAD + b, 3);
          }
          ctx.fillStyle = '#ff7a1a';
          for (j = 1; j < nLanes; j++) { ctx.fillRect(U(6 + j * laneW - 0.8), 10, W(1.6), 10); ctx.fillRect(U(6 + j * laneW - 4), 14, W(8), 2); }
          ctx.fillRect(U(5), 70, W(1.5), 8); ctx.fillRect(U(roadW - 6.5), 70, W(1.5), 8);
        }
      });
    }, { addressModeU: 'clamp-to-edge', addressModeV: 'repeat' });
  }
  function skidTexture() {
    return canvasTex(32, 128, function (ctx) {
      var r = rng(19);
      for (var i = 0; i < 14; i++) {
        var x = 2 + r() * 28, y = r() * 128, L = 30 + r() * 90, w = 1.5 + r() * 2.5;
        for (var k = 0; k < 2; k++) {
          var yy = (y + k * 128) - 128, g = ctx.createLinearGradient(0, yy, 0, yy + L);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(5,5,6,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x, yy, w, L); ctx.fillRect(x, yy + 128, w, L);
        }
      }
    }, { addressModeU: 'clamp-to-edge', addressModeV: 'repeat' });
  }
  function curbTexture() {
    return canvasTex(16, 64, function (ctx) {
      ctx.fillStyle = '#e5322d'; ctx.fillRect(0, 0, 16, 32); ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 32, 16, 32);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(13, 0, 3, 64);
    }, { addressModeU: 'clamp-to-edge', addressModeV: 'repeat' });
  }
  function gravelTexture() {
    return canvasTex(64, 64, function (ctx) {
      var r = rng(3); ctx.fillStyle = '#d8c48e'; ctx.fillRect(0, 0, 64, 64);
      for (var i = 0; i < 500; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(150,125,80,0.5)' : 'rgba(255,245,215,0.6)'; ctx.fillRect(r() * 64, r() * 64, 1.5, 1.5); }
    }, { addressMode: 'repeat' });
  }
  function glowTexture() {
    return canvasTex(64, 64, function (ctx) {
      var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    });
  }
  function tierTexture() {
    return canvasTex(32, 8, function (ctx) {
      ctx.fillStyle = '#a3acb6'; ctx.fillRect(0, 0, 32, 8); ctx.fillStyle = '#c9d1d9'; ctx.fillRect(0, 0, 4, 8);
      ctx.fillStyle = '#5f6872'; ctx.fillRect(24, 0, 8, 8);
    }, { addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  }
  function vignetteTexture() {
    return canvasTex(256, 256, function (ctx) {
      var g = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
      g.addColorStop(0, 'rgba(5,10,8,0)'); g.addColorStop(1, 'rgba(5,10,8,0.55)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    });
  }
  // Sprite atlas shared by every particle: trees, bush, rock, person, cone, stake, sponsor boards.
  var FRAMES = { oak: [0, 0, 44, 60], pine: [48, 0, 34, 66], birch: [86, 0, 40, 58], bush: [130, 30, 30, 22], rock: [130, 4, 24, 18], person: [164, 0, 12, 22],
    cone: [180, 0, 12, 16], stake: [194, 0, 10, 22], banner0: [206, 0, 46, 22], banner1: [206, 24, 46, 22], banner2: [206, 48, 46, 22] };
  function atlasTexture() {
    var tex = canvasTex(256, 72, function (ctx) {
      function shadow(cx, by, rx) { ctx.fillStyle = 'rgba(10,25,10,0.32)'; ctx.beginPath(); ctx.ellipse(cx, by - 4, rx, rx * 0.45, 0, 0, Math.PI * 2); ctx.fill(); }
      function blob(x, y, r, c1, c2) { var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      shadow(22, 60, 15); ctx.fillStyle = '#5b3a22'; ctx.fillRect(19, 36, 6, 21); // oak
      blob(14, 32, 11, '#7fcf5a', '#2f6b2a'); blob(30, 32, 11, '#7fcf5a', '#2f6b2a'); blob(22, 20, 14, '#94dd6a', '#367a2f');
      shadow(65, 66, 12); ctx.fillStyle = '#4a2f1c'; ctx.fillRect(62, 52, 5, 12); // pine
      [[16, 54, 26], [13, 40, 18], [10, 26, 10]].forEach(function (t) {
        var g = ctx.createLinearGradient(65 - t[0], 0, 65 + t[0], 0); g.addColorStop(0, '#4fa863'); g.addColorStop(1, '#1d4f33');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(65, t[1] - t[2]); ctx.lineTo(65 + t[0], t[1]); ctx.lineTo(65 - t[0], t[1]); ctx.closePath(); ctx.fill();
      });
      shadow(106, 58, 13); ctx.fillStyle = '#e9e4d8'; ctx.fillRect(104, 34, 4, 22); // birch
      blob(100, 30, 10, '#ffd36b', '#c0711f'); blob(112, 28, 10, '#ffcf5c', '#b5651d'); blob(106, 18, 11, '#ffe08a', '#c97a24');
      shadow(145, 52, 12); blob(139, 44, 7, '#8fdc6c', '#2f6b2a'); blob(150, 44, 7, '#8fdc6c', '#2f6b2a'); blob(145, 39, 8, '#a2e57c', '#3a7d31'); // bush
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(142, 19, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill(); // rock
      var rg = ctx.createLinearGradient(132, 6, 152, 20); rg.addColorStop(0, '#d0d4d8'); rg.addColorStop(1, '#6d737a'); ctx.fillStyle = rg;
      ctx.beginPath(); ctx.moveTo(133, 18); ctx.lineTo(136, 9); ctx.lineTo(144, 6); ctx.lineTo(151, 11); ctx.lineTo(152, 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(165, 9, 10, 12, 3); ctx.fill(); // person (white, tinted per spectator)
      ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(170, 5, 3.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(186, 14, 5.5, 2, 0, 0, Math.PI * 2); ctx.fill(); // cone
      ctx.fillStyle = '#ff6a13'; ctx.beginPath(); ctx.moveTo(186, 1); ctx.lineTo(190.5, 13); ctx.lineTo(181.5, 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(183.5, 7, 5, 2); ctx.fillStyle = '#e8590c'; ctx.fillRect(181, 12.5, 10, 2);
      ctx.fillStyle = '#c8a26a'; ctx.fillRect(198, 4, 2.2, 17); ctx.fillStyle = '#ff4fa3'; // survey stake with ribbon
      ctx.beginPath(); ctx.moveTo(200, 4); ctx.lineTo(204, 6); ctx.lineTo(200, 9); ctx.closePath(); ctx.fill();
      [['#e5322d', '#ffd166'], ['#2f81f7', '#ffffff'], ['#111111', '#3fb950']].forEach(function (c, b) { // sponsor boards
        var y0 = b * 24; ctx.fillStyle = '#5a6068'; ctx.fillRect(208, y0 + 14, 2, 8); ctx.fillRect(248, y0 + 14, 2, 8);
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.roundRect(206, y0 + 2, 46, 14, 2); ctx.fill();
        ctx.fillStyle = c[1]; for (var q = 0; q < 4; q++) ctx.fillRect(211 + q * 9.5, y0 + 6, 6.5, 2 + (q % 2) * 2.5);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(206, y0 + 2, 46, 2);
      });
    }, { addressMode: 'clamp-to-edge' });
    var out = {};
    Object.keys(FRAMES).forEach(function (k) { var f = FRAMES[k]; out[k] = new P.Texture({ source: tex.source, frame: new P.Rectangle(f[0], f[1], f[2], f[3]) }); });
    return out;
  }

  // ---------- meshes: geometry replaced only when the vertex count changes, else buffers update in place ----------
  var idxCache = {};
  function stripIndices(n, stride, pairs) {
    var key = n + ':' + stride + ':' + pairs; if (idxCache[key]) return idxCache[key];
    var idx = new Uint32Array(Math.max(0, n - 1) * 6 * pairs), k = 0;
    for (var p = 0; p < pairs; p++) for (var i = 0; i < n - 1; i++) {
      var a = i * stride + p * 2, b = a + 1, c = a + stride, d = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
    return (idxCache[key] = idx);
  }
  function makeMesh(tex, tint, alpha) {
    var m = new P.Mesh({ geometry: new P.MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) }), texture: tex });
    m.tint = tint == null ? 0xffffff : tint; m.alpha = alpha == null ? 1 : alpha; return m;
  }
  function setGeo(mesh, pos, uv, idx) {
    var g = mesh.geometry;
    if (g.__n !== pos.length || g.__i !== idx) {
      var ng = new P.MeshGeometry({ positions: pos, uvs: uv, indices: idx }); ng.__n = pos.length; ng.__i = idx; mesh.geometry = ng; g.destroy();
    } else {
      var b = g.getBuffer('aPosition'); b.data = pos; b.update(); var u = g.getBuffer('aUV'); u.data = uv; u.update();
    }
  }

  // ---------- display path ----------
  // s, heading and curvature from positions (a morphed path is not evenly spaced).
  function finishPath(path) {
    var o = path.points, n = o.length, i;
    o[0].s = 0;
    for (i = 1; i < n; i++) o[i].s = o[i - 1].s + Math.hypot(o[i].x - o[i - 1].x, o[i].y - o[i - 1].y);
    for (i = 0; i < n; i++) { var pa = o[i > 0 ? i - 1 : 0], pb = o[i < n - 1 ? i + 1 : n - 1]; o[i].heading = n > 1 ? Math.atan2(pb.y - pa.y, pb.x - pa.x) : 0; }
    for (i = 0; i < n; i++) { var a = i > 1 ? i - 2 : 0, b = i < n - 2 ? i + 2 : n - 1; o[i].curv = wrapA(o[b].heading - o[a].heading) / ((o[b].s - o[a].s) || 1); }
    path.length = o[n - 1].s; path.step = n > 1 ? path.length / (n - 1) : 4;
    return path;
  }
  // Every DECIMATE-th point by index (two paths from one morph stay point-aligned), smoothed over ±3 points
  // so the ribbon edges stay clean at every zoom. Always builds new points: model paths are immutable.
  function displayPath(path) {
    var src = path.points, idx = [], i;
    for (i = 0; i < src.length; i += DECIMATE) idx.push(i);
    if (idx[idx.length - 1] !== src.length - 1) idx.push(src.length - 1);
    var n = idx.length, cx = new Float64Array(n + 1), cy = new Float64Array(n + 1), out = new Array(n), R = 3;
    for (i = 0; i < n; i++) { cx[i + 1] = cx[i] + src[idx[i]].x; cy[i + 1] = cy[i] + src[idx[i]].y; }
    for (i = 0; i < n; i++) {
      var r = Math.min(R, i, n - 1 - i), a = i - r, b = i + r + 1, p = src[idx[i]];
      out[i] = { x: (cx[b] - cx[a]) / (b - a), y: (cy[b] - cy[a]) / (b - a), kind: p.kind, seg: p.seg, done: p.done };
    }
    return finishPath({ points: out });
  }
  // Paving sweep: in each run of points whose done flips, the flip travels along the run like a paving
  // machine (forward when paving, backward when the road is torn up) instead of switching all at once.
  function paveThresholds(A, B) {
    var n = A.points.length, th = new Float32Array(n).fill(-1), i = 0;
    while (i < n) {
      if (!!A.points[i].done === !!B.points[i].done) { i++; continue; }
      var j = i; while (j < n && !!A.points[j].done !== !!B.points[j].done) j++;
      var fwd = !!B.points[i].done, len = j - i;
      for (var k = i; k < j; k++) { var f = len > 1 ? (k - i) / (len - 1) : 0.5; th[k] = 0.15 + 0.7 * (fwd ? f : 1 - f); }
      i = j;
    }
    return th;
  }
  function lerpPath(A, B, t, th, out) {
    var pa = A.points, pb = B.points, o = out.points, src = t < 0.5 ? pa : pb;
    for (var i = 0; i < pa.length; i++) {
      var q = o[i]; q.x = lerp(pa[i].x, pb[i].x, t); q.y = lerp(pa[i].y, pb[i].y, t); q.kind = src[i].kind; q.seg = src[i].seg;
      q.done = th[i] >= 0 ? (t > th[i] ? pb[i].done : pa[i].done) : src[i].done;
    }
    return finishPath(out);
  }
  function derive(path) { // flat arrays of the display path for the mesh builders
    var pts = path.points, n = pts.length, D = S.D && S.D.n === n ? S.D : { n: n, x: new Float32Array(n), y: new Float32Array(n), nx: new Float32Array(n), ny: new Float32Array(n), s: new Float32Array(n), curv: new Float32Array(n), turn: new Uint8Array(n), done: new Uint8Array(n) };
    for (var i = 0; i < n; i++) {
      var p = pts[i]; D.x[i] = p.x; D.y[i] = p.y; D.nx[i] = -Math.sin(p.heading); D.ny[i] = Math.cos(p.heading);
      D.s[i] = p.s; D.curv[i] = p.curv; D.turn[i] = p.kind === 'turn' ? 1 : 0; D.done[i] = p.done ? 1 : 0;
    }
    return D;
  }
  function place(s, d, z) { // display-path point at s, offset d across the road → iso + world coords
    var pt = C.sample(S.path, clamp(s, 0, S.path.length)), wx = pt.x - Math.sin(pt.heading) * d, wy = pt.y + Math.cos(pt.heading) * d;
    return { x: IX(wx, wy), y: IY(wx, wy, z), wx: wx, wy: wy, heading: pt.heading, curv: pt.curv };
  }
  function frameAt(s) { var pt = C.sample(S.path, clamp(s, 0, S.path.length)); return { x: pt.x, y: pt.y, f: [Math.cos(pt.heading), Math.sin(pt.heading)], r: [-Math.sin(pt.heading), Math.cos(pt.heading)] }; }
  function laneOffset(lane) { var l = S.lanes[lane] || S.lanes[0]; return l ? l.offset : 0; }

  // ---------- road ----------
  // Kerb/gravel masks; +1 side = +normal, the inside of a turn is the side of sign(curv).
  function edgeMask(D, sign, paved) {
    var n = D.n, raw = new Float32Array(n), out = new Float32Array(n), R = 3, i;
    for (i = 0; i < n; i++) raw[i] = (D.turn[i] && D.curv[i] * sign > CURB_TH && (!paved || D.done[i])) ? 1 : 0;
    for (i = 0; i < n; i++) { var a = 0, c = 0; for (var k = -R; k <= R; k++) { var j = i + k; if (j >= 0 && j < n) { a += raw[j]; c++; } } out[i] = a / c; }
    return out;
  }
  function buildRoad() {
    var D = S.D, n = D.n, hw = S.roadW / 2, names = ['verge', 'gravel', 'shadow', 'side', 'top', 'skid', 'curb'];
    names.forEach(function (k) { S.m[k].visible = n > 1; });
    if (n < 2) return;
    var top = new Float32Array(n * 4), topUV = new Float32Array(n * 4), side = new Float32Array(n * 4), shad = new Float32Array(n * 4), verge = new Float32Array(n * 4), zero = new Float32Array(n * 4);
    var curb = new Float32Array(n * 8), curbUV = new Float32Array(n * 8), grav = new Float32Array(n * 8), gravUV = new Float32Array(n * 8);
    var skid = new Float32Array(n * 4), skidUV = new Float32Array(n * 4), skM = new Float32Array(n);
    var inR = edgeMask(D, 1, true), inL = edgeMask(D, -1, true), gR = edgeMask(D, 1), gL = edgeMask(D, -1); // kerbs only on paved road; gravel outside every turn
    for (var m = 0; m < n; m++) skM[m] = D.done[m] && Math.abs(D.curv[m]) > CURB_TH * 0.5 ? 1 : 0;
    for (var rep = 0; rep < 2; rep++) for (m = 1; m < n - 1; m++) skM[m] = (skM[m - 1] + skM[m] + skM[m + 1]) / 3;
    function put(arr, k, x, y, z) { arr[k] = IX(x, y); arr[k + 1] = IY(x, y, z); }
    for (var i = 0; i < n; i++) {
      var x = D.x[i], y = D.y[i], nx = D.nx[i], ny = D.ny[i], k = i * 4, c = i * 8, v = D.s[i] / VREP, done = D.done[i] === 1;
      put(top, k, x - nx * hw, y - ny * hw, 0); put(top, k + 2, x + nx * hw, y + ny * hw, 0);
      topUV[k] = done ? 0.012 : 0.512; topUV[k + 1] = v; topUV[k + 2] = done ? 0.488 : 0.988; topUV[k + 3] = v;
      side[k] = top[k]; side[k + 1] = top[k + 1] + RH; side[k + 2] = top[k + 2]; side[k + 3] = top[k + 3] + RH;
      var sw = hw + 4; put(shad, k, x - nx * sw, y - ny * sw, -RH); put(shad, k + 2, x + nx * sw, y + ny * sw, -RH);
      shad[k] += 7; shad[k + 1] += 5; shad[k + 2] += 7; shad[k + 3] += 5;
      var vw = hw + 30; put(verge, k, x - nx * vw, y - ny * vw, -RH); put(verge, k + 2, x + nx * vw, y + ny * vw, -RH);
      // kerbs (inside) and gravel (outside): left pair then right pair, width scaled by mask
      var ci = hw - 4, cl = ci + 10 * inL[i], cr = ci + 10 * inR[i], gl = hw + 2 + 34 * gR[i], gr = hw + 2 + 34 * gL[i], g0 = hw + 1;
      put(curb, c, x - nx * ci, y - ny * ci, 0.8); put(curb, c + 2, x - nx * cl, y - ny * cl, 0.8); put(curb, c + 4, x + nx * ci, y + ny * ci, 0.8); put(curb, c + 6, x + nx * cr, y + ny * cr, 0.8);
      var cv = D.s[i] / 14; curbUV[c] = 0; curbUV[c + 1] = cv; curbUV[c + 2] = 1; curbUV[c + 3] = cv; curbUV[c + 4] = 0; curbUV[c + 5] = cv; curbUV[c + 6] = 1; curbUV[c + 7] = cv;
      put(grav, c, x - nx * g0, y - ny * g0, -RH + 0.5); put(grav, c + 2, x - nx * gl, y - ny * gl, -RH + 0.5); put(grav, c + 4, x + nx * g0, y + ny * g0, -RH + 0.5); put(grav, c + 6, x + nx * gr, y + ny * gr, -RH + 0.5);
      for (var q = 0; q < 8; q++) gravUV[c + q] = grav[c + q] / 64;
      // rubber skid marks along the racing line through paved corners, hugging the inside
      var sc = (D.curv[i] > 0 ? 1 : -1) * hw * 0.38, sw2 = 13 * skM[i];
      put(skid, k, x + nx * (sc - sw2), y + ny * (sc - sw2), 0.3); put(skid, k + 2, x + nx * (sc + sw2), y + ny * (sc + sw2), 0.3);
      var sv = D.s[i] / 64; skidUV[k] = 0; skidUV[k + 1] = sv; skidUV[k + 2] = 1; skidUV[k + 3] = sv;
    }
    var I2 = stripIndices(n, 2, 1), I4 = stripIndices(n, 4, 2);
    setGeo(S.m.verge, verge, zero, I2); setGeo(S.m.gravel, grav, gravUV, I4); setGeo(S.m.shadow, shad, zero, I2);
    setGeo(S.m.side, side, zero, I2); setGeo(S.m.top, top, topUV, I2); setGeo(S.m.skid, skid, skidUV, I2); setGeo(S.m.curb, curb, curbUV, I4);
  }

  // ---------- ground, trees, props ----------
  function pathBounds(path) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    path.points.forEach(function (p) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); });
    return b;
  }
  function drawGround(b) {
    var g = S.ground, M = 2600, BIG = 30000, r = rng(11), i; g.clear();
    function quad(x0, y0, x1, y1) { return [IX(x0, y0), IY(x0, y0, -RH), IX(x1, y0), IY(x1, y0, -RH), IX(x1, y1), IY(x1, y1, -RH), IX(x0, y1), IY(x0, y1, -RH)]; }
    g.poly(quad(b.x0 - BIG, b.y0 - BIG, b.x1 + BIG, b.y1 + BIG)).fill(0x3c7a37);
    var tints = [0x468a3e, 0x35702f, 0x4f9445, 0x2f672b, 0x5a9a48];
    for (i = 0; i < 260; i++) {
      var x = lerp(b.x0 - M, b.x1 + M, r()), y = lerp(b.y0 - M, b.y1 + M, r()), rad = 260 + r() * 700;
      g.ellipse(IX(x, y), IY(x, y, -RH), rad * 1.22, rad * 0.7).fill({ color: tints[i % tints.length], alpha: 0.12 + r() * 0.14 });
    }
    for (i = 0; i < 90; i++) { // mown stripes in the infield
      var sx = lerp(b.x0, b.x1, r()), sy = lerp(b.y0, b.y1, r()), L = 300 + r() * 600;
      g.poly(quad(sx, sy, sx + L, sy + 60)).fill({ color: 0x5fa24d, alpha: 0.12 });
    }
  }
  function nearGrid(D, cell) { // distance from a world point to the nearest centreline point
    var grid = {};
    for (var i = 0; i < D.n; i += 2) { var k = Math.floor(D.x[i] / cell) + ',' + Math.floor(D.y[i] / cell); (grid[k] = grid[k] || []).push(i); }
    return function (x, y) {
      var cx = Math.floor(x / cell), cy = Math.floor(y / cell), best = Infinity;
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
        var l = grid[(cx + a) + ',' + (cy + b)];
        if (l) for (var j = 0; j < l.length; j++) { var d = Math.hypot(D.x[l[j]] - x, D.y[l[j]] - y); if (d < best) best = d; }
      }
      return best;
    };
  }
  // Static sprites (sorted back to front) in one ParticleContainer per CHUNK×CHUNK screen cell; each chunk
  // has fixed bounds and is cullable, so only the chunks on screen are drawn.
  function chunked(list, anchorY) {
    var root = new P.Container(), cells = {}, keys = [];
    list.sort(function (a, b) { return a.y - b.y; });
    list.forEach(function (t) {
      var cx = Math.floor(t.x / CHUNK), cy = Math.floor(t.y / CHUNK), k = cx + ',' + cy, pc = cells[k];
      if (!pc) {
        pc = cells[k] = new P.ParticleContainer({ texture: S.atlas[t.k], dynamicProperties: { position: false, vertex: false, color: false } });
        pc.boundsArea = new P.Rectangle(cx * CHUNK - 80, cy * CHUNK - 100, CHUNK + 160, CHUNK + 200); pc.cullable = true; pc.__cy = cy; pc.__cx = cx; keys.push(k);
      }
      pc.addParticle(new P.Particle({ texture: S.atlas[t.k], x: t.x, y: t.y, anchorX: 0.5, anchorY: anchorY, scaleX: t.s, scaleY: t.s, tint: t.t }));
    });
    keys.map(function (k) { return cells[k]; }).sort(function (a, b) { return (a.__cy - b.__cy) || (a.__cx - b.__cx); }).forEach(function (pc) { root.addChild(pc); });
    root.__count = list.length;
    return root;
  }
  function buildTrees() {
    var b = pathBounds(S.path), r = rng(42), dist = nearGrid(S.D, 200), hw = S.roadW / 2, list = [], M = 900;
    var kinds = ['oak', 'oak', 'pine', 'pine', 'birch', 'bush', 'bush', 'rock'];
    var area = (b.x1 - b.x0 + 2 * M) * (b.y1 - b.y0 + 2 * M), tries = Math.min(9000, Math.round(area / 7000));
    for (var i = 0; i < tries; i++) {
      var x = lerp(b.x0 - M, b.x1 + M, r()), y = lerp(b.y0 - M, b.y1 + M, r());
      var clump = Math.sin(x * 0.0021) * Math.cos(y * 0.0017) + Math.sin((x + y) * 0.0009); // forest clumping
      if (clump < -0.2 && r() < 0.8) continue;
      if (dist(x, y) < hw + 95) continue;
      var k = kinds[Math.floor(r() * kinds.length)], s = 0.75 + r() * 0.55, t = r();
      list.push({ x: IX(x, y), y: IY(x, y, -RH), k: k, s: s, t: k === 'rock' ? 0xffffff : mix(0xffffff, 0xd8f0c8, t) });
    }
    return chunked(list, 0.93);
  }
  // Raw road: cones along the edges and survey stakes. Paved corners: sponsor boards.
  function buildProps() {
    var D = S.D, hw = S.roadW / 2, list = [], r = rng(5), inR = edgeMask(D, 1, true), inL = edgeMask(D, -1, true);
    function at(i, d, k, sc) { var wx = D.x[i] + D.nx[i] * d, wy = D.y[i] + D.ny[i] * d; list.push({ x: IX(wx, wy), y: IY(wx, wy, d * d > hw * hw ? -RH : 0), k: k, s: sc, t: 0xffffff }); }
    for (var i = 0; i < D.n; i++) {
      if (!D.done[i]) {
        if (i % 8 === 0) { at(i, -(hw - 3), 'cone', 0.8); at(i, hw - 3, 'cone', 0.8); }
        if (i % 16 === 4) { at(i, -(hw + 12), 'stake', 0.9); at(i, hw + 12, 'stake', 0.9); }
      } else if (i % 10 === 0 && (inR[i] > 0.5 || inL[i] > 0.5)) {
        at(i, (inR[i] > inL[i] ? 1 : -1) * (hw + 16), 'banner' + Math.floor(r() * 3), 0.85);
      }
    }
    return chunked(list, 0.9);
  }

  // ---------- fixtures: run-up apron, pit lane, grid, start/finish gantries, progress band ----------
  function box(g, cx, cy, f, rgt, len, wid, z0, z1, col, opts) { // iso box oriented along unit f (world), right rgt
    opts = opts || {};
    var hl = len / 2, hwd = wid / 2;
    var pts = [[hl, -hwd], [hl, hwd], [-hl, hwd], [-hl, -hwd]].map(function (q) { return [cx + f[0] * q[0] + rgt[0] * q[1], cy + f[1] * q[0] + rgt[1] * q[1]]; });
    [[0, 1, f[0], f[1]], [1, 2, rgt[0], rgt[1]], [2, 3, -f[0], -f[1]], [3, 0, -rgt[0], -rgt[1]]].forEach(function (fc) {
      if (fc[2] + fc[3] <= 0.001) return; // faces away from the camera
      var a = pts[fc[0]], b = pts[fc[1]], lit = 0.55 + 0.3 * clamp(-0.45 * fc[2] + 0.9 * fc[3], -1, 1);
      g.poly([IX(a[0], a[1]), IY(a[0], a[1], z0), IX(b[0], b[1]), IY(b[0], b[1], z0), IX(b[0], b[1]), IY(b[0], b[1], z1), IX(a[0], a[1]), IY(a[0], a[1], z1)])
        .fill(shade(opts.sideCol != null ? opts.sideCol : col, lit));
    });
    g.poly([].concat.apply([], pts.map(function (p) { return [IX(p[0], p[1]), IY(p[0], p[1], z1)]; }))).fill(opts.topCol != null ? opts.topCol : shade(col, 1.08));
  }
  function quadAt(fr, corners, z) { // [along, across] corners in the frame → iso polygon
    var q = [];
    corners.forEach(function (p) { var wx = fr.x + fr.f[0] * p[0] + fr.r[0] * p[1], wy = fr.y + fr.f[1] * p[0] + fr.r[1] * p[1]; q.push(IX(wx, wy), IY(wx, wy, z)); });
    return q;
  }
  function drawFixtures() {
    var g = S.fixtures, hw = S.roadW / 2, L = S.path.length, fr, s, gi;
    g.clear();
    var f0 = frameAt(0), back = 110; // run-up apron behind the start (the model's path begins at s=0)
    var ap = quadAt(f0, [[0, -hw], [-back, -hw], [-back, hw], [0, hw]], 0), apS = ap.map(function (v, i) { return i % 2 ? v + RH : v; });
    g.poly(apS).fill(0x1a1d22); g.poly(ap).fill(0x23262c);
    [-hw + 5, hw - 5].forEach(function (d) {
      var a = [f0.x + f0.r[0] * d, f0.y + f0.r[1] * d], b = [a[0] - f0.f[0] * back, a[1] - f0.f[1] * back];
      g.moveTo(IX(a[0], a[1]), IY(a[0], a[1], 0.3)).lineTo(IX(b[0], b[1]), IY(b[0], b[1], 0.3)).stroke({ width: 2, color: 0xcfd3d8 });
    });
    // pit lane on the quieter side of the start straight: lane, pit wall, garages with team-coloured doors
    var sd = S.pitSide, pd = sd * (hw + 44), inner = [], outer = [];
    for (s = 30; s <= S.pitLen; s += 8) {
      fr = frameAt(s);
      var taper = clamp(Math.min(s - 30, S.pitLen - s) / 70, 0, 1), dIn = sd * (hw + 2), dA = lerp(dIn, pd - sd * 16, taper), dB = lerp(dIn, pd + sd * 18, taper);
      inner.push(IX(fr.x + fr.r[0] * dA, fr.y + fr.r[1] * dA), IY(fr.x + fr.r[0] * dA, fr.y + fr.r[1] * dA, -RH + 0.6));
      outer.unshift(IX(fr.x + fr.r[0] * dB, fr.y + fr.r[1] * dB), IY(fr.x + fr.r[0] * dB, fr.y + fr.r[1] * dB, -RH + 0.6));
    }
    if (inner.length > 4) { g.poly(inner.concat(outer)).fill(0x50565f); g.poly(outer, false).stroke({ width: 1.5, color: 0xffffff, alpha: 0.75 }); }
    for (s = 90; s < S.pitLen - 60; s += 12) {
      fr = frameAt(s); var wd = sd * (hw + 18);
      box(g, fr.x + fr.r[0] * wd, fr.y + fr.r[1] * wd, fr.f, fr.r, 12.5, 3, -RH, 3, (s / 12) % 2 < 1 ? 0xe6edf3 : 0xc9302c, { topCol: 0xf0f3f6 });
    }
    var pitted = {}; Object.keys(S.cars).forEach(function (id) { var r = S.cars[id]; if (r.data.inPits) pitted[r.slot] = r; });
    for (s = 80, gi = 0; s < S.pitLen - 40; s += 34, gi++) {
      fr = frameAt(s); var gd = pd + sd * 34, gx = fr.x + fr.r[0] * gd, gy = fr.y + fr.r[1] * gd, owner = pitted[gi];
      box(g, gx, gy, fr.f, fr.r, 30, 16, -RH, 13, 0x6e7681, { topCol: 0xe6edf3 });
      var dx = -sd * 8.1, a1 = [gx + fr.r[0] * dx + fr.f[0] * 10, gy + fr.r[1] * dx + fr.f[1] * 10], a2 = [gx + fr.r[0] * dx - fr.f[0] * 10, gy + fr.r[1] * dx - fr.f[1] * 10];
      g.poly([IX(a1[0], a1[1]), IY(a1[0], a1[1], -RH), IX(a2[0], a2[1]), IY(a2[0], a2[1], -RH), IX(a2[0], a2[1]), IY(a2[0], a2[1], 8), IX(a1[0], a1[1]), IY(a1[0], a1[1], 8)])
        .fill({ color: owner ? carColor(owner.data) : 0x30363d, alpha: 0.9 });
    }
    for (var k = 0; k < 6; k++) { // start grid boxes
      fr = frameAt(60 + k * 26); var lane = laneOffset(k % Math.max(1, S.lanes.length));
      var a = [fr.x + fr.r[0] * (lane - 9), fr.y + fr.r[1] * (lane - 9)], b2 = [fr.x + fr.r[0] * (lane + 9), fr.y + fr.r[1] * (lane + 9)];
      g.moveTo(IX(a[0], a[1]), IY(a[0], a[1], 0.5)).lineTo(IX(b2[0], b2[1]), IY(b2[0], b2[1], 0.5)).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
    }
    function chequer(sAt, rows) {
      var fc = frameAt(sAt), cols = 12, cw = S.roadW / cols, rl = 6;
      for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) {
        var d0 = -hw + cc * cw, a0 = rr * rl - rows * rl / 2;
        g.poly(quadAt(fc, [[a0, d0], [a0, d0 + cw], [a0 + rl, d0 + cw], [a0 + rl, d0]], 0.6)).fill((rr + cc) % 2 ? 0x111111 : 0xf5f5f5);
      }
    }
    chequer(40, 2); chequer(L - 14, 3);
    function gantry(sAt, beamCol, lights) { // posts + beam; the start has lights, the finish a chequered strip
      var fg = frameAt(sAt), H = 46, lp = [fg.x - fg.r[0] * (hw + 8), fg.y - fg.r[1] * (hw + 8)], rp = [fg.x + fg.r[0] * (hw + 8), fg.y + fg.r[1] * (hw + 8)], i;
      box(g, lp[0], lp[1], fg.f, fg.r, 5, 5, -RH, H, 0x9aa4ae); box(g, rp[0], rp[1], fg.f, fg.r, 5, 5, -RH, H, 0x9aa4ae);
      box(g, fg.x, fg.y, fg.r, [-fg.f[0], -fg.f[1]], S.roadW + 22, 5, H - 9, H, beamCol, { topCol: shade(beamCol, 1.25) });
      if (lights) for (i = 0; i < 5; i++) {
        var d = (i - 2) * 12, lx = fg.x + fg.r[0] * d - fg.f[0] * 3, ly = fg.y + fg.r[1] * d - fg.f[1] * 3;
        g.circle(IX(lx, ly), IY(lx, ly, H - 4.5), 2.6).fill(i < 4 ? 0xff3b30 : 0x3fb950);
      } else for (i = -6; i < 6; i++) {
        var bx = fg.x + fg.r[0] * (i * 10 + 5) - fg.f[0] * 3, by = fg.y + fg.r[1] * (i * 10 + 5) - fg.f[1] * 3;
        g.circle(IX(bx, by), IY(bx, by, H - 4.5), 2.2).fill(i % 2 ? 0xffffff : 0x111111);
      }
      return rp;
    }
    gantry(28, 0x30363d, true);
    var fp = gantry(L - 8, 0x161b22, false);
    S.flagPos = { x: IX(fp[0], fp[1]), y: IY(fp[0], fp[1], 46) };
    var pg = S.progG; pg.clear(); // progress band at the paving frontier
    pg.poly(quadAt(frameAt(S.progFrac * L), [[-3, -hw], [-3, hw], [3, hw], [3, -hw]], 0.9)).fill(0xffc83d);
  }
  function drawFinishFlag() {
    var g = S.flagG, w = S.wave.v, cols = 6, rows = 4, cw = 5, ch = 5; g.clear(); if (!S.flagPos) return;
    var x = S.flagPos.x, y = S.flagPos.y - 2;
    function W(c) { return Math.sin(c * 0.9 - w * Math.PI * 2) * 2.4 * (c / cols); }
    g.moveTo(x, y + 2).lineTo(x, y - 38).stroke({ width: 2, color: 0xdddddd });
    for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
      var x0 = x + i * cw, y0 = y - 38 + j * ch;
      g.poly([x0, y0 + W(i), x0 + cw, y0 + W(i + 1), x0 + cw, y0 + ch + W(i + 1), x0, y0 + ch + W(i)]).fill((i + j) % 2 ? 0x111111 : 0xffffff);
    }
  }

  // ---------- spectators and stands ----------
  function specKeys(model) { // stable key per spectator: task + its n-th comment
    var seen = {}, L = model.path.length || 1;
    return model.spectators.map(function (sp) {
      var n = seen[sp.taskId] = (seen[sp.taskId] || 0) + 1;
      return { key: sp.taskId + '|' + n, frac: sp.s / L, side: sp.side, row: sp.row, recent: sp.recent, taskId: sp.taskId };
    });
  }
  function specPlace(r) {
    var hw = S.roadW / 2, b = r.recent ? S.bounce[r.grp].v : 0;
    var p = place(r.frac * S.path.length, r.side * (hw + 16 + r.row * 7), -RH + 3 + r.row * 4.2 + b * 4);
    var sc = 0.62 * r.sc; r.p.x = p.x; r.p.y = p.y; r.p.scaleX = sc; r.p.scaleY = sc * (1 + b * 0.12); r.p.alpha = r.al;
  }
  function addSpec(d, popDelay) {
    var r = { key: d.key, frac: d.frac, side: d.side, row: d.row, recent: d.recent, taskId: d.taskId, grp: Math.floor(Math.random() * 3), sc: popDelay == null ? 1 : 0, al: 1 };
    r.p = new P.Particle({ texture: S.atlas.person, anchorX: 0.5, anchorY: 1, tint: CROWD[(d.key.length * 7 + d.row * 3 + Math.floor(d.frac * 99991)) % CROWD.length] });
    S.crowd.addParticle(r.p); S.specs[r.key] = r;
    if (popDelay != null) tw(r, { sc: 1, duration: S.reduced ? 0.3 : 0.7, delay: S.reduced ? 0 : popDelay, ease: 'back.out(3)' });
    return r;
  }
  function sortCrowd() { S.crowd.particleChildren.sort(function (a, b) { return a.y - b.y; }); if (S.crowd.onViewUpdate) S.crowd.onViewUpdate(); }
  // Stands: a back wall and a tiered top mesh; the index buffer changes only when the set of stands does.
  function planStands() {
    var groups = {}, plan = [], nv = 0, idx = [], L = S.path.length;
    for (var k in S.specs) { var r = S.specs[k]; (groups[r.taskId] = groups[r.taskId] || []).push(r); }
    Object.keys(groups).forEach(function (id) {
      var mem = groups[id], lo = Infinity, hi = -Infinity;
      mem.forEach(function (m) { var f = m.frac1 != null ? m.frac1 : m.frac; lo = Math.min(lo, f); hi = Math.max(hi, f); });
      var n = clamp(Math.ceil(((hi - lo) * L + 16) / 10), 1, 24);
      for (var j = 0; j < n; j++) { var a = nv + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      plan.push({ mem: mem, n: n, base: nv }); nv += (n + 1) * 2;
    });
    S.standPlan = { groups: plan, nv: nv, idx: new Uint32Array(idx.length ? idx : [0, 0, 0]) };
  }
  function drawStands() {
    var sp = S.standPlan; if (!sp) return;
    var hw = S.roadW / 2, L = S.path.length, nv = Math.max(sp.nv, 3), top = new Float32Array(nv * 2), topUV = new Float32Array(nv * 2), wall = new Float32Array(nv * 2), zero = new Float32Array(nv * 2);
    sp.groups.forEach(function (gr) {
      var s0 = Infinity, s1 = -Infinity, rows = 0, side = 0, al = 0;
      gr.mem.forEach(function (r) { s0 = Math.min(s0, r.frac * L); s1 = Math.max(s1, r.frac * L); rows = Math.max(rows, r.row + 1); side += r.side; al = Math.max(al, Math.min(1, r.sc)); });
      side = side >= 0 ? 1 : -1; s0 -= 8; s1 += 8;
      var din = side * (hw + 9), dout = lerp(din, side * (hw + 22 + (rows - 1) * 7), al), zt = lerp(-RH + 1, -RH + 3 + rows * 4.2, al);
      for (var i = 0; i <= gr.n; i++) {
        var pt = C.sample(S.path, clamp(lerp(s0, s1, i / gr.n), 0, L)), sn = -Math.sin(pt.heading), cs = Math.cos(pt.heading), k = (gr.base + i * 2) * 2;
        var ax = pt.x + sn * din, ay = pt.y + cs * din, bx = pt.x + sn * dout, by = pt.y + cs * dout;
        top[k] = IX(ax, ay); top[k + 1] = IY(ax, ay, -RH + 1); top[k + 2] = IX(bx, by); top[k + 3] = IY(bx, by, zt);
        topUV[k] = 0; topUV[k + 1] = 0.5; topUV[k + 2] = rows * al; topUV[k + 3] = 0.5;
        wall[k] = top[k + 2]; wall[k + 1] = top[k + 3]; wall[k + 2] = top[k + 2]; wall[k + 3] = IY(bx, by, -RH);
      }
    });
    setGeo(S.m.standWall, wall, zero, sp.idx); setGeo(S.m.standTop, top, topUV, sp.idx);
  }

  // ---------- hazards: work stopped mid-flight ----------
  function hazKeys(model) {
    var seen = {}, L = model.path.length || 1;
    return (model.hazards || []).map(function (h) { var b = h.type + '|' + h.taskId, n = seen[b] = (seen[b] || 0) + 1; return { key: b + '|' + n, h: h, frac: h.s / L }; });
  }
  function isoEll(g, cx, cy, rx, ry) { return g.ellipse(cx, cy, rx * 1.22, ry * 0.7); } // world-radius circle → iso ellipse
  function drawPothole(g, rr) {
    var pts = [], rim = [], n = 11, R = 7.5, i;
    for (i = 0; i < n; i++) { var a = i / n * Math.PI * 2, k = 0.7 + rr() * 0.45; pts.push(Math.cos(a) * R * k * 1.22, Math.sin(a) * R * k * 0.7); rim.push(Math.cos(a) * R * (k + 0.35) * 1.22, Math.sin(a) * R * (k + 0.35) * 0.7); }
    g.poly(rim).fill({ color: 0x4b4f56, alpha: 0.9 });
    for (i = 0; i < 6; i++) { var b = rr() * Math.PI * 2, l = R * (1.3 + rr() * 0.9); g.moveTo(Math.cos(b) * R * 0.9, Math.sin(b) * R * 0.5).lineTo(Math.cos(b + 0.2) * l * 1.22, Math.sin(b + 0.2) * l * 0.7).stroke({ width: 0.9, color: 0x0b0c0e, alpha: 0.85 }); }
    g.poly(pts).fill(0x0c0d10);
    g.ellipse(0, R * 0.25, R * 0.8, R * 0.25).fill({ color: 0x2a2d33, alpha: 0.9 });
    for (i = 0; i < 4; i++) g.rect((rr() - 0.5) * R * 3, (rr() - 0.5) * R * 1.4, 1.6 + rr() * 1.4, 1.2 + rr()).fill(0x3b3f46);
  }
  function drawSlick(c, rr, R) {
    var g = new P.Graphics(), sheen = new P.Container(), hi = new P.Graphics();
    for (var i = 0; i < 6; i++) { var a = rr() * Math.PI * 2, d = rr() * R * 0.45, rad = R * (0.45 + rr() * 0.35); isoEll(g, Math.cos(a) * d * 1.22, Math.sin(a) * d * 0.7, rad, rad).fill({ color: 0x07080a, alpha: 0.82 }); }
    sheen.blendMode = 'add';
    [0x7f5af0, 0x2cb67d, 0xffd166, 0xff5fa2].forEach(function (col, k) {
      var e = new P.Graphics(); isoEll(e, 0, 0, R * (0.35 - k * 0.05), R * (0.22 - k * 0.03)).fill({ color: col, alpha: 0.5 });
      e.position.set((k - 1.5) * R * 0.18, (k % 2 ? 1 : -1) * R * 0.08); sheen.addChild(e);
      if (!S.reduced) tw(e, { x: e.x + R * 0.2 * (k % 2 ? -1 : 1), duration: 1.8 + k * 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    });
    isoEll(hi, -R * 0.2, -R * 0.1, R * 0.18, R * 0.06).fill({ color: 0xffffff, alpha: 0.35 });
    c.addChild(g, sheen, hi);
    if (!S.reduced) tw(sheen, { alpha: 0.45, duration: 1.3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }
  function drawDebris(g, rr, level) {
    g.moveTo(-26, -4).lineTo(10, 5).stroke({ width: 2.2, color: 0x0a0a0a, alpha: 0.45 }); g.moveTo(-24, 2).lineTo(12, 10).stroke({ width: 2.2, color: 0x0a0a0a, alpha: 0.4 });
    for (var i = 0; i < 3 + level * 3; i++) {
      var dx = (rr() - 0.5) * 34, dy = (rr() - 0.5) * 18, x = (dx - dy) * CO, y = (dx + dy) * SI;
      if (rr() < 0.45) { g.ellipse(x, y, 3.6, 2.1).fill(0x141414); g.ellipse(x, y, 1.5, 0.9).fill(0x6e7681); } // tyre
      else {
        var col = [0xff4d4d, 0x2f81f7, 0xf9c513, 0xc9d1d9, 0x8b949e][Math.floor(rr() * 5)], w = 2 + rr() * 4, h = 1 + rr() * 2.5, a = rr() * 3;
        g.poly([x, y, x + Math.cos(a) * w, y + Math.sin(a) * w * 0.5, x + Math.cos(a) * w + 1.5, y + Math.sin(a) * w * 0.5 + h, x + 1.5, y + h]).fill(col);
      }
    }
  }
  function drawWreck(c, rr, side) {
    var g = new P.Graphics(), car = new P.Graphics(), tyre = new P.Graphics(), h = rr() * Math.PI * 2, f = [Math.cos(h), Math.sin(h)], rt = [-Math.sin(h), Math.cos(h)];
    var col = mix([0xff4d4d, 0x2f81f7, 0xf9c513][Math.floor(rr() * 3)], 0x2b2b2b, 0.45);
    isoEll(g, 2, 2, 20, 14).fill({ color: 0x1b1408, alpha: 0.5 }); // scorch
    [[6, 5.5], [-6, -5.5], [-6, 5.5]].forEach(function (w) { box(car, f[0] * w[0] + rt[0] * w[1], f[1] * w[0] + rt[1] * w[1], f, rt, 5, 2.2, 0, 3.6, 0x16181c); });
    box(car, 0, 0, f, rt, 20, 10.5, 1.6, 5.6, col); box(car, -f[0] * 1.5, -f[1] * 1.5, f, rt, 8, 7, 5.6, 8.6, 0x111418, { topCol: shade(col, 0.8) });
    car.rotation = side * 0.42; car.position.set(0, -2);
    tyre.ellipse(16 * side, 6, 3.6, 2.1).fill(0x141414); tyre.ellipse(16 * side, 6, 1.5, 0.9).fill(0x6e7681);
    c.addChild(g, car, tyre);
    if (S.reduced) return;
    for (var i = 0; i < 4; i++) { // smoke
      var p = new P.Sprite(S.glow); p.anchor.set(0.5); p.tint = 0x8a8f96; p.alpha = 0; p.scale.set(0.2); c.addChild(p);
      twFromTo(p, { y: -6, x: 0, alpha: 0.55 }, { y: -46, x: 8 * side, alpha: 0, duration: 2.6, delay: i * 0.65, repeat: -1, ease: 'power1.out' });
      twFromTo(p.scale, { x: 0.18, y: 0.18 }, { x: 0.7, y: 0.6, duration: 2.6, delay: i * 0.65, repeat: -1, ease: 'power1.out' });
    }
  }
  function addHazard(d, popDelay) {
    var h = d.h, c = new P.Container(), rr = rng(h.taskId * 13 + d.key.length * 7 + Math.round(h.s)), g;
    var r = { key: d.key, h: h, frac: d.frac, c: c, sc: popDelay == null ? 1 : 0, al: 1 };
    c.cullable = true;
    if (h.type === 'pothole') { g = new P.Graphics(); drawPothole(g, rr); c.addChild(g); S.hazFlat.addChild(c); }
    else if (h.type === 'slick') { drawSlick(c, rr, h.radius || 40); S.hazFlat.addChild(c); }
    else if (h.type === 'debris') { g = new P.Graphics(); drawDebris(g, rr, h.level || 1); g.scale.set(1.35); c.addChild(g); S.barLayer.addChild(c); }
    else { drawWreck(c, rr, h.side || 1); c.scale.set(1.3); S.barLayer.addChild(c); }
    S.haz[d.key] = r;
    if (popDelay != null) tw(r, { sc: 1, duration: S.reduced ? 0.3 : 0.8, delay: S.reduced ? 0 : popDelay, ease: 'back.out(2.6)' });
    placeHazard(r); return r;
  }
  function placeHazard(r) {
    var h = r.h, wreck = h.type === 'wreck', base = wreck ? 1.3 : 1;
    var p = place(r.frac * S.path.length, wreck ? (h.side || 1) * (S.roadW / 2 + 40) : laneOffset(h.lane), wreck ? -RH : 0.4);
    r.c.position.set(p.x, p.y); r.c.scale.set(base * r.sc); r.c.alpha = r.al;
  }
  function slowFactor(hazards, s) { // oil slicks: cars crawl through them
    for (var i = 0; i < hazards.length; i++) { var h = hazards[i]; if (h.type === 'slick' && Math.abs(s - h.s) < (h.radius || 40) * 1.3) return 0.28; }
    return 1;
  }
  function buildLegend() {
    var c = new P.Container(), bg = new P.Graphics(), y = 26, w = 214;
    var title = new P.Text({ text: 'HAZARDS', style: { fontFamily: FONT, fontSize: 10, fontWeight: '800', letterSpacing: 2, fill: 0x8b949e } });
    title.position.set(10, 8); c.addChild(bg, title);
    Object.keys(HZ).forEach(function (k) {
      var ic = new P.Graphics(), dot = new P.Graphics();
      if (k === 'pothole') { ic.scale.set(0.8); drawPothole(ic, rng(21)); }
      else if (k === 'debris') { [[-3, 0], [4, 2]].forEach(function (q) { ic.ellipse(q[0], q[1], 3.6, 2.1).fill(0x141414); ic.ellipse(q[0], q[1], 1.5, 0.9).fill(0x6e7681); }); ic.rect(0, -4, 4, 2).fill(0xff4d4d); }
      else if (k === 'wreck') { ic.roundRect(-7, -3, 14, 7, 2).fill(0x7a2c2c); ic.rotation = 0.4; ic.circle(5, -6, 3).fill({ color: 0x8a8f96, alpha: 0.6 }); }
      else { isoEll(ic, 0, 0, 7, 7).fill(0x07080a); isoEll(ic, -1, -1, 3.5, 2.5).fill({ color: 0x7f5af0, alpha: 0.55 }); isoEll(ic, 2, 1, 2.5, 2).fill({ color: 0x2cb67d, alpha: 0.5 }); }
      ic.position.set(20, y + 7);
      dot.circle(38, y + 7, 2.6).fill(HZ[k].col);
      var t = new P.Text({ text: HZ[k].label, style: { fontFamily: FONT, fontSize: 11, fill: 0xc9d1d9 } }); t.position.set(46, y);
      var cnt = new P.Text({ text: '0', style: { fontFamily: FONT, fontSize: 11, fontWeight: '700', fill: 0xffffff } }); cnt.anchor.set(1, 0); cnt.position.set(w - 10, y);
      c.addChild(ic, dot, t, cnt); S.legendCounts[k] = cnt; y += 20;
    });
    bg.roundRect(0, 0, w, y + 4, 10).fill({ color: 0x0d1117, alpha: 0.88 }).stroke({ width: 1, color: 0xffffff, alpha: 0.14 });
    c.__w = w; return c;
  }
  function updateLegend() {
    var n = { pothole: 0, debris: 0, wreck: 0, slick: 0 };
    for (var k in S.haz) n[S.haz[k].h.type]++;
    Object.keys(HZ).forEach(function (t) { S.legendCounts[t].text = String(n[t]); S.legendCounts[t].alpha = n[t] ? 1 : 0.45; });
  }

  // ---------- barriers: blocked work, with a yellow flag ----------
  function addBarrier(b, fadeIn) {
    var c = new P.Container(), base = new P.Graphics(), flag = new P.Graphics(), glow = new P.Sprite(S.glow);
    glow.anchor.set(0.5); glow.tint = 0xff9f1c; glow.blendMode = 'add'; glow.scale.set(1.6, 0.8); glow.alpha = 0.5;
    c.addChild(glow, base, flag); c.cullable = true; S.barLayer.addChild(c);
    var r = { key: b.taskId, frac: b.s / (S.model.path.length || 1), lane: b.lane, c: c, base: base, flag: flag, glow: glow, al: fadeIn ? 0 : 1, heading: null };
    flag.poly([0, 0, 14, 3, 0, 8]).fill(0xffd60a).stroke({ width: 0.8, color: 0x7a5c00 });
    if (!S.reduced) tw(glow, { alpha: 0.15, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    if (fadeIn) tw(r, { al: 1, duration: S.reduced ? 0.3 : 0.6, ease: 'power2.out' });
    S.bars[r.key] = r; return r;
  }
  function placeBarrier(r) {
    var fr = frameAt(r.frac * S.path.length), w = S.laneW - 4, off = laneOffset(r.lane), cx = fr.x + fr.r[0] * off, cy = fr.y + fr.r[1] * off, h = Math.atan2(fr.f[1], fr.f[0]);
    r.c.position.set(IX(cx, cy), IY(cx, cy, 0)); r.c.alpha = r.al;
    if (r.heading === null || Math.abs(h - r.heading) > 0.02) { // redraw only when the road turns under it
      var g = r.base; r.heading = h; g.clear();
      box(g, 0, 0, fr.r, [-fr.f[0], -fr.f[1]], w, 3.5, 0, 7, 0xff8c1a, { topCol: 0xffd166 });
      for (var i = 0; i < 4; i++) { // black chevrons on the visible face
        var d0 = -w / 2 + i * (w / 4) + 1, d1 = d0 + w / 8, nf = fr.f[0] + fr.f[1] > 0 ? 1.8 : -1.8;
        var a = [fr.r[0] * d0 + fr.f[0] * nf, fr.r[1] * d0 + fr.f[1] * nf], b = [fr.r[0] * d1 + fr.f[0] * nf, fr.r[1] * d1 + fr.f[1] * nf];
        g.poly([IX(a[0], a[1]), IY(a[0], a[1], 1), IX(b[0], b[1]), IY(b[0], b[1], 1), IX(b[0], b[1]) + 1.5, IY(b[0], b[1], 6), IX(a[0], a[1]) + 1.5, IY(a[0], a[1], 6)]).fill(0x1b1b1b);
      }
      var pe = [fr.r[0] * (w / 2 + 2), fr.r[1] * (w / 2 + 2)];
      g.moveTo(IX(pe[0], pe[1]), IY(pe[0], pe[1], 0)).lineTo(IX(pe[0], pe[1]), IY(pe[0], pe[1], 22)).stroke({ width: 1.4, color: 0xe6edf3 });
      r.flag.position.set(IX(pe[0], pe[1]), IY(pe[0], pe[1], 22)); r.glow.position.set(0, 2);
    }
  }

  // ---------- cars ----------
  function drawCar(r) {
    var g = r.g, d = r.data, h = r.heading, f = [Math.cos(h), Math.sin(h)], rt = [-Math.sin(h), Math.cos(h)], col = carColor(d);
    if (d.online === false) col = mix(col, 0x8b949e, 0.55);
    g.clear();
    g.ellipse(2, 2, 15, 8).fill({ color: 0x000000, alpha: 0.32 }); // shadow
    [[6, 5.5], [6, -5.5], [-6, 5.5], [-6, -5.5]].forEach(function (w) { box(g, f[0] * w[0] + rt[0] * w[1], f[1] * w[0] + rt[1] * w[1], f, rt, 5, 2.2, 0, 3.6, 0x16181c); });
    box(g, 0, 0, f, rt, 20, 10.5, 1.6, 5.6, col);                                             // body
    box(g, f[0] * 8.5, f[1] * 8.5, f, rt, 3, 12, 1.2, d.isAgent ? 3.5 : 3.4, d.isAgent ? 0x8957e5 : shade(col, 0.6)); // nose wing; agents purple
    box(g, -f[0] * 9.5, -f[1] * 9.5, f, rt, 2, 11, 5.6, 8.2, shade(col, 0.7));                // rear wing
    box(g, -f[0] * 1.5, -f[1] * 1.5, f, rt, 8, 7, 5.6, 9.2, 0x1e2a38, { topCol: shade(col, 1.15) }); // cockpit
    if (d.isAgent) [-1.6, 1.6].forEach(function (o) { // agent livery: twin racing stripes
      var a = [f[0] * 9.5 + rt[0] * o, f[1] * 9.5 + rt[1] * o], b = [-f[0] * 9.5 + rt[0] * o, -f[1] * 9.5 + rt[1] * o];
      g.moveTo(IX(a[0], a[1]), IY(a[0], a[1], 5.7)).lineTo(IX(b[0], b[1]), IY(b[0], b[1], 5.7)).stroke({ width: 1.1, color: 0xffffff, alpha: 0.9 });
    });
    if (d.online === true) [-3.5, 3.5].forEach(function (o) { // headlights
      var p = [f[0] * 10.2 + rt[0] * o, f[1] * 10.2 + rt[1] * o]; g.circle(IX(p[0], p[1]), IY(p[0], p[1], 3.8), 1.3).fill(0xfff3b0);
    });
    var hp = [f[0] * 30, f[1] * 30]; r.beam.position.set(IX(hp[0], hp[1]), IY(hp[0], hp[1], 1));
    r.beam.rotation = Math.atan2(IY(f[0], f[1], 0), IX(f[0], f[1]));
  }
  function makeLabel(r) {
    var c = new P.Container(), bg = new P.Graphics();
    var name = new P.Text({ text: '', style: { fontFamily: FONT, fontSize: 12, fontWeight: '700', fill: 0xffffff } });
    var task = new P.Text({ text: '', style: { fontFamily: FONT, fontSize: 10, fill: 0xc9d1d9 } });
    var lvl = new P.Text({ text: '', style: { fontFamily: FONT, fontSize: 10, fontWeight: '800', fill: 0x0d1117 } });
    c.addChild(bg, name, task, lvl); c.cullable = true; S.labels.addChild(c);
    r.label = { c: c, bg: bg, name: name, task: task, lvl: lvl, al: 1 };
    layoutLabel(r);
  }
  // Plate: [level chip] name, task below. Map-only: initials only. The level chip is hidden when level is null.
  function layoutLabel(r) {
    var L = r.label, d = r.data, col = carColor(d), hasLvl = d.level !== null && d.level !== undefined;
    var border = d.online === true ? col : d.online === false ? 0x484f58 : 0x8b949e;
    L.name.text = mapOnly ? d.initials : d.name;
    var t = mapOnly ? '' : (d.inPits ? 'in the pits' : (d.taskTitle || ''));
    L.task.text = t.length > 34 ? t.slice(0, 33) + '…' : t;
    L.lvl.text = hasLvl ? 'L' + d.level : ''; L.lvl.visible = hasLvl;
    var lw = hasLvl ? L.lvl.width + 8 : 0, w = Math.max(L.name.width + lw + (hasLvl ? 16 : 12), L.task.width + 12), h = L.task.text ? 32 : 20;
    L.bg.clear();
    L.bg.roundRect(-w / 2, -h - 7, w, h, 6).fill({ color: 0x0d1117, alpha: 0.82 }).stroke({ width: 1.2, color: border });
    L.bg.poly([-5, -7.5, 5, -7.5, 0, -1]).fill({ color: 0x0d1117, alpha: 0.82 });
    if (hasLvl) L.bg.roundRect(-w / 2 + 5, -h - 3, lw, 13, 4).fill(d.isAgent ? 0xb392f0 : (d.online === false ? 0x6e7681 : col));
    L.lvl.position.set(-w / 2 + 9, -h - 3); L.name.position.set(-w / 2 + (hasLvl ? lw + 10 : 6), -h - 5); L.task.position.set(-w / 2 + 6, -h + 9);
  }
  function addCar(d, fade) {
    var c = new P.Container(), glow = new P.Sprite(S.glow), beam = new P.Sprite(S.glow), g = new P.Graphics();
    glow.anchor.set(0.5); glow.blendMode = 'add'; glow.tint = carColor(d); glow.scale.set(1.1, 0.55); glow.position.set(0, 1); // underglow
    beam.anchor.set(0.5); beam.blendMode = 'add'; beam.tint = 0xfff1b8; beam.scale.set(1.1, 0.45); beam.alpha = 0.55;
    c.addChild(glow, beam, g); c.cullable = true; S.carLayer.addChild(c);
    var r = { id: d.userId, data: d, c: c, g: g, glow: glow, beam: beam, al: fade ? 0 : 1, heading: 0, lastDrawn: null, slot: 0 };
    r.frac = d.s / (S.model.path.length || 1); r.d = laneOffset(d.lane); r.pit = d.inPits ? 1 : 0;
    S.cars[d.userId] = r; makeLabel(r);
    if (fade) tw(r, { al: 1, duration: S.reduced ? 0.3 : 0.6, ease: 'power2.out' });
    return r;
  }
  function pitSlots() { var k = 0; Object.keys(S.cars).forEach(function (id) { var r = S.cars[id]; if (r.data.inPits) r.slot = k++; }); }
  function carPose(r) {
    var tp = place(r.frac * S.path.length, r.d, 0), out = { wx: tp.wx, wy: tp.wy, h: tp.heading };
    if (r.pit > 0) { // parked nose-in at its garage
      var fr = frameAt(80 + r.slot * 34), pd = S.pitSide * (S.roadW / 2 + 48), px = fr.x + fr.r[0] * pd, py = fr.y + fr.r[1] * pd;
      out.wx = lerp(out.wx, px, r.pit); out.wy = lerp(out.wy, py, r.pit); out.h = r.pit > 0.5 ? Math.atan2(fr.f[1], fr.f[0]) + S.pitSide * 1.2 : out.h;
    }
    return out;
  }
  function updateCar(r) {
    var p = carPose(r), on = r.data.online === true; r.heading = p.h;
    r.c.position.set(IX(p.wx, p.wy), IY(p.wx, p.wy, 0)); r.c.alpha = r.al * (r.data.online === false ? 0.62 : 1);
    if (r.lastDrawn === null || Math.abs(r.lastDrawn - r.heading) > 0.015) { r.lastDrawn = r.heading; drawCar(r); }
    r.glow.visible = r.beam.visible = on;
  }

  // ---------- camera and input ----------
  function applyCam() {
    var z = S.cam.z; S.world.scale.set(z);
    S.world.position.set(S.app.screen.width / 2 - S.cam.x * z, S.app.screen.height / 2 + 10 - S.cam.y * z);
  }
  function screenToWorld(sx, sy) { return { x: (sx - S.world.position.x) / S.cam.z, y: (sy - S.world.position.y) / S.cam.z }; }
  function leader() { // the car furthest along the track (not in the pits)
    var best = null;
    Object.keys(S.cars).forEach(function (id) { var r = S.cars[id]; if (!r.data.inPits && (!best || r.frac > best.frac)) best = r; });
    return best;
  }
  function introEnd() {
    var L = leader(), p = L ? { x: L.c.x, y: L.c.y } : place(S.progFrac * S.path.length, 0, 0);
    return { x: p.x, y: p.y - 20, z: 1.1 };
  }
  // Fly from the start line along the road to the leading car (4–6.5 s by distance), easing in and out.
  function intro() {
    var end = introEnd(), L = leader(), target = (L ? L.frac : S.progFrac) * S.path.length, u = { t: 0 };
    if (S.reduced) { S.cam.x = end.x; S.cam.y = end.y; S.cam.z = end.z; return; }
    var dur = clamp(3 + target / 30000, 4, 6.5), a = place(0, 0, 0);
    S.cam.x = a.x; S.cam.y = a.y; S.cam.z = 1.6;
    S.introTl = G.timeline({ onComplete: function () { S.introTl = null; } }); S.tweens.push(S.introTl);
    S.introTl.to(u, { t: 1, duration: dur * 0.8, ease: 'power3.inOut', onUpdate: function () {
      var p = place(u.t * target, 0, 0), dip = Math.sin(Math.PI * u.t), k = Math.pow(u.t, 6);
      S.cam.x = lerp(p.x, end.x, k); S.cam.y = lerp(p.y, end.y, k); S.cam.z = lerp(1.6, end.z, u.t) * (1 - 0.82 * dip);
    } }).to(S.cam, { x: end.x, y: end.y, z: end.z, duration: dur * 0.2, ease: 'expo.out' });
  }
  function killCam() { if (S.introTl) { S.introTl.kill(); S.introTl = null; } G.killTweensOf(S.cam); }
  function camTo(x, y, z, dur, ease) { killCam(); tw(S.cam, { x: x, y: y, z: z, duration: S.reduced ? Math.min(dur, 0.3) : dur, ease: ease }); }
  function bindInput(canvas) {
    var drag = null;
    function down(e) {
      if (minimapHit(e.offsetX, e.offsetY)) { minimapJump(e.offsetX, e.offsetY); return; }
      killCam(); drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
      canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
    }
    function move(e) {
      if (!drag) return;
      var now = performance.now(), dt = Math.max(1, now - drag.t), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      S.cam.x -= dx / S.cam.z; S.cam.y -= dy / S.cam.z;
      drag.vx = lerp(drag.vx, dx / dt, 0.4); drag.vy = lerp(drag.vy, dy / dt, 0.4); drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    }
    function up() { // inertia glide, eased out
      if (!drag) return; var k = 260 / S.cam.z;
      if (performance.now() - drag.t < 80) camTo(S.cam.x - drag.vx * k, S.cam.y - drag.vy * k, S.cam.z, 1.1, 'expo.out');
      drag = null; canvas.style.cursor = 'grab';
    }
    function wheel(e) { // zoom anchored on the cursor
      e.preventDefault();
      var tz = clamp((S.zoomTarget || S.cam.z) * Math.exp(-e.deltaY * 0.0016), 0.06, 3.2), w = screenToWorld(e.offsetX, e.offsetY);
      var cx = S.app.screen.width / 2, cy = S.app.screen.height / 2 + 10;
      if (S.introTl) killCam();
      S.zoomTarget = tz;
      tw(S.cam, { x: w.x - (e.offsetX - cx) / tz, y: w.y - (e.offsetY - cy) / tz, z: tz, duration: S.reduced ? 0.2 : 0.45, ease: 'power3.out', overwrite: true, onComplete: function () { S.zoomTarget = null; } });
    }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.style.cursor = 'grab';
  }

  // ---------- minimap: paved road bright, raw road dusty, hazard dots, cars, viewport; click to jump ----------
  function isoBounds(D) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < D.n; i++) { var x = IX(D.x[i], D.y[i]), y = IY(D.x[i], D.y[i], 0); if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
    if (b.x1 - b.x0 < 1) { b.x0 -= 50; b.x1 += 50; } if (b.y1 - b.y0 < 1) { b.y0 -= 50; b.y1 += 50; }
    return b;
  }
  function mmLayout() {
    var b = S.isoBounds, maxW = Math.min(240, S.app.screen.width * 0.3), aspect = (b.x1 - b.x0) / (b.y1 - b.y0);
    var w = aspect >= 1 ? maxW : maxW * aspect, h = aspect >= 1 ? maxW / aspect : maxW, pad = 10;
    S.mm = { w: w + pad * 2, h: h + pad * 2, x: S.app.screen.width - (w + pad * 2) - 16, y: 16, k: w / (b.x1 - b.x0), pad: pad };
    S.mini.position.set(S.mm.x, S.mm.y);
    S.legend.position.set(S.app.screen.width - S.legend.__w - 16, S.mm.y + S.mm.h + 8);
  }
  function mmPt(x, y) { var m = S.mm, b = S.isoBounds; return [m.pad + (x - b.x0) * m.k, m.pad + (y - b.y0) * m.k]; }
  function drawMinimap() {
    S.isoBounds = isoBounds(S.D); mmLayout();
    var g = S.miniBase, m = S.mm, D = S.D, run = [], cur = -1;
    g.clear(); g.roundRect(0, 0, m.w, m.h, 10).fill({ color: 0x0d1117, alpha: 0.92 }).stroke({ width: 1, color: 0xffffff, alpha: 0.14 });
    function flush() { if (run.length > 3) g.poly(run, false).stroke(cur ? { width: 2.4, color: 0xe6edf3, join: 'round' } : { width: 2, color: 0xb59a6d, alpha: 0.85, join: 'round' }); }
    for (var i = 0; i < D.n; i += 3) {
      var q = mmPt(IX(D.x[i], D.y[i]), IY(D.x[i], D.y[i], 0));
      if (D.done[i] !== cur) { flush(); run = run.length ? run.slice(-2) : []; cur = D.done[i]; }
      run.push(q[0], q[1]);
    }
    flush();
    for (var k in S.haz) { var hz = S.haz[k], hp = place(hz.frac * S.path.length, 0, 0), hq = mmPt(hp.x, hp.y); g.circle(hq[0], hq[1], 2.4).fill({ color: HZ[hz.h.type].col, alpha: hz.al }).stroke({ width: 0.6, color: 0x0d1117 }); }
    var f = mmPt(IX(D.x[D.n - 1], D.y[D.n - 1]), IY(D.x[D.n - 1], D.y[D.n - 1], 0)); g.circle(f[0], f[1], 3.5).fill(0xffffff).stroke({ width: 1, color: 0x111111 });
  }
  function drawMinimapDynamic() {
    var g = S.miniDyn, m = S.mm; if (!m) return; g.clear();
    var pp = place(S.progFrac * S.path.length, 0, 0), q = mmPt(pp.x, pp.y);
    g.circle(q[0], q[1], 4 + 4 * S.bounce[1].v).fill({ color: 0xffc83d, alpha: 0.35 }); g.circle(q[0], q[1], 3).fill(0xffc83d);
    Object.keys(S.cars).forEach(function (id) { var r = S.cars[id], c = mmPt(r.c.x, r.c.y); g.circle(c[0], c[1], 2.2).fill({ color: carColor(r.data), alpha: r.al }); });
    var a = screenToWorld(0, 0), b = screenToWorld(S.app.screen.width, S.app.screen.height), p0 = mmPt(a.x, a.y), p1 = mmPt(b.x, b.y);
    var x0 = clamp(p0[0], 0, m.w), y0 = clamp(p0[1], 0, m.h), x1 = clamp(p1[0], 0, m.w), y1 = clamp(p1[1], 0, m.h);
    if (x1 - x0 > 2 && y1 - y0 > 2) g.rect(x0, y0, x1 - x0, y1 - y0).stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
  }
  function minimapHit(x, y) { var m = S.mm; return m && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h; }
  function minimapJump(x, y) {
    var m = S.mm, b = S.isoBounds;
    camTo(b.x0 + (x - m.x - m.pad) / m.k, b.y0 + (y - m.y - m.pad) / m.k, Math.max(S.cam.z, 0.7), 1.2, 'power3.inOut');
  }

  // ---------- frame ----------
  function syncAll() {
    for (var id in S.cars) updateCar(S.cars[id]);
    for (var k in S.specs) specPlace(S.specs[k]);
    for (var b in S.bars) placeBarrier(S.bars[b]);
    for (var h in S.haz) placeHazard(S.haz[h]);
  }
  function tick() {
    S.frame++; applyCam();
    var z = S.cam.z, W = S.app.screen.width, H = S.app.screen.height, k;
    if (!S.transitioning) {
      if (!S.reduced) for (k in S.specs) { var r = S.specs[k]; if (r.recent) specPlace(r); } // recent spectators cheer
      for (k in S.haz) { var hz = S.haz[k]; if (hz.sc < 1 || hz.al < 1) placeHazard(hz); }
      for (k in S.cars) { var cr = S.cars[k]; if (cr.al < 1) updateCar(cr); }
    }
    for (k in S.bars) { var br = S.bars[k]; br.c.alpha = br.al; br.flag.scale.x = 0.75 + 0.25 * Math.sin(S.wave.v * Math.PI * 2 + br.key); }
    drawFinishFlag();
    S.carLayer.children.sort(function (a, b) { return a.y - b.y; });
    var la = clamp((z - 0.18) / 0.15, 0, 1);
    for (k in S.cars) {
      var c = S.cars[k], L = c.label.c, lx = Math.round(S.world.position.x + c.c.x * z), ly = Math.round(S.world.position.y + (c.c.y - 14) * z - 6);
      if (c.data.online === true) c.glow.alpha = 0.35 + 0.15 * S.bounce[0].v;
      L.position.set(lx, ly); L.alpha = la * c.al * c.label.al * (c.data.online === false ? 0.75 : 1);
      L.visible = L.alpha > 0.01 && lx > -200 && lx < W + 200 && ly > -60 && ly < H + 60;
    }
    S.progG.alpha = 0.55 + 0.4 * S.bounce[2].v;
    S.crowd.alpha = clamp((z - 0.12) / 0.12, 0.25, 1); S.treeLayer.alpha = clamp((z - 0.08) / 0.2, 0.45, 1);
    if (S.frame % 2 === 0) drawMinimapDynamic();
  }
  // Rebuild everything that depends on the display path; trees and props cross-fade when asked.
  function rebuildStatic(fade) {
    S.D = derive(S.path); buildRoad(); drawFixtures(); planStands(); drawStands(); drawMinimap(); syncAll(); sortCrowd();
    [['trees', S.treeLayer, buildTrees], ['props', S.propLayer, buildProps]].forEach(function (L) {
      var old = S[L[0]], nw = L[2](); L[1].addChild(nw); S[L[0]] = nw;
      if (old && fade) {
        nw.alpha = 0; tw(nw, { alpha: 1, duration: S.reduced ? 0.3 : 0.8, ease: 'power2.out' });
        tw(old, { alpha: 0, duration: S.reduced ? 0.3 : 0.8, ease: 'power2.in', onComplete: function () { old.destroy({ children: true }); } });
      } else if (old) old.destroy({ children: true });
    });
    updateLegend();
    var b = pathBounds(S.path), gb = S.groundB;
    if (!gb || b.x0 < gb.x0 - 600 || b.y0 < gb.y0 - 600 || b.x1 > gb.x1 + 600 || b.y1 > gb.y1 + 600) { S.groundB = b; drawGround(b); }
  }
  function choosePitSide(model) { // pit lane goes on the side of the start straight with fewer spectators
    var sum = 0; S.pitLen = Math.max(260, 120 + model.cars.filter(function (c) { return c.inPits; }).length * 34 + 60);
    model.spectators.forEach(function (sp) { if (sp.s < S.pitLen + 120) sum += sp.side; });
    S.pitSide = sum > 0 ? -1 : 1;
  }
  function isoOf(p) { return { x: IX(p.x, p.y), y: IY(p.x, p.y, 0) }; }
  function nearestIndex(path, ix, iy) { // display point nearest an iso position
    var best = -1, bd = Infinity, pts = path.points;
    for (var i = 0; i < pts.length; i++) { var dx = IX(pts[i].x, pts[i].y) - ix, dy = IY(pts[i].x, pts[i].y, 0) - iy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function fadeOut(target, vars, done) { // removal fades; onComplete destroys
    vars.onComplete = done; tw(target, vars);
  }

  // ---------- public API ----------
  function mount(stageEl, model, opts) {
    if (S) destroy();
    S = { cam: { x: 0, y: 0, z: 1 }, cars: {}, specs: {}, bars: {}, haz: {}, bounce: [{ v: 0 }, { v: 0 }, { v: 0 }], wave: { v: 0 }, frame: 0,
      tweens: [], sources: [], legendCounts: {}, reduced: !!(opts && opts.reducedMotion) };
    S.model = model; S.roadW = model.roadWidth; S.laneW = model.laneWidth; S.lanes = model.lanes;
    S.path = displayPath(model.path); S.progFrac = model.progressS / (model.path.length || 1);
    choosePitSide(model);
    var app = S.app = new P.Application(), mine = S;
    return app.init({ preference: 'webgl', resizeTo: window, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true, background: 0x24461f }).then(function () {
      if (S !== mine) { app.destroy(true); return; } // destroyed or remounted while initialising
      stageEl.appendChild(app.canvas);
      S.atlas = atlasTexture(); S.glow = glowTexture();
      S.world = new P.Container(); app.stage.addChild(S.world);
      S.ground = new P.Graphics();
      S.m = { verge: makeMesh(P.Texture.WHITE, 0x5c9a4a, 0.55), gravel: makeMesh(gravelTexture()), shadow: makeMesh(P.Texture.WHITE, 0x0b1a0b, 0.28), side: makeMesh(P.Texture.WHITE, 0x1a1d22),
        top: makeMesh(roadTexture(Math.max(1, model.lanes.length), S.roadW, S.laneW)), skid: makeMesh(skidTexture(), 0xffffff, 0.8), curb: makeMesh(curbTexture()),
        standWall: makeMesh(P.Texture.WHITE, 0x2d333b), standTop: makeMesh(tierTexture()) };
      S.fixtures = new P.Graphics(); S.progG = new P.Graphics(); S.progG.blendMode = 'add';
      S.crowd = new P.ParticleContainer({ texture: S.atlas.person, dynamicProperties: { position: true, vertex: true, color: true } });
      S.crowd.boundsArea = new P.Rectangle(-1e6, -1e6, 2e6, 2e6);
      S.barLayer = new P.Container(); S.treeLayer = new P.Container(); S.hazFlat = new P.Container(); S.propLayer = new P.Container(); S.carLayer = new P.Container(); S.flagG = new P.Graphics();
      S.world.addChild(S.ground, S.m.verge, S.m.gravel, S.m.shadow, S.m.side, S.m.top, S.m.skid, S.m.curb, S.hazFlat, S.progG, S.fixtures, S.propLayer,
        S.m.standWall, S.m.standTop, S.crowd, S.barLayer, S.treeLayer, S.carLayer, S.flagG);
      // screen-space overlays: vignette, car plates, minimap, hazard legend
      var vig = new P.Sprite(vignetteTexture());
      S.labels = new P.Container(); S.mini = new P.Container(); S.miniBase = new P.Graphics(); S.miniDyn = new P.Graphics(); S.mini.addChild(S.miniBase, S.miniDyn);
      S.legend = buildLegend(); app.stage.addChild(vig, S.labels, S.mini, S.legend);
      function fit() { vig.width = app.screen.width; vig.height = app.screen.height; if (S.D) drawMinimap(); }
      app.renderer.on('resize', fit); fit();

      model.cars.forEach(function (c) { addCar(c, false); }); pitSlots();
      specKeys(model).forEach(function (d) { addSpec(d); });
      model.barriers.forEach(function (b) { addBarrier(b, false); });
      hazKeys(model).forEach(function (d) { addHazard(d); });
      rebuildStatic(false);

      if (!S.reduced) {
        S.bounce.forEach(function (b, i) { tw(b, { v: 1, duration: 0.32 + i * 0.07, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.11 }); });
        tw(S.wave, { v: 1, duration: 1.4, repeat: -1, ease: 'sine.inOut', yoyo: true });
      }
      app.ticker.add(tick);
      bindInput(app.canvas);
      intro(); tick(); app.render();
      console.info('chicane:mounted', JSON.stringify({ points: S.path.points.length, cars: model.cars.length, spectators: model.spectators.length,
        hazards: model.hazards.length, barriers: model.barriers.length, trees: S.trees.__count, reducedMotion: S.reduced, mapOnly: mapOnly }));
    });
  }

  // Animate from one model to the next: the road morphs by task (track.js), paving sweeps along changed
  // runs, cars drive at speedAt(curvature) (0.28× through slicks), new spectators and hazards pop in.
  function transition(from, to, opts) {
    if (!S || !S.app || !S.world) return;
    var dur = S.reduced ? 0.3 : Math.max(0.45, (opts && opts.duration) || 1.6), L1 = to.path.length || 1;
    if (S.tr) { S.tr.kill(); S.tr = null; }
    pruneTweens();
    S.model = to; S.lanes = to.lanes; S.roadW = to.roadWidth; S.laneW = to.laneWidth;
    var A = displayPath(C.morph(from, to, 0)), B = displayPath(C.morph(from, to, 1)), th = paveThresholds(A, B);
    var M = { points: A.points.map(function (q) { return { x: q.x, y: q.y }; }) };
    var prog0 = S.progFrac, prog1 = to.progressS / L1;
    var plans = to.cars.map(function (c) { // time per px = 1 / speed, so cars are fast on straights and slow in turns
      var r = S.cars[c.userId] || addCar(c, true), f0 = r.frac, f1 = c.s / L1, K = 64, cum = [0], T = 0;
      r.data = c; layoutLabel(r);
      for (var i = 1; i <= K; i++) {
        var s = lerp(f0, f1, (i - 0.5) / K) * L1, pt = C.sample(to.path, clamp(s, 0, L1));
        T += Math.abs(f1 - f0) * L1 / K / (C.speedAt(pt.curv) * slowFactor(to.hazards || [], s)); cum.push(T);
      }
      return { r: r, f0: f0, f1: f1, cum: cum, T: T, d0: r.d, d1: laneOffset(c.lane), pit0: r.pit, pit1: c.inPits ? 1 : 0 };
    });
    var keepCar = {}; to.cars.forEach(function (c) { keepCar[c.userId] = 1; });
    Object.keys(S.cars).forEach(function (id) {
      if (keepCar[id]) return; var r = S.cars[id]; delete S.cars[id];
      fadeOut(r.c, { alpha: 0, duration: S.reduced ? 0.3 : 0.5, ease: 'power2.in' }, function () { r.c.destroy({ children: true }); r.label.c.destroy({ children: true }); });
      fadeOut(r.label.c, { alpha: 0, duration: S.reduced ? 0.3 : 0.5, ease: 'power2.in' });
    });
    pitSlots();
    var sp = [], seen = {};
    specKeys(to).forEach(function (d) {
      seen[d.key] = 1; var r = S.specs[d.key];
      if (!r) { r = addSpec(d, dur * 0.55 + Math.random() * dur * 0.35); r.frac0 = d.frac; } else r.frac0 = r.frac;
      r.side0 = r.side; r.row0 = r.row; r.frac1 = d.frac; r.side1 = d.side; r.row1 = d.row; r.recent = d.recent; r.taskId = d.taskId; sp.push(r);
    });
    Object.keys(S.specs).forEach(function (k) {
      if (seen[k]) return; var r = S.specs[k]; delete S.specs[k];
      tw(r, { al: 0, sc: 0.2, duration: S.reduced ? 0.3 : 0.5, ease: 'power2.in', onUpdate: function () { specPlace(r); }, onComplete: function () { S.crowd.removeParticle(r.p); } });
    });
    var bp = [], bseen = {};
    to.barriers.forEach(function (b) {
      bseen[b.taskId] = 1; var r = S.bars[b.taskId] || addBarrier(b, true);
      bp.push({ r: r, f0: r.frac, f1: b.s / L1, lane: b.lane });
    });
    Object.keys(S.bars).forEach(function (k) {
      if (bseen[k]) return; var r = S.bars[k]; delete S.bars[k];
      fadeOut(r, { al: 0, duration: S.reduced ? 0.3 : 0.5, ease: 'power2.in', onUpdate: function () { r.c.alpha = r.al; } }, function () { r.c.destroy({ children: true }); });
    });
    var hp = [], hseen = {};
    hazKeys(to).forEach(function (d) {
      hseen[d.key] = 1; var r = S.haz[d.key];
      if (!r) { r = addHazard(d, dur * 0.45 + Math.random() * dur * 0.3); r.f0 = d.frac; } else { r.f0 = r.frac; r.h = d.h; }
      r.f1 = d.frac; hp.push(r);
    });
    Object.keys(S.haz).forEach(function (k) {
      if (hseen[k]) return; var r = S.haz[k]; delete S.haz[k];
      fadeOut(r, { al: 0, sc: 0.6, duration: S.reduced ? 0.3 : 0.6, ease: 'power2.in', onUpdate: function () { placeHazard(r); } }, function () { r.c.destroy({ children: true }); });
    });
    updateLegend();
    // keep the view on the same piece of road while the course reflows around it (unless the intro flies)
    var anchor = S.introTl ? -1 : nearestIndex(A, S.cam.x, S.cam.y), anchorAt = anchor >= 0 ? isoOf(A.points[anchor]) : null;
    var st = { t: 0 }, ease = G.parseEase('power2.inOut');
    S.transitioning = true;
    S.tr = G.to(st, { t: 1, duration: dur, ease: 'none', onUpdate: function () {
      var e = ease(st.t);
      S.path = lerpPath(A, B, e, th, M); S.D = derive(S.path); S.progFrac = lerp(prog0, prog1, e);
      buildRoad(); drawFixtures();
      plans.forEach(function (pl) {
        var r = pl.r, target = e * pl.T, cum = pl.cum, j = 1; while (j < cum.length - 1 && cum[j] < target) j++;
        var seg = cum[j] - cum[j - 1], k = seg > 0 ? (target - cum[j - 1]) / seg : 1, u = pl.T > 0 ? (j - 1 + k) / (cum.length - 1) : e;
        r.frac = lerp(pl.f0, pl.f1, clamp(u, 0, 1)); r.d = lerp(pl.d0, pl.d1, e); r.pit = lerp(pl.pit0, pl.pit1, e); updateCar(r);
      });
      sp.forEach(function (r) { r.frac = lerp(r.frac0, r.frac1, e); r.side = e < 0.5 ? r.side0 : r.side1; r.row = lerp(r.row0, r.row1, e); specPlace(r); });
      bp.forEach(function (b) { b.r.frac = lerp(b.f0, b.f1, e); b.r.lane = b.lane; placeBarrier(b.r); });
      hp.forEach(function (r) { r.frac = lerp(r.f0, r.f1, e); placeHazard(r); });
      drawStands();
      if (anchorAt && !S.introTl) { var now = isoOf(S.path.points[anchor]); S.cam.x += now.x - anchorAt.x; S.cam.y += now.y - anchorAt.y; anchorAt = now; }
    }, onComplete: function () {
      S.tr = null; S.transitioning = false;
      S.path = displayPath(to.path); S.progFrac = prog1;
      sp.forEach(function (r) { r.row = r.row1; r.side = r.side1; r.frac1 = null; });
      choosePitSide(to); rebuildStatic(true);
    } });
    S.tweens.push(S.tr);
  }

  function setMapOnly(on) {
    mapOnly = !!on;
    if (!S || !S.world) return;
    Object.keys(S.cars).forEach(function (id) {
      var r = S.cars[id];
      tw(r.label, { al: 0, duration: 0.18, ease: 'power2.in', onComplete: function () { layoutLabel(r); tw(r.label, { al: 1, duration: 0.3, ease: 'power2.out' }); } });
    });
  }

  function destroy() {
    if (!S) return;
    var s = S; S = null;
    s.tweens.forEach(function (t) { t.kill(); });
    if (s.world) { // initialised
      s.app.destroy({ removeView: true }, { children: true });
      s.sources.forEach(function (src) { src.destroy(); });
    }
  }

  window.ChicaneRace = { mount: mount, transition: transition, setMapOnly: setMapOnly, destroy: destroy };

  // ---------- page boot: fetch the state once and mount (live.js, when present, owns this instead) ----------
  function boot() {
    var cfgEl = document.getElementById('chicane-config'), stage = document.getElementById('stage');
    if (!cfgEl || !stage || window.ChicaneLive) return;
    var cfg = JSON.parse(cfgEl.textContent), reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setMapOnly(cfg.mapOnly);
    fetch(cfg.stateUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('state.json HTTP ' + res.status); return res.json(); })
      .then(function (state) { return mount(stage, C.build(state), { reducedMotion: reduced }); })
      .catch(function (err) { console.error('chicane: could not load the race', err); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
