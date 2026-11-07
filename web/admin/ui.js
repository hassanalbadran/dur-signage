/* Small UI helpers for the admin app: settings, language, icons, DOM builder, toast, sheets. */
(function () {
  var st = { lang: 'en', theme: 'auto' };
  try { Object.assign(st, JSON.parse(localStorage.getItem('dra_settings') || '{}')); } catch (e) {}

  function L(en, ar) { return st.lang === 'ar' ? ar : en; }
  function ic(n) { var i = (window.ICONS || {})[n]; return i ? '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + i + '</svg>' : ''; }

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
  function add(p, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(p, x); });
    else if (typeof c === 'string' || typeof c === 'number') p.appendChild(document.createTextNode(c));
    else p.appendChild(c);
  }

  function save() { try { localStorage.setItem('dra_settings', JSON.stringify(st)); } catch (e) {} }
  function applyLang() { document.documentElement.lang = st.lang; document.documentElement.dir = st.lang === 'ar' ? 'rtl' : 'ltr'; }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', st.theme);
    var m = document.querySelector('meta[name=theme-color]');
    var dark = st.theme === 'dark' || (st.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    if (m) m.setAttribute('content', dark ? '#0D1B20' : '#0F8B8D');
  }

  var toastEl, toastT;
  function toast(msg, bad) {
    if (!toastEl) { toastEl = h('div', { class: 'toast' }); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = 'toast'; }, 3800);
  }

  /* bottom sheet. actions: [{label, cls, fn}] -> fn() may return false to keep the sheet open */
  function sheet(title, body, actions, opt) {
    opt = opt || {};
    var ov = h('div', { class: 'overlay' });
    var panel = h('div', { class: 'sheet' + (opt.full ? ' full' : '') });
    var head = h('div', { class: 'sheet-h' }, h('div', { class: 'sheet-t', text: title }),
      h('button', { class: 'ibtn', 'aria-label': 'close', html: ic('x'), onclick: function () { close(); } }));
    var foot = h('div', { class: 'sheet-f' });
    (actions || []).forEach(function (a) {
      foot.appendChild(h('button', { class: 'btn ' + (a.cls || ''), text: a.label, onclick: function () { if (a.fn && a.fn() === false) return; close(); } }));
    });
    panel.appendChild(head); panel.appendChild(h('div', { class: 'sheet-b' }, body));
    if (actions && actions.length) panel.appendChild(foot);
    ov.appendChild(panel); document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('open'); });
    ov.addEventListener('click', function (e) { if (e.target === ov && !opt.sticky) close(); });
    function close() { ov.classList.remove('open'); setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220); if (opt.onclose) opt.onclose(); }
    return { close: close, el: panel };
  }
  function confirmBox(msg, okLabel, danger) {
    return new Promise(function (res) {
      var done = false;
      sheet(msg, h('div'), [
        { label: L('Cancel', 'إلغاء'), fn: function () { if (!done) { done = true; res(false); } } },
        { label: okLabel || L('OK', 'موافق'), cls: danger ? 'danger' : 'pri', fn: function () { done = true; res(true); } }
      ], { onclose: function () { if (!done) { done = true; res(false); } } });
    });
  }

  window.UI = { st: st, save: save, L: L, ic: ic, h: h, toast: toast, sheet: sheet, confirm: confirmBox, applyLang: applyLang, applyTheme: applyTheme };
  window.L = L; window.ic = ic; window.h = h;
})();
