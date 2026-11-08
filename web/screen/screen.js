/*
 * Dur Al-Razi - screen player.
 * Remote-control (D-pad) navigation only. Plain ES5 so it runs on old Android WebViews.
 *
 * Sections
 *   1. state            persisted settings, language helpers
 *   2. server           polling the Apps Script backend (+ status report)
 *   3. realtime         instant remote control through a pub/sub topic
 *   4. media cache      multi-cloud sources, native downloader, offline readiness
 *   5. views            splash, setup, pairing, home, selection, USB browser
 *   6. playback         the player, pause/seek/next/prev, transitions
 *   7. remote ops       what the phone can ask the screen to do
 *   8. updates          screen-app self update (download + install)
 *   9. boot
 */
(function () {
  'use strict';

  var C = window.DR;
  var N = window.Native || null;
  var STORE_KEY = 'dr_screen_v2';

  function $(selector) { return document.querySelector(selector); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }


  /* ================================================================ */
  /* 1. state                                                          */
  /* ================================================================ */

  var VERSION = { code: 0, name: '' };
  if (N && N.version) {
    try { VERSION = JSON.parse(N.version()); } catch (e) { /* keep defaults */ }
  }

  var S = loadState();

  function loadState() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!saved && N) {
      try { saved = JSON.parse(N.getPref(STORE_KEY) || 'null'); } catch (e) { /* ignore */ }
    }
    return Object.assign({
      lang: 'en', dev: null, secret: null, rt: null,
      linked: false, linkExp: 0, manifest: null, cmdRev: 0,
      play: null, local: null, upd: null,
      ui: { loopAll: true, loopSel: true }
    }, saved || {});
  }

  function save() {
    var json = JSON.stringify(S);
    try { localStorage.setItem(STORE_KEY, json); } catch (e) { /* ignore */ }
    if (N) {
      try { N.setPref(STORE_KEY, json); } catch (e) { /* ignore */ }
    }
  }

  function lang() { return S.lang === 'ar' ? 'ar' : 'en'; }
  function L(en, ar) { return lang() === 'ar' ? ar : en; }

  function applyLang() {
    document.documentElement.lang = lang();
    document.documentElement.dir = lang() === 'ar' ? 'rtl' : 'ltr';
  }

  function icon(name) {
    var inner = (window.ICONS || {})[name];
    return inner ? '<svg class="ic" viewBox="0 0 24 24">' + inner + '</svg>' : '';
  }


  /* ================================================================ */
  /* 2. server                                                         */
  /* ================================================================ */

  function api(body, timeoutMs) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs || 20000);

    return fetch(C.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) { return response.json(); })
      .then(
        function (json) { clearTimeout(timer); return json; },
        function (error) { clearTimeout(timer); throw error; }
      );
  }

  /** Pulls the latest content list + commands and sends the status report. */
  function sync(done, timeoutMs) {
    if (!S.dev) {
      if (done) done(null);
      return;
    }

    api({ a: 'screen.poll', id: S.dev, secret: S.secret, rep: buildReport() }, timeoutMs)
      .then(function (r) {
        if (r.status === 'linked') {
          applyManifest(r);
        } else if (r.status === 'unknown' || r.status === 'expired') {
          unlinkLocal();
        }
        if (done) done(r);
      })
      .catch(function () { if (done) done(null); });
  }

  function applyManifest(r) {
    S.linked = true;
    S.linkExp = r.linkExp;
    S.manifest = r.manifest;
    S.rt = r.rt || S.rt;

    var newLang = r.manifest.cfg && r.manifest.cfg.lang;
    if (newLang && newLang !== S.lang) {
      S.lang = newLang;
      applyLang();
      if (view && view !== 'boot') render();
    }

    handleCmd(r.manifest.cmd);
    if (r.rc && r.serverTime - r.rc.t < 60000) handleRemote(r.rc);
    save();

    realtimeConnect();
    mediaSync();
    checkUpdate(r.manifest.cfg && r.manifest.cfg.update);

    if (playing() && queueSignature() !== pl.sig) restartPlay();
  }

  function handleCmd(cmd) {
    if (!cmd || !(cmd.rev > S.cmdRev)) return;
    S.cmdRev = cmd.rev;
    save();

    if (cmd.action === 'stop') {
      if (playing()) {
        stopPlay();
        go('home');
      }
    } else {
      startPlay({ mode: cmd.mode || 'all', ids: cmd.ids || [], loop: cmd.loop !== false });
    }
  }


  /* ================================================================ */
  /* 3. realtime (instant remote control)                              */
  /* ================================================================ */

  var rt = { source: null, topic: null, seen: {}, watchUntil: 0, ticker: null };

  function realtimeConnect() {
    if (!S.rt || !window.EventSource) return;
    if (rt.topic === S.rt && rt.source && rt.source.readyState !== 2) return;

    realtimeClose();
    rt.topic = S.rt;
    rt.source = new EventSource(C.RT_SERVER + '/' + S.rt + '/sse');

    rt.source.onmessage = function (event) {
      var wrapper;
      var message;
      try {
        wrapper = JSON.parse(event.data);
        message = JSON.parse(wrapper.message);
      } catch (e) {
        return;
      }
      handleRemote(message);
    };
    rt.source.onerror = function () {
      // The browser reconnects by itself; recreate only if it gave up.
      if (rt.source && rt.source.readyState === 2) {
        rt.topic = null;
        setTimeout(realtimeConnect, 4000);
      }
    };
  }

  function realtimeClose() {
    if (rt.source) {
      try { rt.source.close(); } catch (e) { /* ignore */ }
    }
    rt.source = null;
    rt.topic = null;
  }

  function handleRemote(message) {
    if (!message || !message.op) return;
    if (message.id) {
      if (rt.seen[message.id]) return;
      rt.seen[message.id] = Date.now();
      forgetOldIds();
    }
    runOp(message.op, message.arg);
  }

  function forgetOldIds() {
    var cutoff = Date.now() - 120000;
    Object.keys(rt.seen).forEach(function (id) {
      if (rt.seen[id] < cutoff) delete rt.seen[id];
    });
  }

  /** While the phone shows the remote page, the screen publishes what it is playing. */
  function publishStatus() {
    if (!S.rt || Date.now() > rt.watchUntil) return;
    try {
      fetch(C.RT_SERVER + '/' + S.rt + '-s', { method: 'POST', body: JSON.stringify(statusSnapshot()) });
    } catch (e) { /* best effort */ }
  }

  function startWatching() {
    rt.watchUntil = Date.now() + 120000;
    if (!rt.ticker) {
      rt.ticker = setInterval(function () {
        if (Date.now() > rt.watchUntil) {
          clearInterval(rt.ticker);
          rt.ticker = null;
          return;
        }
        publishStatus();
      }, 2000);
    }
    publishStatus();
  }

  function audioState() {
    if (!N || !N.volume) return { v: 0, max: 0, mute: false };
    try { return JSON.parse(N.volume('get')); } catch (e) { return { v: 0, max: 0, mute: false }; }
  }

  function statusSnapshot() {
    var queueNow = queue();
    var item = pl.on ? queueNow[pl.idx] : null;
    var audio = audioState();

    return {
      on: pl.on,
      n: item ? item.name : '',
      k: item ? item.k : '',
      i: pl.on ? pl.idx + 1 : 0,
      c: queueNow.length,
      p: pl.paused,
      t: pl.video ? pl.video.currentTime : 0,
      d: pl.video ? (pl.video.duration || 0) : 0,
      vol: audio.v,
      max: audio.max,
      mute: audio.mute,
      loop: !!(S.play && S.play.loop)
    };
  }


  /* ================================================================ */
  /* 4. media cache                                                    */
  /* ================================================================ */

  var cached = {};   // id -> bytes stored on the device

  function refreshCache() {
    if (!N) return;
    try {
      cached = {};
      JSON.parse(N.listMedia()).forEach(function (entry) { cached[entry.id] = entry.size; });
    } catch (e) { /* ignore */ }
  }

  window.__dl = function (id, done, total, state) {
    if (state === 'done') cached[id] = done;
  };

  function driveUrl(id) {
    return 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&key=' + C.DRIVE_API_KEY;
  }

  /** Every place a file can be downloaded from, in order of preference. */
  function sourceUrls(file) {
    var sources = file.src || [{ p: 'drive', id: file.id }];
    var urls = [];
    sources.forEach(function (source) {
      if (source.p === 'drive') urls.push(driveUrl(source.id));
      else if (source.url) urls.push(source.url);
    });
    return urls;
  }

  function isCached(id, size) {
    return !!cached[id] && (!size || cached[id] >= size);
  }

  function mediaUrl(item) {
    if (item.url) return item.url;
    if (!item.file) return null;
    if (isCached(item.file.id, item.file.size)) return '/media/' + item.file.id;
    if (navigator.onLine === false) return null;
    return sourceUrls(item.file)[0] || null;
  }

  window.RENDER.setResolver(function (src) {
    if (!src || src.indexOf('drive:') !== 0) return src;
    var id = src.slice(6);
    return cached[id] ? '/media/' + id : driveUrl(id);
  });

  /** Files one item needs in order to play without internet. */
  function itemFiles(item) {
    var files = [];
    if (item.file) {
      files.push({ id: item.file.id, size: item.file.size || 0, urls: sourceUrls(item.file) });
    }
    (item.assets || []).forEach(function (asset) {
      files.push({ id: asset.id, size: asset.size || 0, urls: [driveUrl(asset.id)] });
    });
    return files;
  }

  function wantList() {
    var wanted = [];
    var seen = {};
    ((S.manifest && S.manifest.items) || []).forEach(function (item) {
      itemFiles(item).forEach(function (file) {
        if (!seen[file.id]) {
          seen[file.id] = true;
          wanted.push(file);
        }
      });
    });
    return wanted;
  }

  function mediaSync() {
    if (!N) return;
    refreshCache();

    var keep = {};
    wantList().forEach(function (file) {
      keep[file.id] = true;
      if (!isCached(file.id, file.size)) {
        try { N.download(file.id, JSON.stringify(file.urls), file.size); } catch (e) { /* ignore */ }
      }
    });

    Object.keys(cached).forEach(function (id) {
      if (keep[id]) return;
      try { N.deleteMedia(id); } catch (e) { /* ignore */ }
      delete cached[id];
    });
  }

  /** Summary sent to the admin app: can this screen keep working offline? */
  function buildReport() {
    var items = (S.manifest && S.manifest.items) || [];
    var ready = 0;
    var needNet = 0;
    var bytes = 0;
    var totalBytes = 0;

    items.forEach(function (item) {
      if (item.k === 'gslides') {
        needNet++;
        return;
      }
      var files = itemFiles(item);
      var all = true;
      files.forEach(function (file) {
        totalBytes += file.size;
        if (isCached(file.id, file.size)) bytes += file.size;
        else all = false;
      });
      if (all) ready++;
    });

    var free = 0;
    if (N && N.freeBytes) {
      try { free = N.freeBytes(); } catch (e) { /* ignore */ }
    }

    return {
      v: VERSION.code, vn: VERSION.name,
      items: items.length, ready: ready, net: needNet,
      bytes: bytes, total: totalBytes, free: free,
      playing: pl.on, upd: S.upd ? S.upd.state : ''
    };
  }

  function activeNow(item) {
    var s = item.sched;
    if (!s) return true;

    var d = new Date();
    var ymd = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());

    if (s.from && ymd < s.from) return false;
    if (s.to && ymd > s.to) return false;
    if (s.t1 && s.t2) {
      if (s.t1 <= s.t2) {
        if (hm < s.t1 || hm >= s.t2) return false;
      } else if (hm < s.t1 && hm >= s.t2) {
        return false;
      }
    }
    return true;
  }


  /* ================================================================ */
  /* 5. views                                                          */
  /* ================================================================ */

  var view = null;
  var viewArg = null;
  var timers = [];

  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    timers = [];
  }

  function go(name, arg) {
    clearTimers();
    view = name;
    viewArg = arg;
    render();
  }

  function render() {
    applyLang();
    var root = $('#v');
    root.innerHTML = '';

    var builders = { boot: viewBoot, setup: viewSetup, pair: viewPair, home: viewHome, pick: viewPick, fs: viewFs };
    if (builders[view]) builders[view](root);

    var first = root.querySelector('.f');
    if (first) first.focus();
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function button(label, iconName, className, onClick) {
    var node = el('div', 'f btn ' + (className || ''), (iconName ? icon(iconName) : '') + '<span>' + label + '</span>');
    node.tabIndex = 0;
    node.onclick = onClick;
    return node;
  }

  function toggle(label, on, onChange) {
    var node = el('div', 'f toggle' + (on ? ' on' : ''), '<span>' + icon('repeat') + ' ' + label + '</span><div class="sw"></div>');
    node.tabIndex = 0;
    node.onclick = function () {
      var value = !node.classList.contains('on');
      node.classList.toggle('on', value);
      onChange(value);
    };
    return node;
  }

  function viewBoot(root) {
    root.appendChild(el('img', 'logo', null)).src = '/shared/brand/logo.png';
    root.appendChild(el('div', 'brand-ar', C.BRAND_AR));
    root.appendChild(el('div', 'brand-en', 'DUR AL-RAZI MEDICAL'));
    root.appendChild(el('div', 'spin'));
  }

  function viewSetup(root) {
    var row = el('div', 'row');
    row.appendChild(button(L('Link with code', 'الربط بالكود'), 'link', 'big', function () { go('pair'); }));
    row.appendChild(button(L('Media library', 'مكتبة المعروضات'), 'folder', 'big', openLibrary));
    root.appendChild(row);

    // Reserved for a future patient-list screen: visible but disabled.
    root.appendChild(el('div', 'btn small dis', icon('layers') + '<span>' + L('Patient list', 'قائمة المراجعين') + '</span>'));
  }

  function viewPair(root) {
    var codeBox = el('div', 'code', '--- --- ---');
    var spinner = el('div', 'spin');
    var back = button(L('Back', 'رجوع'), 'chevron-left', 'small', function () { go('setup'); });
    var started = false;

    root.appendChild(codeBox);
    root.appendChild(spinner);
    root.appendChild(back);
    back.focus();

    function format(code) {
      return code ? code.slice(0, 3) + ' ' + code.slice(3, 6) + ' ' + code.slice(6, 9) : '--- --- ---';
    }

    function onResponse(r) {
      if (view !== 'pair') return;
      if (r.status === 'linked') {
        S.linked = true;
        save();
        sync(function () { go('home'); });
        return;
      }
      if (r.status === 'unknown') {
        S.dev = null;
        S.secret = null;
        save();
        register();
        return;
      }
      if (r.code) {
        codeBox.textContent = format(r.code);
        spinner.style.display = 'none';
      }
    }

    function register() {
      api({ a: 'screen.register', id: S.dev, secret: S.secret })
        .then(function (r) {
          if (r.id) {
            S.dev = r.id;
            S.secret = r.secret;
            save();
          }
          started = true;
          onResponse(r);
        })
        .catch(function () { later(register, 5000); });
    }

    register();
    every(function () {
      if (!started || !S.dev) return;
      api({ a: 'screen.poll', id: S.dev, secret: S.secret }, 8000).then(onResponse).catch(function () { /* retry next tick */ });
    }, 3000);
  }

  function viewHome(root) {
    if (S.upd && S.upd.state === 'ready') {
      var banner = el('div', 'update-banner');
      banner.appendChild(el('div', 'ub-text', icon('download') + '<span>' + L('Update received', 'تم استقبال تحديث') + '</span>'));
      banner.appendChild(button(L('Install', 'تثبيت'), 'check', 'pri small', installUpdate));
      root.appendChild(banner);
    }

    var row = el('div', 'row');
    var playAll = el('div', 'group');
    playAll.appendChild(button(L('Play all content', 'عرض كل المحتوى'), 'tv', 'big pri', function () {
      startPlay({ mode: 'all', ids: [], loop: S.ui.loopAll });
    }));
    playAll.appendChild(toggle(L('Loop', 'تكرار'), S.ui.loopAll, function (value) {
      S.ui.loopAll = value;
      save();
    }));
    row.appendChild(playAll);
    row.appendChild(button(L('Play selected content', 'عرض محتوى محدد'), 'list-checks', 'big', function () {
      go('pick', { sel: {} });
    }));
    root.appendChild(row);

    var foot = el('div', 'foot');
    foot.appendChild(button(L('Unlink screen', 'فك الارتباط'), 'unlink', 'small', unlink));
    root.appendChild(foot);

    // The update install button should be the first thing focused.
    var firstFocusable = root.querySelector('.update-banner .f');
    if (firstFocusable) later(function () { firstFocusable.focus(); }, 50);
  }

  function kindIcon(kind) {
    return { video: 'film', image: 'image', text: 'type', pdf: 'file-text', gslides: 'presentation' }[kind] || 'file-text';
  }

  function kindName(kind) {
    return {
      video: L('Video', 'فيديو'), image: L('Image', 'صورة'), text: L('Text', 'نص'),
      pdf: 'PDF', gslides: L('Slides', 'شرائح')
    }[kind] || kind;
  }

  function viewPick(root) {
    var selected = (viewArg && viewArg.sel) || {};
    var items = ((S.manifest && S.manifest.items) || []).filter(activeNow);

    root.appendChild(el('div', 'title', L('Select content', 'اختر المحتوى')));

    var grid = el('div', 'grid');
    if (!items.length) grid.appendChild(el('div', 'hint', L('No content', 'لا يوجد محتوى')));

    items.forEach(function (item) {
      var tile = el('div', 'f tile' + (selected[item.id] ? ' sel' : ''),
        '<div class="ck">' + icon('check') + '</div><div>' + icon(kindIcon(item.k)) +
        '</div><div class="nm"></div><div class="tp">' + kindName(item.k) + '</div>');
      tile.querySelector('.nm').textContent = item.name || '';
      tile.tabIndex = 0;
      tile.onclick = function () {
        if (selected[item.id]) delete selected[item.id]; else selected[item.id] = 1;
        tile.classList.toggle('sel', !!selected[item.id]);
      };
      grid.appendChild(tile);
    });
    root.appendChild(grid);

    var row = el('div', 'row');
    row.appendChild(button('OK', 'check', 'pri', function () {
      var ids = Object.keys(selected);
      if (!ids.length) return;
      startPlay({ mode: 'selected', ids: ids, loop: S.ui.loopSel });
    }));
    row.appendChild(toggle(L('Loop', 'تكرار'), S.ui.loopSel, function (value) {
      S.ui.loopSel = value;
      save();
    }));
    row.appendChild(button(L('Back', 'رجوع'), 'chevron-left', 'small', function () { go('home'); }));
    root.appendChild(row);

    var first = grid.querySelector('.f') || row.querySelector('.f');
    if (first) first.focus();
  }

  /* ---- local media library (USB / internal storage) ---- */

  function openLibrary() {
    if (N) {
      try { N.pickLocal(); return; } catch (e) { /* fall through to the built-in browser */ }
    }
    go('fs', { path: '/storage' });
  }

  window.__picked = function (json) {
    var items = [];
    try { items = JSON.parse(json); } catch (e) { /* ignore */ }

    if (!items.length) {
      if (view !== 'fs') go('setup');
      return;
    }
    S.local = { items: items };
    startPlay({ mode: 'local', ids: [], loop: true });
  };

  window.__pickFail = function () { go('fs', { path: '/storage' }); };

  function viewFs(root) {
    var path = (viewArg && viewArg.path) || '/storage';
    var data = { entries: [] };
    try { data = JSON.parse(N.listDir(path)); } catch (e) { /* ignore */ }

    root.appendChild(el('div', 'title', path));
    var list = el('div', 'list');

    if (data.perm === false) {
      list.appendChild(el('div', 'li', L('Allow file access, then press Back and try again', 'اسمح بالوصول للملفات ثم ارجع وحاول مجددا')));
    }

    var useFolder = button(L('Use this folder', 'استخدم هذا المجلد'), 'check', 'pri', function () {
      var found = [];
      try { found = JSON.parse(N.scanDir(path)); } catch (e) { /* ignore */ }
      window.__picked(JSON.stringify(found));
    });
    root.appendChild(useFolder);

    if (path !== '/storage' && path !== '/') {
      var up = el('div', 'f li', icon('chevron-left') + '<span>..</span>');
      up.tabIndex = 0;
      up.onclick = function () { go('fs', { path: path.replace(/\/[^\/]+\/?$/, '') || '/storage' }); };
      list.appendChild(up);
    }

    (data.entries || []).forEach(function (entry) {
      if (!entry.d) return;
      var row = el('div', 'f li', icon('folder') + '<span></span>');
      row.lastChild.textContent = entry.n;
      row.tabIndex = 0;
      row.onclick = function () { go('fs', { path: entry.p }); };
      list.appendChild(row);
    });

    root.appendChild(list);
    root.appendChild(button(L('Back', 'رجوع'), 'chevron-left', 'small', function () { go('setup'); }));
    useFolder.focus();
  }

  /* ---- link / unlink ---- */

  function unlink() {
    if (S.dev) {
      api({ a: 'screen.unlink', id: S.dev, secret: S.secret }, 8000).catch(function () { /* ignore */ });
    }
    unlinkLocal();
  }

  function unlinkLocal() {
    if (playing()) stopPlay();
    realtimeClose();

    Object.keys(cached).forEach(function (id) {
      try { N.deleteMedia(id); } catch (e) { /* ignore */ }
    });
    cached = {};

    S.dev = null;
    S.secret = null;
    S.rt = null;
    S.linked = false;
    S.manifest = null;
    S.play = null;
    S.cmdRev = 0;
    save();
    go('setup');
  }


  /* ================================================================ */
  /* 6. playback                                                       */
  /* ================================================================ */

  var pl = {
    on: false, run: 0, idx: -1, flip: 0, sig: '',
    paused: false, video: null, hold: null,
    cancel: null, finish: null, cleanup: null
  };

  function playing() { return pl.on; }

  /** Timer that can be paused and resumed (images, text, PDF pages). */
  function Hold() {
    this.timer = null;
    this.left = 0;
    this.began = 0;
    this.fn = null;
  }
  Hold.prototype.start = function (ms, fn) {
    this.clear();
    this.fn = fn;
    this.left = ms;
    if (!pl.paused) this.run();
  };
  Hold.prototype.run = function () {
    var self = this;
    this.began = Date.now();
    this.timer = setTimeout(function () {
      var callback = self.fn;
      self.timer = null;
      self.fn = null;
      if (callback) callback();
    }, this.left);
  };
  Hold.prototype.pause = function () {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.left -= Date.now() - this.began;
  };
  Hold.prototype.resume = function () { if (this.fn && !this.timer) this.run(); };
  Hold.prototype.clear = function () {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.fn = null;
  };

  function queue() {
    var play = S.play || {};
    var items;

    if (play.mode === 'local') {
      items = (S.local && S.local.items) || [];
    } else {
      items = ((S.manifest && S.manifest.items) || []).filter(activeNow);
    }
    if (play.mode === 'selected') {
      items = items.filter(function (item) { return (play.ids || []).indexOf(item.id) >= 0; });
    }
    return items;
  }

  function queueSignature() {
    return queue().map(function (item) { return item.id + ':' + (item.v || 0); }).join(',');
  }

  function startPlay(play) {
    S.play = play;
    save();
    clearTimers();

    pl.on = true;
    pl.paused = false;
    pl.run++;
    pl.idx = -1;
    pl.sig = queueSignature();

    $('#v').classList.add('hide');
    $('#player').classList.remove('hide');
    cycle(pl.run);
  }

  function restartPlay() {
    pl.sig = queueSignature();
    pl.run++;
    if (pl.cancel) pl.cancel();
    pl.idx = -1;
    cycle(pl.run);
  }

  function stopPlay() {
    pl.on = false;
    pl.paused = false;
    pl.run++;

    if (pl.cancel) pl.cancel();
    if (pl.cleanup) {
      try { pl.cleanup(); } catch (e) { /* ignore */ }
      pl.cleanup = null;
    }

    ['#L0', '#L1'].forEach(function (sel) {
      $(sel).innerHTML = '';
      $(sel).classList.remove('on');
    });
    $('#player').classList.add('hide');
    $('#v').classList.remove('hide');

    S.play = null;
    save();
    publishStatus();
  }

  function cycle(run) {
    if (run !== pl.run) return;

    var items = queue();
    if (!items.length) {
      setTimeout(function () { cycle(run); }, 5000);
      return;
    }

    pl.idx++;
    if (pl.idx < 0) pl.idx = items.length - 1;      // "previous" from the first item wraps around

    if (pl.idx >= items.length) {
      if (!S.play.loop) {
        stopPlay();
        go(S.linked ? 'home' : 'setup');
        return;
      }
      pl.idx = 0;
    }

    publishStatus();
    playItem(items[pl.idx], items.length === 1 && S.play.loop, function () { cycle(run); });
  }

  /** Cross-fades the new item in using two alternating layers. */
  function show(box) {
    var next = pl.flip ^ 1;
    var incoming = $('#L' + next);
    var outgoing = $('#L' + pl.flip);

    incoming.innerHTML = '';
    incoming.appendChild(box);
    incoming.classList.add('on');
    outgoing.classList.remove('on');
    pl.flip = next;

    var oldCleanup = pl.cleanup;
    pl.cleanup = null;
    setTimeout(function () {
      if (oldCleanup) {
        try { oldCleanup(); } catch (e) { /* ignore */ }
      }
      if (!outgoing.classList.contains('on')) outgoing.innerHTML = '';
    }, 900);
  }

  function playItem(item, single, onDone) {
    var finished = false;
    var cleanup = null;
    var hold = new Hold();
    pl.hold = hold;
    pl.video = null;

    function end(silent) {
      if (finished) return;
      finished = true;
      hold.clear();
      pl.cancel = null;
      pl.finish = null;
      pl.hold = null;
      pl.video = null;
      if (cleanup) pl.cleanup = cleanup;
      if (silent !== true) onDone();
    }

    pl.cancel = function () { end(true); };
    pl.finish = function () { end(); };

    function skip() { hold.start(1200, end); }

    var box = el('div');
    box.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center';
    var fit = item.fit || 'contain';
    var url;

    if (item.k === 'video') {
      url = mediaUrl(item);
      if (!url) return skip();

      var video = document.createElement('video');
      video.muted = !!item.mute;
      video.autoplay = !pl.paused;
      video.setAttribute('playsinline', '');
      video.style.objectFit = fit === 'fill' ? 'fill' : fit;
      if (single && !(item.te > 0) && !(item.ts > 0)) video.loop = true;
      pl.video = video;

      var shown = false;
      var stall = setTimeout(end, 25000);
      var showOnce = function () {
        if (!shown) {
          shown = true;
          show(box);
        }
      };

      video.addEventListener('loadeddata', showOnce);
      video.addEventListener('playing', function () { clearTimeout(stall); showOnce(); });
      video.addEventListener('loadedmetadata', function () {
        if (item.ts > 0) {
          try { video.currentTime = item.ts; } catch (e) { /* ignore */ }
        }
      });
      video.addEventListener('ended', function () { end(); });
      video.addEventListener('timeupdate', function () {
        if (item.te > 0 && video.currentTime >= item.te) end();
      });
      video.addEventListener('error', function () { clearTimeout(stall); hold.start(1500, end); });

      box.appendChild(video);
      video.src = url;
      if (!pl.paused) {
        var promise = video.play();
        if (promise && promise.catch) {
          promise.catch(function () {
            video.muted = true;
            try { video.play(); } catch (e) { /* ignore */ }
          });
        }
      }

      cleanup = function () {
        clearTimeout(stall);
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (e) { /* ignore */ }
      };
      setTimeout(showOnce, 4000);

    } else if (item.k === 'image') {
      url = mediaUrl(item);
      if (!url) return skip();

      var image = document.createElement('img');
      image.style.objectFit = fit === 'fill' ? 'fill' : fit;
      image.onload = function () {
        show(box);
        hold.start((item.dur || C.IMAGE_SEC) * 1000, end);
      };
      image.onerror = skip;
      box.appendChild(image);
      image.src = url;

    } else if (item.k === 'text') {
      var rendered = window.RENDER.build(item.td || {}, window.innerWidth, window.innerHeight, false);
      box.appendChild(rendered.wrap);
      show(box);
      hold.start((item.dur || C.TEXT_SEC) * 1000, end);

    } else if (item.k === 'pdf') {
      url = mediaUrl(item);
      if (!url || !window.pdfjsLib) return skip();

      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/shared/assets/pdf.worker.min.js';
      var canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.background = '#000';
      box.appendChild(canvas);

      var perPage = (item.pdur || C.PAGE_SEC) * 1000;
      var doc = null;
      var firstPage = true;

      var drawPage = function (number) {
        if (finished) return;
        if (number > doc.numPages) return end();

        doc.getPage(number).then(function (page) {
          var base = page.getViewport({ scale: 1 });
          var scale = Math.min(canvas.width / base.width, canvas.height / base.height);
          var viewport = page.getViewport({ scale: scale });
          var context = canvas.getContext('2d');

          context.fillStyle = item.pbg || '#000';
          context.fillRect(0, 0, canvas.width, canvas.height);
          return page.render({
            canvasContext: context,
            viewport: viewport,
            transform: [1, 0, 0, 1, (canvas.width - viewport.width) / 2, (canvas.height - viewport.height) / 2]
          }).promise;
        }).then(function () {
          if (firstPage) {
            firstPage = false;
            show(box);
          }
          hold.start(perPage, function () { drawPage(number + 1); });
        }).catch(skip);
      };

      window.pdfjsLib.getDocument(url).promise
        .then(function (loaded) { doc = loaded; drawPage(1); })
        .catch(skip);
      cleanup = function () {
        try { if (doc) doc.destroy(); } catch (e) { /* ignore */ }
      };

    } else if (item.k === 'gslides') {
      if (navigator.onLine === false || !item.sid) return skip();

      var frame = document.createElement('iframe');
      var delay = Math.max(2, item.pdur || C.PAGE_SEC) * 1000;
      frame.setAttribute('allow', 'autoplay; fullscreen');
      frame.src = 'https://docs.google.com/presentation/d/' + item.sid +
        '/embed?start=true&loop=false&rm=minimal&delayms=' + delay;
      box.appendChild(frame);
      show(box);
      hold.start((item.dur || 60) * 1000, end);
      cleanup = function () {
        try { frame.src = 'about:blank'; } catch (e) { /* ignore */ }
      };

    } else {
      skip();
    }
  }


  /* ================================================================ */
  /* 7. remote ops                                                     */
  /* ================================================================ */

  function setPaused(value) {
    pl.paused = value;
    if (pl.video) {
      if (value) pl.video.pause();
      else {
        var promise = pl.video.play();
        if (promise && promise.catch) promise.catch(function () { /* ignore */ });
      }
    }
    if (pl.hold) {
      if (value) pl.hold.pause(); else pl.hold.resume();
    }
  }

  function audio(op) {
    if (!N || !N.volume) return;
    try { N.volume(op); } catch (e) { /* ignore */ }
  }

  /** Every command the phone can send. Called both by the instant channel and the backup poll. */
  function runOp(op, arg) {
    switch (op) {
      case 'next':
        if (pl.on && pl.finish) pl.finish();
        break;
      case 'prev':
        if (pl.on && pl.finish) {
          pl.idx -= 2;
          pl.finish();
        }
        break;
      case 'restart':
        if (pl.on && pl.finish) {
          pl.idx -= 1;
          pl.finish();
        }
        break;
      case 'pause':
        if (pl.on) setPaused(true);
        break;
      case 'play':
        if (!pl.on) startPlay({ mode: 'all', ids: [], loop: true });
        else setPaused(false);
        break;
      case 'toggle':
        if (!pl.on) startPlay({ mode: 'all', ids: [], loop: true });
        else setPaused(!pl.paused);
        break;
      case 'seek':
        if (pl.video) {
          try { pl.video.currentTime = Math.max(0, pl.video.currentTime + (Number(arg) || 0)); } catch (e) { /* ignore */ }
        }
        break;
      case 'mute': audio('mute'); break;
      case 'unmute': audio('unmute'); break;
      case 'volup': audio('up'); break;
      case 'voldown': audio('down'); break;
      case 'stop':
        if (pl.on) {
          stopPlay();
          go('home');
        }
        break;
      case 'sync': sync(); break;
      case 'watch': startWatching(); break;
      case 'reload': location.reload(); break;
      case 'exit':
        if (N && N.exitApp) N.exitApp();
        break;
      default: break;
    }
    setTimeout(publishStatus, 150);
  }


  /* ================================================================ */
  /* 8. updates (screen app updates itself, announced by the phone)    */
  /* ================================================================ */

  function checkUpdate(update) {
    if (!N || !N.downloadUpdate) return;

    if (!update || update.v <= VERSION.code) {
      if (S.upd) {
        S.upd = null;
        save();
      }
      return;
    }
    if (S.upd && S.upd.v === update.v && S.upd.state !== 'failed') return;

    S.upd = { v: update.v, state: 'downloading', pct: 0 };
    save();
    try { N.downloadUpdate(JSON.stringify(update)); } catch (e) { S.upd.state = 'failed'; }
  }

  window.__upd = function (state, percent) {
    if (!S.upd) return;
    S.upd.state = state;
    S.upd.pct = percent;
    save();
    if (state === 'ready' && view === 'home') render();
  };

  function installUpdate() {
    if (N && N.installUpdate) {
      try { N.installUpdate(); } catch (e) { /* ignore */ }
    }
  }


  /* ================================================================ */
  /* remote-control keys (D-pad)                                       */
  /* ================================================================ */

  function focusables() {
    return [].slice.call(document.querySelectorAll('#v .f')).filter(function (node) { return node.offsetParent; });
  }

  function moveFocus(direction) {
    var current = document.activeElement;
    var list = focusables();

    if (list.indexOf(current) < 0) {
      if (list[0]) list[0].focus();
      return;
    }

    var box = current.getBoundingClientRect();
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var best = null;
    var bestScore = 1e9;

    list.forEach(function (node) {
      if (node === current) return;
      var r = node.getBoundingClientRect();
      var dx = r.left + r.width / 2 - cx;
      var dy = r.top + r.height / 2 - cy;
      var ok;
      var score;

      if (direction === 'R') { ok = dx > 4; score = dx + Math.abs(dy) * 2.2; }
      else if (direction === 'L') { ok = dx < -4; score = -dx + Math.abs(dy) * 2.2; }
      else if (direction === 'D') { ok = dy > 4; score = dy + Math.abs(dx) * 2.2; }
      else { ok = dy < -4; score = -dy + Math.abs(dx) * 2.2; }

      if (ok && score < bestScore) {
        bestScore = score;
        best = node;
      }
    });

    if (best) {
      best.focus();
      try { best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }

  function goBack() {
    if (playing()) {
      stopPlay();
      go(S.linked ? 'home' : 'setup');
      return;
    }
    if (view === 'pair' || view === 'fs') go('setup');
    else if (view === 'pick') go('home');
  }

  window.onNativeBack = goBack;

  document.addEventListener('keydown', function (event) {
    var key = event.key;
    var code = event.keyCode;
    var isBack = key === 'Escape' || key === 'Backspace' || key === 'GoBack' || code === 4 || code === 27 || code === 8;

    if (playing()) {
      if (isBack || key === 'Enter' || code === 13 || key === 'ContextMenu' || code === 82) {
        event.preventDefault();
        goBack();
      }
      return;
    }
    if (isBack) { event.preventDefault(); goBack(); return; }

    if (key === 'ArrowRight' || code === 39) { event.preventDefault(); moveFocus('R'); }
    else if (key === 'ArrowLeft' || code === 37) { event.preventDefault(); moveFocus('L'); }
    else if (key === 'ArrowDown' || code === 40) { event.preventDefault(); moveFocus('D'); }
    else if (key === 'ArrowUp' || code === 38) { event.preventDefault(); moveFocus('U'); }
    else if (key === 'Enter' || code === 13 || code === 23) {
      var active = document.activeElement;
      if (active && active.classList.contains('f')) {
        event.preventDefault();
        active.click();
      }
    }
  });


  /* ================================================================ */
  /* 9. boot                                                           */
  /* ================================================================ */

  function resumeLocal() {
    var items = (S.local && S.local.items) || [];
    if (items.length && items[0].url.indexOf('/fs') === 0) {
      startPlay(S.play);
      return;
    }
    if (N) {
      try { N.reloadLocal(); return; } catch (e) { /* fall through */ }
    }
    go('setup');
  }

  function route() {
    if (S.linked && S.dev) {
      if (S.play && S.play.mode !== 'local') startPlay(S.play);
      else go('home');
    } else if (S.play && S.play.mode === 'local' && S.local) {
      resumeLocal();
    } else {
      go('setup');
    }
  }

  function boot() {
    applyLang();
    go('boot');
    refreshCache();

    var startedAt = Date.now();
    function finish() {
      setTimeout(route, Math.max(0, 2500 - (Date.now() - startedAt)));
    }

    if (S.dev && S.linked) sync(finish, 6000); else finish();
    if (S.rt) realtimeConnect();

    setInterval(function () {
      if (S.dev && S.linked) sync();
    }, (C.POLL_SEC || 60) * 1000);

    window.addEventListener('online', function () {
      if (S.dev && S.linked) {
        sync();
        realtimeConnect();
      }
    });
  }

  boot();
})();
