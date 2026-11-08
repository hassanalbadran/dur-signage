/* Core UI helpers: settings store, language, DOM builder, icons, toast, sheets, confetti. */
(function () {
  'use strict';
  var st = { lang: 'en', theme: 'auto', fs: 1, sLang: 'ar', reduce: false, wifiOnly: false, notif: true, haptic: true, onb: false, linked: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem('dra_settings') || '{}')); } catch (e) {}

  function L(en, ar) { return st.lang === 'ar' ? ar : en; }
  function ic(n) {
    var i = (window.ICONS || {})[n];
    return i ? '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + i + '</svg>' : '';
  }

  function add(parent, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { for (var i = 0; i < child.length; i++) add(parent, child[i]); return; }
    if (typeof child === 'string' || typeof child === 'number') parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child);
  }

  function h(tag, attrs) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (v) e[k] = true; }
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }

  function save() { try { localStorage.setItem('dra_settings', JSON.stringify(st)); } catch (e) {} }

  function isDark() {
    return st.theme === 'dark' || (st.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function applyLook() {
    var r = document.documentElement;
    r.lang = st.lang;
    r.dir = st.lang === 'ar' ? 'rtl' : 'ltr';
    r.setAttribute('data-theme', st.theme);
    r.classList.toggle('is-dark', isDark());
    r.classList.toggle('reduce', !!st.reduce);
    r.style.setProperty('--fs', String(st.fs));
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', isDark() ? '#0A1619' : '#F1F6F7');
  }
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook); } catch (e) {}
  }

  function buzz(ms) {
    if (st.haptic && navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} }
  }

  /* ---------- toast ---------- */
  var toastEl = null, toastTimer = 0;
  function toast(msg, bad) {
    if (!toastEl) { toastEl = h('div', { class: 'toast' }); document.getElementById('app').appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3600);
  }

  /* ---------- sheets ----------
     actions: [{label, cls, fn}]; fn() may return false (keep open) or a promise resolving false. */
  function sheet(title, body, actions, opt) {
    opt = opt || {};
    var ov = h('div', { class: 'overlay' });
    var panel = h('div', { class: 'sheet' + (opt.full ? ' full' : '') });
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      ov.classList.remove('open');
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 360);
      if (opt.onclose) opt.onclose();
    }
    panel.appendChild(h('div', { class: 'grab' }));
    panel.appendChild(h('div', { class: 'sh' }, h('div', { class: 'st', text: title }),
      h('button', { class: 'ibtn', 'aria-label': 'close', html: ic('x'), onclick: close })));
    panel.appendChild(h('div', { class: 'sb' }, body));
    if (actions && actions.length) {
      var foot = h('div', { class: 'sf' });
      actions.forEach(function (a) {
        foot.appendChild(h('button', {
          class: 'btn ' + (a.cls || ''), text: a.label,
          onclick: function () {
            var r = a.fn ? a.fn() : undefined;
            if (r && r.then) r.then(function (v) { if (v !== false) close(); }); else if (r !== false) close();
          }
        }));
      });
      panel.appendChild(foot);
    }
    ov.appendChild(panel);
    document.getElementById('app').appendChild(ov);
    requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('open'); }); });
    ov.addEventListener('click', function (e) { if (e.target === ov && !opt.sticky) close(); });
    return { close: close, el: panel };
  }

  function confirmBox(msg, okLabel, danger) {
    return new Promise(function (res) {
      var done = false;
      sheet(msg, h('div'), [
        { label: L('Cancel', 'إلغاء'), fn: function () { done = true; res(false); } },
        { label: okLabel || L('OK', 'موافق'), cls: danger ? 'danger' : 'pri', fn: function () { done = true; res(true); } }
      ], { onclose: function () { if (!done) { done = true; res(false); } } });
    });
  }

  /* ---------- small form widgets ---------- */
  function field(label, ctrl) { return h('div', { class: 'field' }, h('label', { text: label }), ctrl); }
  function sw(on, fn) {
    var b = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false' }, h('i'));
    b.addEventListener('click', function () {
      on = !on;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      buzz(8);
      fn(on);
    });
    return b;
  }
  function seg(opts, cur, fn) {
    var box = h('div', { class: 'seg' });
    opts.forEach(function (o) {
      var b = h('button', { class: o[0] === cur ? 'on' : '', text: o[1] });
      b.addEventListener('click', function () {
        for (var i = 0; i < box.children.length; i++) box.children[i].classList.remove('on');
        b.classList.add('on');
        fn(o[0]);
      });
      box.appendChild(b);
    });
    return box;
  }
  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '-';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (n >= 1024 && i < 4) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  }
  function ago(ts) {
    if (!ts) return L('never', 'لم يتصل');
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return L('just now', 'الآن');
    if (s < 3600) return Math.round(s / 60) + L(' min ago', ' د');
    if (s < 86400) return Math.round(s / 3600) + L(' h ago', ' س');
    return Math.round(s / 86400) + L(' d ago', ' يوم');
  }

  /* ---------- paper confetti ---------- */
  function confetti(power) {
    if (st.reduce) return;
    var host = document.getElementById('app');
    var cv = h('canvas', { class: 'confetti' });
    var w = cv.width = host.clientWidth, hgt = cv.height = host.clientHeight;
    host.appendChild(cv);
    var g = cv.getContext('2d');
    var colors = ['#0E8A84', '#44BFA3', '#3A93B5', '#F2C14E', '#E8706A', '#FFFFFF', '#8FD6CE'];
    var n = power === 'big' ? 160 : 90, ps = [];
    for (var i = 0; i < n; i++) {
      var fromLeft = i % 2 === 0;
      ps.push({
        x: fromLeft ? -10 : w + 10, y: hgt * (.55 + Math.random() * .2),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10), vy: -(10 + Math.random() * 14),
        r: Math.random() * 6, vr: (Math.random() - .5) * .4,
        w: 7 + Math.random() * 7, hh: 4 + Math.random() * 7,
        c: colors[(Math.random() * colors.length) | 0], t: Math.random() * 6
      });
    }
    var t0 = performance.now();
    (function frame(t) {
      var k = (t - t0) / 1000;
      g.clearRect(0, 0, w, hgt);
      ps.forEach(function (p) {
        p.vy += .42; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        var flip = Math.cos(p.r * 3 + p.t);
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, flip);
        g.globalAlpha = Math.max(0, 1 - k / 2.6);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.hh / 2, p.w, p.hh);
        g.restore();
      });
      if (k < 2.7) requestAnimationFrame(frame); else if (cv.parentNode) cv.parentNode.removeChild(cv);
    })(t0);
    buzz(30);
  }

  function rid(n) { var s = '', a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < (n || 9); i++) s += a[(Math.random() * a.length) | 0]; return s; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  window.UI = {
    st: st, save: save, applyLook: applyLook, L: L, ic: ic, h: h, toast: toast, sheet: sheet, confirm: confirmBox,
    field: field, sw: sw, seg: seg, fmtBytes: fmtBytes, ago: ago, confetti: confetti, buzz: buzz, rid: rid, clone: clone, isDark: isDark
  };
  window.L = L; window.ic = ic; window.h = h;
})();
