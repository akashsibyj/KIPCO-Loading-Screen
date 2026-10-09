/*!
 * KIPCO loading animation — <kipco-loader> custom element
 * -------------------------------------------------------
 * Zero dependencies. Works from file:// (classic script, no modules).
 *
 * Usage:
 *   <link rel="stylesheet" href="src/kipco-loader.css">
 *   <kipco-loader></kipco-loader>
 *   <script src="src/kipco-loader.js"></script>
 *
 * Attributes
 *   manual       – progress is driven by the host app (setProgress/complete)
 *                  instead of the built-in simulated progress.
 *   logo-src     – override the logo URL (defaults to ../assets/kipco-logo.png
 *                  relative to this script).
 *
 * API
 *   el.setProgress(0..1)  – report real loading progress (switches to manual)
 *   el.complete()         – report that loading is finished
 *   el.replay()           – restart the whole sequence
 *   el.dismiss()          – fade the loader out and remove it
 *
 * Events (bubble)
 *   kipco:stage   detail: { stage: 1..9, name }
 *   kipco:ready   fired once the final composition is shown
 *   kipco:dismissed
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.customElements) return;
  if (window.customElements.get('kipco-loader')) return;

  /* ======================================================================
     1. TIMELINE — every timing lives here (seconds)
     ====================================================================== */
  var TIMELINE = {
    logoIn:     { at: 0.15, dur: 0.9 },                 // 01 Logo appears
    logoSettle: { at: 0.95, dur: 0.95 },                // logo makes room for the tower
    horizon:    { at: 0.0,  dur: 2.4 },
    beam:       { at: 1.05, dur: 1.9 },
    bands:      { at: 1.25, stagger: 0.3, dur: 0.8 },  // 02–04 base + segments (bottom → top)
    crown:      { dur: 1.05 },                          // 05 starts one stagger after the last band
    orbit:      { at: 3.72, dur: 1.65 },                // 07 light sweep
    compose:    { at: 5.35, dur: 0.95 },                // composition makes room for the loader
    loader:     { at: 5.65, dur: 0.65 },                // 08 loading indicator
    progress:   { at: 5.9,  dur: 2.0 },                 // simulated progress fill
    ready:      { hold: 0.25, out: 0.45, tagDelay: 0.22, tagIn: 0.85, tagStagger: 0.14 },
    reduced:    { fade: 0.8, loaderAt: 1.0, progressAt: 1.2, progressDur: 1.6 },
    logoWait:   1.5                                     // max wait for the logo before starting
  };

  var EASE = {
    out:    'cubic-bezier(0.22, 1, 0.36, 1)',
    inOut:  'cubic-bezier(0.65, 0, 0.35, 1)',
    soft:   'cubic-bezier(0.4, 0, 0.2, 1)',
    sweep:  'cubic-bezier(0.42, 0.05, 0.22, 1)'
  };

  /* ======================================================================
     2. GEOMETRY — tower in local units (100 wide), orbit in composition units
     ====================================================================== */
  var TOWER = {
    lines: [93, 141, 189, 237, 285],  // y of each white separation line (right end)
    ground: 320,
    seam: 26,                          // x of the crown set-back
    // placement inside the 100u composition
    x: -10.75, y: 3.6, scale: 0.215
  };

  var ORBIT = {
    cx: -3.2, cy: 45.5, a: 31.5, b: 11.5, rot: -27,
    headDeg: -14,        // final head position (upper right, in front of the tower)
    tail: 0.68,          // tail length as a fraction of one revolution
    layers: 12
  };

  var STAGE_NAMES = ['', 'logo', 'base', 'building', 'shape', 'final-segment',
    'complete', 'orbit', 'loading', 'ready'];

  /* ---------- helpers ---------- */
  function f(n) { return Math.round(n * 1000) / 1000; }

  function cubic(p0, p1, p2, p3, t) {
    var m = 1 - t;
    return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
  }

  // White separation line: rises from the lower-left edge, crests right of centre.
  function arc(R) { return 'M0 ' + (R + 22) + ' C25 ' + (R + 4) + ' 65 ' + (R - 4) + ' 100 ' + R; }
  function arcBack(R) { return 'C65 ' + (R - 4) + ' 25 ' + (R + 4) + ' 0 ' + (R + 22); }
  function arcY(R, x) {
    var lo = 0, hi = 1;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (cubic(0, 25, 65, 100, mid) < x) lo = mid; else hi = mid;
    }
    var t = (lo + hi) / 2;
    return cubic(R + 22, R + 4, R - 4, R, t);
  }
  // Crown silhouette top edge
  function crownTop(x) {
    if (x < TOWER.seam) return 27 - 3 * (x / TOWER.seam);
    var lo = 0, hi = 1;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (cubic(26, 60, 96, 100, mid) < x) lo = mid; else hi = mid;
    }
    return cubic(0, 0, 14, 62, (lo + hi) / 2);
  }
  var CROWN_PATH = 'M0 27 L26 24 L26 0 C60 0 96 14 100 62 L100 93 ' + arcBack(93) + ' Z';

  // Mullion x positions: evenly spaced around the cylinder → denser at the edges
  var MULLIONS = (function () {
    var xs = [];
    for (var d = 9; d < 180; d += 10.5) xs.push(50 - 50 * Math.cos(d * Math.PI / 180));
    return xs;
  })();

  /* Segments, outermost (base) first. Each entry knows its top line, its bottom
     boundary (the line it rises out of) and how far it must travel. */
  var SEGMENTS = (function () {
    var L = TOWER.lines, out = [];
    for (var i = L.length - 1; i >= 0; i--) {
      var top = L[i];
      var bottom = i === L.length - 1 ? TOWER.ground : L[i + 1];
      var flat = i === L.length - 1;
      out.push({ kind: 'band', top: top, bottom: bottom, flat: flat,
        travel: (flat ? bottom - top : bottom - top) + 6 });
    }
    // crown: travel = largest gap between its silhouette and line 1
    var maxGap = 0;
    for (var x = 0; x <= 100; x += 1) maxGap = Math.max(maxGap, arcY(93, x) - crownTop(x));
    out.push({ kind: 'crown', top: 0, bottom: 93, travel: Math.ceil(maxGap) + 6 });
    return out;
  })();

  /* Orbit — arc-length table for an ellipse starting at the head angle */
  var ORBIT_GEO = (function () {
    var N = 1440, t0 = ORBIT.headDeg * Math.PI / 180, a = ORBIT.a, b = ORBIT.b;
    var ts = [0], ss = [0], prev = [a * Math.cos(t0), b * Math.sin(t0)], s = 0;
    for (var i = 1; i <= N; i++) {
      var t = t0 + (i / N) * Math.PI * 2;
      var p = [a * Math.cos(t), b * Math.sin(t)];
      s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      ts.push(t); ss.push(s); prev = p;
    }
    var P = s;
    function pointAt(len) {
      len = ((len % P) + P) % P;
      var lo = 0, hi = N;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (ss[m] < len) lo = m; else hi = m; }
      var k = (len - ss[lo]) / ((ss[hi] - ss[lo]) || 1);
      var t = ts[lo] + (ts[hi] - ts[lo]) * k;
      return [a * Math.cos(t), b * Math.sin(t)];
    }
    // path: two full revolutions (so dashes never wrap), in 120° arcs
    var d = '', step = (2 * Math.PI) / 3;
    for (var j = 0; j <= 6; j++) {
      var tt = t0 + j * step, x = f(a * Math.cos(tt)), y = f(b * Math.sin(tt));
      d += j === 0 ? 'M' + x + ' ' + y : ' A' + a + ' ' + b + ' 0 0 1 ' + x + ' ' + y;
    }
    return { P: P, pointAt: pointAt, d: d };
  })();

  /* ======================================================================
     3. SVG MARKUP
     ====================================================================== */
  function towerDefs(id) {
    var g = TOWER.ground;
    var s = '';
    // glass body: dark navy crown → steel blue → sky blue → mist
    s += '<linearGradient id="' + id + '-body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="' + g + '">' +
      '<stop offset="0" stop-color="#011a39"/>' +
      '<stop offset="0.15" stop-color="#062e5a"/>' +
      '<stop offset="0.36" stop-color="#22609a"/>' +
      '<stop offset="0.48" stop-color="#2f74b6"/>' +
      '<stop offset="0.6" stop-color="#4994d2"/>' +
      '<stop offset="0.71" stop-color="#62abe0"/>' +
      '<stop offset="0.82" stop-color="#8dc8f0"/>' +
      '<stop offset="0.915" stop-color="#bfe0f7"/>' +
      '<stop offset="1" stop-color="#e3f1fc"/></linearGradient>';
    // cylindrical rim light on both edges
    s += '<linearGradient id="' + id + '-rim" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">' +
      '<stop offset="0" stop-color="#8fd0fa" stop-opacity="0.85"/>' +
      '<stop offset="0.07" stop-color="#5fb4ee" stop-opacity="0.42"/>' +
      '<stop offset="0.2" stop-color="#5fb0ea" stop-opacity="0"/>' +
      '<stop offset="0.42" stop-color="#9fd2f6" stop-opacity="0.08"/>' +
      '<stop offset="0.74" stop-color="#5fb0ea" stop-opacity="0"/>' +
      '<stop offset="0.88" stop-color="#76bdf0" stop-opacity="0.32"/>' +
      '<stop offset="1" stop-color="#b0ddfc" stop-opacity="0.8"/></linearGradient>';
    // soft vertical reflections on the glass
    s += '<linearGradient id="' + id + '-streak" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">' +
      '<stop offset="0.22" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="0.32" stop-color="#e6f4ff" stop-opacity="0.13"/>' +
      '<stop offset="0.41" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="0.44" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="0.46" stop-color="#e6f4ff" stop-opacity="0.1"/>' +
      '<stop offset="0.49" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="0.58" stop-color="#001a40" stop-opacity="0"/>' +
      '<stop offset="0.71" stop-color="#001a40" stop-opacity="0.1"/>' +
      '<stop offset="0.85" stop-color="#001a40" stop-opacity="0"/></linearGradient>';
    // tower fade into the ground light
    s += '<linearGradient id="' + id + '-fadeGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="' + g + '">' +
      '<stop offset="0.64" stop-color="#fff"/>' +
      '<stop offset="0.84" stop-color="#fff" stop-opacity="0.75"/>' +
      '<stop offset="0.95" stop-color="#fff" stop-opacity="0.32"/>' +
      '<stop offset="1" stop-color="#fff" stop-opacity="0.05"/></linearGradient>';
    s += '<mask id="' + id + '-fade" maskUnits="userSpaceOnUse" x="-20" y="-60" width="140" height="' + (g + 80) + '">' +
      '<rect x="-20" y="-60" width="140" height="' + (g + 80) + '" fill="url(#' + id + '-fadeGrad)"/></mask>';
    // segment clips: each segment is only visible above the line it rises out of
    SEGMENTS.forEach(function (seg, k) {
      var d;
      if (seg.flat) d = 'M-20 -600 L120 -600 L120 ' + seg.bottom + ' L-20 ' + seg.bottom + ' Z';
      else d = 'M-20 -600 L120 -600 L120 ' + seg.bottom + ' L100 ' + seg.bottom + ' ' + arcBack(seg.bottom) + ' L-20 ' + (seg.bottom + 22) + ' Z';
      s += '<clipPath id="' + id + '-c' + k + '" clipPathUnits="userSpaceOnUse"><path d="' + d + '"/></clipPath>';
    });
    s += '<clipPath id="' + id + '-crown" clipPathUnits="userSpaceOnUse"><path d="' + CROWN_PATH + '"/></clipPath>';
    return s;
  }

  function bandShape(seg) {
    var d = 'M0 ' + (seg.top + 22) + ' C25 ' + (seg.top + 4) + ' 65 ' + (seg.top - 4) + ' 100 ' + seg.top + ' L100 ' + seg.bottom + ' ';
    d += seg.flat ? 'L0 ' + seg.bottom : arcBack(seg.bottom);
    return d + ' Z';
  }

  function bandGrid(seg) {
    var d = '';
    MULLIONS.forEach(function (x) {
      var y1 = arcY(seg.top, x) + 2.2, y2 = seg.flat ? seg.bottom : arcY(seg.bottom, x) - 2.2;
      d += 'M' + f(x) + ' ' + f(y1) + 'V' + f(y2);
    });
    for (var y = seg.top + 12; y < seg.bottom - 6; y += 12) d += arc(y);
    return d;
  }

  function crownGrid() {
    var d = '';
    MULLIONS.forEach(function (x) {
      if (Math.abs(x - TOWER.seam) < 2) return;
      var y1 = crownTop(x) + 1.5, y2 = arcY(93, x) - 2.2;
      if (y2 > y1) d += 'M' + f(x) + ' ' + f(y1) + 'V' + f(y2);
    });
    for (var y = 81; y > 8; y -= 12) d += arc(y);
    return d;
  }

  function segmentMarkup(id, k) {
    var seg = SEGMENTS[k];
    var body = 'url(#' + id + '-body)', rim = 'url(#' + id + '-rim)';
    var inner = '';
    if (seg.kind === 'band') {
      var shape = bandShape(seg);
      inner += '<path d="' + shape + '" fill="' + body + '"/>';
      inner += '<path d="' + shape + '" fill="' + rim + '"/>';
      inner += '<path d="' + shape + '" fill="url(#' + id + '-streak)"/>';
      inner += '<path d="' + bandGrid(seg) + '" fill="none" stroke="#e8f4ff" stroke-opacity="0.08" stroke-width="0.4"/>';
    } else {
      var y26 = f(arcY(93, TOWER.seam));
      inner += '<path d="' + CROWN_PATH + '" fill="' + body + '"/>';
      inner += '<path d="' + CROWN_PATH + '" fill="' + rim + '"/>';
      inner += '<path d="' + CROWN_PATH + '" fill="url(#' + id + '-streak)"/>';
      inner += '<g clip-path="url(#' + id + '-crown)">' +
        '<path d="' + crownGrid() + '" fill="none" stroke="#e8f4ff" stroke-opacity="0.07" stroke-width="0.4"/>' +
        // lighter set-back column on the left
        '<rect x="-1" y="0" width="' + (TOWER.seam + 1) + '" height="130" fill="#6db6ec" fill-opacity="0.2"/>' +
        // seam between set-back and main crown
        '<path d="M' + TOWER.seam + ' 0 V' + y26 + '" stroke="#00163a" stroke-opacity="0.45" stroke-width="1.6"/>' +
        '<path d="M' + (TOWER.seam + 1.4) + ' 1 V' + y26 + '" stroke="#9ed3fa" stroke-opacity="0.25" stroke-width="0.6"/>' +
        '</g>';
      // glass edge highlight along the curved crown
      inner += '<path d="M26 0 C60 0 96 14 100 62" fill="none" stroke="#a9d6fa" stroke-opacity="0.55" stroke-width="1.1"/>';
      inner += '<path d="M0 27 L26 24" fill="none" stroke="#a9d6fa" stroke-opacity="0.45" stroke-width="0.8"/>';
    }
    if (k + 1 < SEGMENTS.length) inner += segmentMarkup(id, k + 1);
    if (seg.kind === 'band') {
      var line = arc(seg.top);
      inner += '<path d="' + line + '" fill="none" stroke="#fff" stroke-opacity="0.32" stroke-width="9"/>';
      inner += '<path d="' + line + '" fill="none" stroke="#fff" stroke-width="4"/>';
    }
    return '<g clip-path="url(#' + id + '-c' + k + ')"><g class="kl-seg" data-k="' + k + '">' + inner + '</g></g>';
  }

  function orbitLayers(id, side) {
    var P = ORBIT_GEO.P, d = ORBIT_GEO.d, n = ORBIT.layers, T = ORBIT.tail * P, s = '';
    function path(len, width, color, opacity) {
      return '<path class="kl-orb" data-len="' + f(len) + '" d="' + d + '" pathLength="' + f(2 * P) + '"' +
        ' fill="none" stroke="' + color + '" stroke-opacity="' + opacity + '" stroke-width="' + width + '"' +
        ' stroke-dasharray="' + f(len) + ' ' + f(4 * P) + '" stroke-dashoffset="' + f(-(P - len)) + '"/>';
    }
    // soft bloom
    s += '<g filter="url(#' + id + '-blur)">';
    s += path(T * 0.22, 1.5, '#3cc8ff', 0.26) + path(T * 0.55, 1.1, '#3cc8ff', 0.15) + path(T, 0.9, '#3cc8ff', 0.09);
    s += '</g>';
    // tapering, fading tail: long layers are thin and faint, short ones bright
    for (var k = n; k >= 1; k--) {
      var r = (k - 1) / (n - 1);
      s += path(T * k / n, f(0.58 - 0.4 * r), '#45cdff', 0.3);
    }
    // white-hot core near the head
    s += path(T * 0.14, 0.24, '#ffffff', 0.95) + path(T * 0.36, 0.16, '#e6fbff', 0.6);
    var head = ORBIT_GEO.pointAt(0);
    s += '<g class="kl-orb-head" transform="translate(' + f(head[0]) + ' ' + f(head[1]) + ')">' +
      '<circle r="5.4" fill="url(#' + id + '-headGlow)"/>' +
      '<circle r="0.9" fill="#ffffff"/></g>';
    return '<g clip-path="url(#' + id + '-' + side + ')">' + s + '</g>';
  }

  function svgMarkup(id) {
    var o = ORBIT;
    var defs = towerDefs(id) +
      '<clipPath id="' + id + '-back" clipPathUnits="userSpaceOnUse"><rect x="-60" y="0" width="120" height="60"/></clipPath>' +
      '<clipPath id="' + id + '-front" clipPathUnits="userSpaceOnUse"><rect x="-60" y="-60" width="120" height="60"/></clipPath>' +
      '<filter id="' + id + '-blur" filterUnits="userSpaceOnUse" x="-60" y="-60" width="120" height="120"><feGaussianBlur stdDeviation="0.55"/></filter>' +
      '<radialGradient id="' + id + '-headGlow">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>' +
      '<stop offset="0.22" stop-color="#9eeaff" stop-opacity="0.75"/>' +
      '<stop offset="0.5" stop-color="#35c6ff" stop-opacity="0.25"/>' +
      '<stop offset="1" stop-color="#35c6ff" stop-opacity="0"/></radialGradient>';
    var orbitTf = 'translate(' + o.cx + ' ' + o.cy + ') rotate(' + o.rot + ')';
    return '<svg class="kl-svg" viewBox="-50 0 100 100" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">' +
      '<defs>' + defs + '</defs>' +
      '<g class="kl-orbit kl-orbit-back" transform="' + orbitTf + '">' + orbitLayers(id, 'back') + '</g>' +
      '<g class="kl-tower" transform="translate(' + TOWER.x + ' ' + TOWER.y + ') scale(' + TOWER.scale + ')" mask="url(#' + id + '-fade)">' +
      segmentMarkup(id, 0) + '</g>' +
      '<g class="kl-orbit kl-orbit-front" transform="' + orbitTf + '">' + orbitLayers(id, 'front') + '</g>' +
      '</svg>';
  }

  /* ======================================================================
     4. ELEMENT
     ====================================================================== */
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  function defaultLogo() {
    try { return SCRIPT_SRC ? new URL('../assets/kipco-logo.png', SCRIPT_SRC).href : 'assets/kipco-logo.png'; }
    catch (e) { return 'assets/kipco-logo.png'; }
  }

  var uidCounter = 0;
  var LOGO_TF = {
    stage1: 'translateY(-58.35%) scale(1.2333)',  // 37u wide, centred at y = 67u
    stage2: 'translateY(0%) scale(1)',            // 30u wide, centred at y = 80u
    final:  'translateY(-47.13%) scale(0.8)'      // 24u wide, centred at y = 69.5u
  };

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  class KipcoLoader extends HTMLElement {
    constructor() {
      super();
      this._uid = 'kl' + (++uidCounter);
      this._built = false;
      this._anims = [];
      this._timers = [];
      this._raf = 0;
      this._run = 0;
      this._s = freshState(false);
      this._onVis = this._onVis.bind(this);
      this._onMotion = this._onMotion.bind(this);
      this._loop = this._loop.bind(this);
      this._forceReady = this._forceReady.bind(this);
    }
  }

  function freshState(manual) {
    return { started: false, elapsed: 0, t0: 0, stage: 0, ready: false,
      p: 0, target: 0, manual: !!manual, complete: false, reduced: false, lastAria: -1 };
  }

  var proto = KipcoLoader.prototype;

  /* ---------- lifecycle ---------- */
  proto.connectedCallback = function () {
    try { this._connect(); } catch (err) { this._fail(err); }
  };

  proto._connect = function () {
    if (!this._built) this._build();
    document.addEventListener('visibilitychange', this._onVis);
    this._mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (this._mql) {
      if (this._mql.addEventListener) this._mql.addEventListener('change', this._onMotion);
      else if (this._mql.addListener) this._mql.addListener(this._onMotion);
    }
    if (this._s.ready) { this._showFinal(); return; }
    this._start(this._s.started ? this._s.elapsed : 0);
  };

  proto.disconnectedCallback = function () {
    if (this._s.started && !this._s.ready) this._s.elapsed = now() - this._s.t0;
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._mql) {
      if (this._mql.removeEventListener) this._mql.removeEventListener('change', this._onMotion);
      else if (this._mql.removeListener) this._mql.removeListener(this._onMotion);
    }
    this._teardown();
  };

  /* ---------- public API ---------- */
  proto.setProgress = function (v) {
    var n = Number(v);
    if (!isFinite(n)) return;
    this._s.manual = true;
    this._s.target = Math.max(this._s.target, Math.min(1, Math.max(0, n)));
    if (this._s.target >= 1) this.complete();
    else this._ensureLoop();
  };

  proto.complete = function () {
    var s = this._s;
    if (s.complete) return;
    s.manual = true;
    s.complete = true;
    s.target = 1;
    this._ensureLoop();
    // Safety net: never wait on rAF alone (it is paused in background tabs).
    var tl = this._tl();
    var due = Math.max(0, (tl.progressAt + 0.4) * 1000 - this._elapsed());
    this._later(due + 1500, this._forceReady);
  };

  proto.replay = function () {
    this._teardown();
    this._failed = false;
    this._s = freshState(this.hasAttribute('manual'));
    this.classList.remove('kl--leaving');
    if (this.isConnected) this._start(0);
  };

  proto.dismiss = function () {
    var self = this;
    if (this.classList.contains('kl--leaving')) return;
    this.classList.add('kl--leaving');
    var done = false;
    function finish() {
      if (done) return; done = true;
      self.dispatchEvent(new CustomEvent('kipco:dismissed', { bubbles: true }));
      if (self.parentNode) self.parentNode.removeChild(self);
    }
    this.addEventListener('transitionend', function (e) { if (e.target === self) finish(); }, { once: true });
    setTimeout(finish, 900); // fallback if transitionend never fires
  };

  /* ---------- build ---------- */
  proto._build = function () {
    var id = this._uid;
    var logo = this.getAttribute('logo-src') || defaultLogo();
    this.setAttribute('role', 'progressbar');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'KIPCO is loading');
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuemax', '100');
    this.setAttribute('aria-valuenow', '0');
    this._s.manual = this.hasAttribute('manual');

    this.innerHTML =
      '<div class="kl-comp" aria-hidden="true">' +
        '<div class="kl-scene">' +
          '<div class="kl-aura"></div>' +
          '<div class="kl-beam"></div>' +
          svgMarkup(id) +
          '<div class="kl-horizon"></div>' +
        '</div>' +
        '<div class="kl-logo">' +
          '<img class="kl-logo-img kl-pending" alt="" draggable="false" decoding="async">' +
          '<img class="kl-reflection kl-pending" alt="" draggable="false" decoding="async">' +
          '<div class="kl-logo-fallback"><span lang="ar" dir="rtl">كيبكو</span><span>KIPCO</span></div>' +
        '</div>' +
        '<div class="kl-loader"><div class="kl-track"><div class="kl-fill"></div><div class="kl-head"></div></div>' +
          '<div class="kl-loading-text">LOADING...</div></div>' +
        '<p class="kl-tagline"><span>OUR GROWTH</span><span>MOVES A BRIGHTER</span><span>TOMORROW</span></p>' +
      '</div>' +
      '<div class="kl-sr" role="status" aria-live="polite"></div>';

    var q = this.querySelector.bind(this);
    this._el = {
      comp: q('.kl-comp'), scene: q('.kl-scene'), aura: q('.kl-aura'), beam: q('.kl-beam'),
      horizon: q('.kl-horizon'), tower: q('.kl-tower'), logo: q('.kl-logo'),
      logoImg: q('.kl-logo-img'), reflection: q('.kl-reflection'),
      loader: q('.kl-loader'), fill: q('.kl-fill'), head: q('.kl-head'),
      tagline: Array.prototype.slice.call(this.querySelectorAll('.kl-tagline span')),
      segs: Array.prototype.slice.call(this.querySelectorAll('.kl-seg')),
      orbs: Array.prototype.slice.call(this.querySelectorAll('.kl-orb')),
      heads: Array.prototype.slice.call(this.querySelectorAll('.kl-orb-head')),
      orbits: Array.prototype.slice.call(this.querySelectorAll('.kl-orbit')),
      sr: q('.kl-sr')
    };
    this._logoPromise = this._loadLogo(logo);
    this._built = true;
  };

  /* Resolves when the logo is decoded, failed, or after a timeout — never hangs. */
  proto._loadLogo = function (src) {
    var self = this, img = this._el.logoImg, refl = this._el.reflection;
    return new Promise(function (resolve) {
      var settled = false;
      function settle(ok) { if (!settled) { settled = true; resolve(ok); } }
      function reveal() {        // also runs if the logo arrives after the timeout
        refl.src = img.currentSrc || img.src;
        img.classList.remove('kl-pending');
        refl.classList.remove('kl-pending');
      }
      img.addEventListener('load', function () {
        var p = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        p.then(function () { reveal(); settle(true); });
      }, { once: true });
      img.addEventListener('error', function () {
        self.classList.add('kl--logo-failed');
        if (window.console) console.warn('[kipco-loader] Logo could not be loaded: ' + src + ' — using text fallback.');
        settle(false);
      }, { once: true });
      img.src = src;
      setTimeout(function () { settle(false); }, TIMELINE.logoWait * 1000);
    });
  };

  /* ---------- timeline ---------- */
  proto._tl = function () {
    var T = TIMELINE, s = this._s;
    if (s.reduced) {
      return { loaderAt: T.reduced.loaderAt, progressAt: T.reduced.progressAt,
        progressDur: T.reduced.progressDur };
    }
    return { loaderAt: T.loader.at, progressAt: T.progress.at, progressDur: T.progress.dur };
  };

  proto._stageTimes = function () {
    var T = TIMELINE;
    if (this._s.reduced) return [0, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, T.reduced.loaderAt];
    var bandAt = function (k) { return T.bands.at + k * T.bands.stagger; };
    var crownAt = bandAt(SEGMENTS.length - 1);
    return [0,
      T.logoIn.at,                 // 1
      bandAt(0),                   // 2
      bandAt(1),                   // 3
      bandAt(3),                   // 4
      crownAt,                     // 5
      crownAt + T.crown.dur * 0.8, // 6
      T.orbit.at,                  // 7
      T.loader.at];                // 8  (9 = ready, event driven + fallback)
  };

  proto._start = function (offsetMs) {
    var self = this, run = ++this._run;
    this.classList.add('kl--pending', 'kl--playing');
    // Watchdog: if playback has not begun after a few seconds, show the final frame.
    this._later((TIMELINE.logoWait + 2.5) * 1000, function () {
      if (self.classList.contains('kl--pending')) self._fail(new Error('playback did not start'));
    });
    this._logoPromise.then(function () {
      if (run !== self._run || !self.isConnected) return;  // torn down meanwhile
      try { self._play(offsetMs || 0); } catch (err) { self._fail(err); }
    }, function (err) { self._fail(err); });
  };

  /* Any unexpected error → never leave a blank or stuck screen:
     cancel motion, show the final composition and report ready. */
  proto._fail = function (err) {
    if (this._failed) return;
    this._failed = true;
    if (window.console) console.error('[kipco-loader] Showing final frame after an error:', err);
    try { this._teardown(); } catch (e) {}
    var s = this._s;
    s.started = true; s.p = 1;
    try { this._renderProgress(1); } catch (e) {}
    if (!this._built) {
      // the component could not be built: show the plain logo instead of a blank screen
      this.innerHTML = '<img class="kl-static" src="' + (this.getAttribute('logo-src') || defaultLogo()) + '" alt="KIPCO">';
    }
    this._showFinal();
    if (!s.ready) {
      s.ready = true;
      try { this._el.sr.textContent = 'Ready. Our growth moves a brighter tomorrow.'; } catch (e) {}
      this.dispatchEvent(new CustomEvent('kipco:ready', { bubbles: true, detail: { recovered: true } }));
    }
  };

  proto._add = function (el, frames, opts) {
    if (!el || !el.animate) return null;   // no Web Animations → CSS final state is shown
    var a;
    try {
      a = el.animate(frames, {
        delay: (opts.delay || 0) * 1000,
        duration: Math.max(1, (opts.dur || 0) * 1000),
        easing: opts.easing || 'linear',
        fill: opts.fill || 'both'
      });
    } catch (err) {
      if (!this._warned && window.console) { this._warned = true; console.warn('[kipco-loader] Animations unavailable, showing static frames:', err.message); }
      return null;
    }
    this._anims.push(a);
    return a;
  };

  proto._play = function (offsetMs) {
    var s = this._s, T = TIMELINE, self = this;
    s.reduced = !!(this._mql && this._mql.matches);
    s.started = true;
    s.t0 = now() - offsetMs;

    if (s.reduced) this._buildReduced(); else this._buildFull();

    if (offsetMs > 0) this._anims.forEach(function (a) { a.currentTime = offsetMs; });
    this.classList.remove('kl--pending');

    // stage events (timers + catch-up on visibility change)
    this._stageTimes().forEach(function (t, i) {
      if (i === 0) return;
      self._later(Math.max(0, t * 1000 - offsetMs), function () { self._fireStages(); });
    });
    this._fireStages();

    // progress loop starts when the loader appears
    var tl = this._tl();
    this._later(Math.max(0, tl.loaderAt * 1000 - offsetMs), function () { self._ensureLoop(); });
    // fallback: simulated progress can never get stuck
    if (!s.manual) {
      this._later(Math.max(0, (tl.progressAt + tl.progressDur + T.ready.hold) * 1000 + 1500 - offsetMs),
        this._forceReady);
    }
  };

  proto._buildFull = function () {
    var T = TIMELINE, e = this._el, self = this;

    // 01 — logo fades in (with a hint of focus), then settles to make room
    this._add(e.logo, [{ opacity: 0 }, { opacity: 1 }],
      { delay: T.logoIn.at, dur: T.logoIn.dur, easing: EASE.soft });
    this._add(e.logo, [{ transform: 'translateY(-58.35%) scale(1.2133)' }, { transform: LOGO_TF.stage1 }],
      { delay: T.logoIn.at, dur: T.logoIn.dur + 0.2, easing: EASE.out });
    this._add(e.logo, [{ transform: LOGO_TF.stage1 }, { transform: LOGO_TF.stage2 }],
      { delay: T.logoSettle.at, dur: T.logoSettle.dur, easing: EASE.inOut, fill: 'forwards' });
    this._add(e.reflection, [{ opacity: 0.08 }, { opacity: 0 }],
      { delay: T.compose.at, dur: T.compose.dur * 0.6, easing: EASE.soft });

    // ground light
    this._add(e.horizon, [{ opacity: 0 }, { opacity: 0.6, offset: 0.4 }, { opacity: 1 }],
      { delay: T.horizon.at, dur: T.horizon.dur, easing: EASE.soft });
    this._add(e.aura, [{ opacity: 0 }, { opacity: 1 }], { delay: 0, dur: 1.4, easing: EASE.soft });
    this._add(e.beam, [{ opacity: 0 }, { opacity: 0.85, offset: 0.35 }, { opacity: 0 }],
      { delay: T.beam.at, dur: T.beam.dur, easing: EASE.soft });

    // 02–05 — segments rise one after another out of the segment below
    e.segs.forEach(function (el, k) {
      var seg = SEGMENTS[k];
      var isCrown = seg.kind === 'crown';
      self._add(el, [
        { transform: 'translateY(' + seg.travel + 'px)', opacity: 0 },
        { opacity: 1, offset: 0.28 },
        { transform: 'translateY(0px)', opacity: 1 }
      ], { delay: T.bands.at + k * T.bands.stagger, dur: isCrown ? T.crown.dur : T.bands.dur, easing: EASE.out });
    });

    // 07 — the light sweeps once around the tower and comes to rest
    var P = ORBIT_GEO.P, gap = f(4 * P) + 'px';
    e.orbs.forEach(function (el) {
      var len = parseFloat(el.getAttribute('data-len'));
      self._add(el, [
        { strokeDasharray: '0px ' + gap, strokeDashoffset: '0px' },
        { strokeDasharray: f(len) + 'px ' + gap, strokeDashoffset: f(-(P - len)) + 'px' }
      ], { delay: T.orbit.at, dur: T.orbit.dur, easing: EASE.sweep });
    });
    var frames = [], N = 72;
    for (var i = 0; i <= N; i++) {
      var pt = ORBIT_GEO.pointAt(P * i / N);
      frames.push({ transform: 'translate(' + f(pt[0]) + 'px, ' + f(pt[1]) + 'px)' });
    }
    e.heads.forEach(function (el) {
      self._add(el, frames, { delay: T.orbit.at, dur: T.orbit.dur, easing: EASE.sweep });
      self._add(el, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1 }],
        { delay: T.orbit.at, dur: T.orbit.dur, easing: 'linear' });
    });

    // 08 — composition makes room; loading indicator appears
    this._add(e.scene, [{ transform: 'scale(1)' }, { transform: 'scale(0.82)' }],
      { delay: T.compose.at, dur: T.compose.dur, easing: EASE.inOut });
    this._add(e.logo, [{ transform: LOGO_TF.stage2 }, { transform: LOGO_TF.final }],
      { delay: T.compose.at, dur: T.compose.dur, easing: EASE.inOut, fill: 'forwards' });
    this._add(e.loader, [
      { opacity: 0, transform: 'translateX(-50%) translateY(30%)' },
      { opacity: 1, transform: 'translateX(-50%) translateY(0%)' }
    ], { delay: T.loader.at, dur: T.loader.dur, easing: EASE.out, fill: 'forwards' });
  };

  proto._buildReduced = function () {
    var R = TIMELINE.reduced, e = this._el, self = this;
    this._add(e.comp, [{ opacity: 0 }, { opacity: 1 }], { delay: 0, dur: R.fade, easing: EASE.soft });
    this._add(e.tower, [{ opacity: 0 }, { opacity: 1 }], { delay: 0.25, dur: R.fade, easing: EASE.soft });
    e.orbits.forEach(function (o) {
      self._add(o, [{ opacity: 0 }, { opacity: 1 }], { delay: 0.5, dur: R.fade, easing: EASE.soft });
    });
    this._add(e.loader, [{ opacity: 0 }, { opacity: 1 }],
      { delay: R.loaderAt, dur: 0.4, easing: EASE.soft, fill: 'forwards' });
  };

  /* ---------- stages ---------- */
  proto._elapsed = function () { return this._s.started ? now() - this._s.t0 : 0; };

  proto._fireStages = function () {
    if (!this._s.started) return;
    var t = this._elapsed() / 1000, times = this._stageTimes();
    for (var i = 1; i < times.length; i++) {
      if (t + 0.001 >= times[i] && this._s.stage < i) this._setStage(i);
    }
  };

  proto._setStage = function (n) {
    this._s.stage = n;
    this.setAttribute('data-stage', String(n));
    if (n === 8) this._el.sr.textContent = 'Loading';
    this.dispatchEvent(new CustomEvent('kipco:stage', { bubbles: true, detail: { stage: n, name: STAGE_NAMES[n] } }));
  };

  /* ---------- progress ---------- */
  proto._ensureLoop = function () {
    if (this._raf || this._s.ready || !this._s.started) return;
    if (this._elapsed() < this._tl().loaderAt * 1000 - 20) return;
    this._lastTick = now();
    this._raf = requestAnimationFrame(this._loop);
  };

  proto._loop = function () {
    try { this._step(); } catch (err) { this._raf = 0; this._forceReadySafe(err); }
  };

  proto._forceReadySafe = function (err) {
    try { this._forceReady(); } catch (e) { this._fail(err || e); }
  };

  proto._step = function () {
    this._raf = 0;
    var s = this._s, tl = this._tl(), t = now();
    var dt = Math.min(64, t - (this._lastTick || t)); // clamp: smooth catch-up after a hidden tab
    this._lastTick = t;
    var el = (t - s.t0) / 1000;

    if (!s.manual) {
      var k = Math.min(1, Math.max(0, (el - tl.progressAt) / tl.progressDur));
      s.target = 0.5 - 0.5 * Math.cos(Math.PI * k);
    }
    var goal = el < tl.progressAt ? 0 : s.target;
    s.p += (goal - s.p) * (1 - Math.exp(-dt / 140));
    if (Math.abs(goal - s.p) < 0.0015) s.p = goal;
    this._renderProgress(s.p);
    this._fireStages();

    var finished = s.p >= 0.999 && (s.manual ? s.complete : el >= tl.progressAt + tl.progressDur);
    if (finished) {
      var self = this;
      this._later(TIMELINE.ready.hold * 1000, function () { self._goReady(); });
      return;
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  proto._renderProgress = function (p) {
    var e = this._el;
    e.fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    e.head.style.transform = 'translateX(' + (p * 100).toFixed(3) + '%)';
    var pct = Math.round(p * 100);
    if (pct !== this._s.lastAria) { this._s.lastAria = pct; this.setAttribute('aria-valuenow', String(pct)); }
  };

  proto._forceReady = function () {
    if (this._s.ready || !this._s.started) return;
    this._s.p = 1;
    this._renderProgress(1);
    this._goReady();
  };

  /* ---------- 09 ready ---------- */
  proto._goReady = function () {
    try { this._ready(); } catch (err) { this._fail(err); }
  };

  proto._ready = function () {
    var s = this._s, e = this._el, R = TIMELINE.ready, self = this;
    if (s.ready) return;
    s.ready = true;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    // make sure everything that should have happened has happened
    this._anims.forEach(function (a) { try { if (a.playState !== 'finished') a.finish(); } catch (err) {} });
    this._renderProgress(1);
    for (var i = s.stage + 1; i <= 8; i++) this._setStage(i);

    this._add(e.loader, [{ opacity: 1 }, { opacity: 0 }], { delay: 0, dur: R.out, easing: EASE.soft, fill: 'forwards' });
    e.tagline.forEach(function (span, i) {
      var frames = s.reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(40%)' }, { opacity: 1, transform: 'translateY(0%)' }];
      self._add(span, frames, { delay: R.tagDelay + i * R.tagStagger, dur: R.tagIn, easing: EASE.out });
    });
    this.classList.remove('kl--playing');
    e.sr.textContent = 'Ready. Our growth moves a brighter tomorrow.';
    this.setAttribute('aria-valuenow', '100');
    this._setStage(9);
    this.dispatchEvent(new CustomEvent('kipco:ready', { bubbles: true }));
  };

  /* Final composition without animation (e.g. element re-attached after ready). */
  proto._showFinal = function () {
    this.classList.remove('kl--pending', 'kl--playing');
    this.setAttribute('data-stage', '9');
    this.setAttribute('aria-valuenow', '100');
  };

  /* ---------- environment changes ---------- */
  proto._onVis = function () {
    if (document.visibilityState !== 'visible') return;
    this._fireStages();
    this._ensureLoop();
  };

  proto._onMotion = function () {
    // Switched to reduced motion mid-sequence: jump every running animation to its end.
    if (this._mql && this._mql.matches && !this._s.ready) {
      this._anims.forEach(function (a) { try { a.finish(); } catch (err) {} });
    }
  };

  /* ---------- housekeeping ---------- */
  proto._later = function (ms, fn) {
    var self = this;
    var id = setTimeout(function () {
      self._timers = self._timers.filter(function (x) { return x !== id; });
      try { fn.call(self); } catch (err) { self._fail(err); }
    }, ms);
    this._timers.push(id);
  };

  proto._teardown = function () {
    this._run++;
    this._timers.forEach(clearTimeout);
    this._timers = [];
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    this._anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    this._anims = [];
  };

  window.customElements.define('kipco-loader', KipcoLoader);
  window.KipcoLoader = KipcoLoader;
  window.KipcoLoader.TIMELINE = TIMELINE;
})();
