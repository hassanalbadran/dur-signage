/* Backend access (Apps Script), instant remote channel (ntfy) and cached state. */
(function () {
  'use strict';
  var C = window.DR, P = window.P, UI = window.UI;
  var CACHE_KEY = 'dra_state';
  var S = { items: [], devices: [], cfg: {}, email: '', skew: 0, loaded: false };

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c) { S.items = c.items || []; S.devices = c.devices || []; S.cfg = c.cfg || {}; S.email = c.email || ''; S.loaded = true; }
    } catch (e) { /* ignore */ }
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items: S.items, devices: S.devices, cfg: S.cfg, email: S.email })); } catch (e) { /* ignore */ }
    if (P.native) P.call('screens.cache', { devices: S.devices.map(function (d) { return { id: d.id, name: d.name, rt: d.rt }; }) }).catch(function () {});
  }

  function token() {
    if (P.native) return P.call('auth.token').then(function (r) { if (r && r.email) S.email = r.email; return r.token; });
    return window.Drive.token();
  }

  function post(action, data) {
    return token().then(function (tok) {
      return fetch(C.GAS_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ a: action, tok: tok }, data || {}))
      });
    }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.error) throw new Error(j.error); return j; });
  }

  function refresh() {
    return post('admin.state').then(function (r) {
      S.items = r.items || []; S.devices = r.devices || []; S.cfg = r.cfg || {};
      S.email = r.email || S.email; S.skew = (r.now || Date.now()) - Date.now(); S.loaded = true;
      saveCache();
      return S;
    });
  }

  /* Human readable reason for any failure. */
  function explain(e) {
    var m = (e && e.message) || String(e), r = e && e.reason, s = e && e.status, L = UI.L;
    if (m === 'NET' || /Failed to fetch|NetworkError|Load failed/i.test(m)) return L('No internet connection', 'لا يوجد اتصال بالإنترنت');
    if (r === 'storageQuotaExceeded' || /quota|storage_full|insufficient/i.test(m)) return L('Cloud storage is full', 'مساحة التخزين السحابي ممتلئة');
    if (m === 'not_allowed') return L('This account is not allowed to manage the screens', 'هذا الحساب غير مصرح له بإدارة الشاشات');
    if (s === 401 || m === 'AUTH' || /^auth_/.test(m)) return L('Sign-in expired, please sign in again', 'انتهت صلاحية تسجيل الدخول، سجّلي الدخول مرة أخرى');
    if (m === 'code_invalid') return L('The code is wrong or has expired', 'الكود غير صحيح أو منتهي الصلاحية');
    if (m === 'CANCELLED') return L('Cancelled', 'تم الإلغاء');
    if (m === 'EMPTY') return L('The file is empty', 'الملف فارغ');
    if (m === 'WIFI') return L('Waiting for Wi-Fi', 'بانتظار شبكة واي فاي');
    if (m === 'NOT_NATIVE') return L('Available in the Android app', 'متاح في تطبيق الأندرويد');
    if (s === 403) return L('The cloud refused the request (check API settings)', 'رفضت الخدمة السحابية الطلب (راجعي إعدادات API)');
    if (s === 404 || s === 410) return L('Upload session expired, retry', 'انتهت جلسة الرفع، أعيدي المحاولة');
    return m;
  }

  /* ---------- instant remote ---------- */
  var seen = 0;
  function send(dev, op, arg) {
    var msg = { id: UI.rid(10), op: op, arg: arg || 0 };
    var viaRt = dev.rt ? fetch(C.RT_SERVER + '/' + dev.rt, { method: 'POST', body: JSON.stringify(msg) }).then(function (r) { if (!r.ok) throw new Error('RT'); }) : Promise.reject(new Error('RT'));
    return viaRt.catch(function () {
      // fallback path: the screen reads this on its next poll (slower but reliable)
      return post('admin.rc', { id: dev.id, op: op, arg: arg || 0 });
    });
  }

  /* Subscribe to the screen's status topic while the remote page is open. */
  var watch = { src: null, timer: null, dev: null };
  function startWatch(dev, onStatus) {
    stopWatch();
    watch.dev = dev;
    if (!dev || !dev.rt || !window.EventSource) return;
    try {
      watch.src = new EventSource(C.RT_SERVER + '/' + dev.rt + '-s/sse');
      watch.src.onmessage = function (ev) {
        try { var m = JSON.parse(ev.data); if (m.message) onStatus(JSON.parse(m.message)); } catch (e) { /* ignore */ }
      };
    } catch (e) { /* ignore */ }
    var ping = function () { fetch(C.RT_SERVER + '/' + dev.rt, { method: 'POST', body: JSON.stringify({ id: UI.rid(10), op: 'watch' }) }).catch(function () {}); };
    ping();
    watch.timer = setInterval(ping, 60000);
  }
  function stopWatch() {
    if (watch.src) { try { watch.src.close(); } catch (e) { /* ignore */ } }
    clearInterval(watch.timer);
    watch.src = null; watch.timer = null; watch.dev = null;
  }

  /* ---------- helpers on items ---------- */
  function kindWord(k) {
    var L = UI.L;
    return { video: L('Video', 'فيديو'), image: L('Image', 'صورة'), text: L('Text', 'نص'), pdf: 'PDF', gslides: L('Slides', 'شرائح') }[k] || k;
  }
  function kindIcon(k) { return { video: 'film', image: 'image', text: 'type', pdf: 'file-text', gslides: 'presentation' }[k] || 'file-text'; }
  function devName(id) { var d = S.devices.filter(function (x) { return x.id === id; })[0]; return d ? (d.name || id) : '?'; }
  function targetsText(it) {
    if (it.targets === 'all' || !it.targets) return UI.L('All screens', 'كل الشاشات');
    return it.targets.map(devName).join(', ') || '-';
  }
  function upsert(it) {
    var i = -1;
    S.items.forEach(function (q, n) { if (q.id === it.id) i = n; });
    if (i >= 0) S.items[i] = it; else S.items.push(it);
    S.items.sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
    saveCache();
  }

  window.Api = {
    S: S, post: post, refresh: refresh, token: token, explain: explain, loadCache: loadCache, saveCache: saveCache,
    send: send, startWatch: startWatch, stopWatch: stopWatch,
    kindWord: kindWord, kindIcon: kindIcon, devName: devName, targetsText: targetsText, upsert: upsert,
    now: function () { return Date.now() + S.skew; }
  };
})();
