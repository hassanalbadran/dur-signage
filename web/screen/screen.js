/* Dur Al-Razi — screen player. Remote-control (D-pad) navigation only. ES6 without async/await for old WebViews. */
(function () {
  'use strict';
  var C = window.DR, N = window.Native || null, LS = 'dr_screen_v1';
  var $ = function (s) { return document.querySelector(s); };

  /* ---------- state ---------- */
  var S = load();
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
    if (!s && N) { try { s = JSON.parse(N.getPref(LS) || 'null'); } catch (e) {} }
    return Object.assign({ lang: 'en', dev: null, secret: null, linked: false, linkExp: 0, manifest: null, cmdRev: 0, play: null, local: null, ui: { loopAll: true, loopSel: true } }, s || {});
  }
  function save() {
    var j = JSON.stringify(S);
    try { localStorage.setItem(LS, j); } catch (e) {}
    if (N) { try { N.setPref(LS, j); } catch (e) {} }
  }
  var lang = function () { return S.lang === 'ar' ? 'ar' : 'en'; };
  var L = function (en, ar) { return lang() === 'ar' ? ar : en; };
  function applyLang() { document.documentElement.lang = lang(); document.documentElement.dir = lang() === 'ar' ? 'rtl' : 'ltr'; }
  function ic(n) { var i = (window.ICONS || {})[n]; return i ? '<svg class="ic" viewBox="0 0 24 24">' + i + '</svg>' : ''; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- server ---------- */
  function api(body, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
    return fetch(C.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(to); return j; }, function (e) { clearTimeout(to); throw e; });
  }

  /* ---------- media cache (native downloader) ---------- */
  var cached = {};
  function refreshCache() {
    if (!N) return;
    try { var a = JSON.parse(N.listMedia()); cached = {}; a.forEach(function (x) { cached[x.id] = x.size; }); } catch (e) {}
  }
  window.__dl = function (id, done, total, state) { if (state === 'done') cached[id] = done; };
  function driveUrl(id) { return 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&key=' + C.DRIVE_API_KEY; }
  function assetUrl(id) { return cached[id] ? '/media/' + id : driveUrl(id); }
  function mediaUrl(it) {
    if (it.url) return it.url;
    if (!it.file) return null;
    var id = it.file.id;
    if (cached[id] && (!it.file.size || cached[id] >= it.file.size)) return '/media/' + id;
    return navigator.onLine === false ? null : driveUrl(id);
  }
  window.RENDER.setResolver(function (s) { return s && s.indexOf('drive:') === 0 ? assetUrl(s.slice(6)) : s; });

  function wantList() {
    var m = S.manifest; if (!m) return [];
    var out = [], seen = {};
    function add(id, size) { if (id && !seen[id]) { seen[id] = 1; out.push({ id: id, size: size || 0 }); } }
    (m.items || []).forEach(function (i) { if (i.file) add(i.file.id, i.file.size); (i.assets || []).forEach(function (a) { add(a.id, a.size); }); });
    return out;
  }
  function mediaSync() {
    if (!N) return;
    refreshCache();
    var want = wantList(), ids = {};
    want.forEach(function (w) {
      ids[w.id] = 1;
      if (!cached[w.id] || (w.size && cached[w.id] < w.size)) { try { N.download(w.id, driveUrl(w.id), w.size); } catch (e) {} }
    });
    Object.keys(cached).forEach(function (id) { if (!ids[id]) { try { N.deleteMedia(id); } catch (e) {} delete cached[id]; } });
  }

  /* ---------- schedule ---------- */
  function active(it) {
    var s = it.sched; if (!s) return true;
    var d = new Date(), ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
    if (s.from && ymd < s.from) return false;
    if (s.to && ymd > s.to) return false;
    if (s.t1 && s.t2) {
      if (s.t1 <= s.t2) { if (hm < s.t1 || hm >= s.t2) return false; }
      else if (hm < s.t1 && hm >= s.t2) return false;
    }
    return true;
  }

  /* ---------- views ---------- */
  var view = null, viewArg = null, timers = [];
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = []; }
  function go(v, arg) { clearTimers(); view = v; viewArg = arg; render(); }
  function render() {
    applyLang();
    var el = $('#v'); el.innerHTML = '';
    var map = { boot: vBoot, setup: vSetup, pair: vPair, home: vHome, pick: vPick, fs: vFs };
    if (map[view]) map[view](el);
    var f = el.querySelector('.f'); if (f) f.focus();
  }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function btn(label, icon, cls, fn) {
    var b = h('div', 'f btn ' + (cls || ''), (icon ? ic(icon) : '') + '<span>' + label + '</span>');
    b.tabIndex = 0; b.onclick = fn; return b;
  }
  function toggle(label, on, fn) {
    var t = h('div', 'f toggle' + (on ? ' on' : ''), '<span>' + ic('repeat') + ' ' + label + '</span><div class="sw"></div>');
    t.tabIndex = 0; t.onclick = function () { var v = !t.classList.contains('on'); t.classList.toggle('on', v); fn(v); }; return t;
  }

  function vBoot(el) {
    el.appendChild(h('div', 'logo', ic('heart-pulse').replace('class="ic"', 'class="ic logo"')));
    el.appendChild(h('div', 'brand', C.BRAND_AR));
    el.appendChild(h('div', 'spin'));
  }

  function vSetup(el) {
    var row = h('div', 'row');
    row.appendChild(btn(L('Link with code', 'الربط بالكود'), 'link', 'big', function () { go('pair'); }));
    row.appendChild(btn(L('Media library', 'مكتبة المعروضات'), 'folder', 'big', openLibrary));
    el.appendChild(row);
    var d = h('div', 'btn small dis', ic('layers') + '<span>' + L('Patient list', 'قائمة المراجعين') + '</span>');
    el.appendChild(d);
  }

  function vPair(el) {
    var codeEl = h('div', 'code', '--- --- ---');
    var spin = h('div', 'spin');
    el.appendChild(codeEl); el.appendChild(spin);
    var back = btn(L('Back', 'رجوع'), 'chevron-left', 'small', function () { go('setup'); });
    el.appendChild(back); back.focus();
    function fmt(c) { return c ? c.slice(0, 3) + ' ' + c.slice(3, 6) + ' ' + c.slice(6, 9) : '--- --- ---'; }
    var started = false;
    function onResp(r) {
      if (view !== 'pair') return;
      if (r.status === 'linked') { S.linked = true; save(); sync(function () { go('home'); }); return; }
      if (r.status === 'unknown') { S.dev = null; S.secret = null; save(); register(); return; }
      if (r.code) { codeEl.textContent = fmt(r.code); spin.style.display = 'none'; }
    }
    function register() {
      api({ a: 'screen.register', id: S.dev, secret: S.secret }).then(function (r) {
        if (r.id) { S.dev = r.id; S.secret = r.secret; save(); }
        started = true; onResp(r);
      }).catch(function () { later(register, 5000); });
    }
    register();
    every(function () {
      if (!started || !S.dev) return;
      api({ a: 'screen.poll', id: S.dev, secret: S.secret }, 8000).then(onResp).catch(function () {});
    }, 3000);
  }

  function vHome(el) {
    var row = h('div', 'row');
    var g1 = h('div', 'group');
    g1.appendChild(btn(L('Play all content', 'عرض كل المحتوى'), 'monitor-play', 'big pri', function () { startPlay({ mode: 'all', ids: [], loop: S.ui.loopAll }); }));
    g1.appendChild(toggle(L('Loop', 'تكرار'), S.ui.loopAll, function (v) { S.ui.loopAll = v; save(); }));
    row.appendChild(g1);
    row.appendChild(btn(L('Play selected content', 'عرض محتوى محدد'), 'list-checks', 'big', function () { go('pick', { sel: {} }); }));
    el.appendChild(row);
    var foot = h('div', 'foot');
    foot.appendChild(btn(L('Unlink screen', 'فك الارتباط'), 'unlink', 'small', unlink));
    el.appendChild(foot);
  }

  function kindIcon(k) { return { video: 'film', image: 'image', text: 'type', pdf: 'file-text', gslides: 'presentation' }[k] || 'file-text'; }
  function kindName(k) { return { video: L('Video', 'فيديو'), image: L('Image', 'صورة'), text: L('Text', 'نص'), pdf: 'PDF', gslides: L('Slides', 'شرائح') }[k] || k; }

  function vPick(el) {
    var sel = (viewArg && viewArg.sel) || {};
    var items = ((S.manifest && S.manifest.items) || []).filter(active);
    el.appendChild(h('div', 'title', L('Select content', 'اختر المحتوى')));
    var grid = h('div', 'grid');
    if (!items.length) grid.appendChild(h('div', 'hint', L('No content', 'لا يوجد محتوى')));
    items.forEach(function (it) {
      var t = h('div', 'f tile' + (sel[it.id] ? ' sel' : ''), '<div class="ck">' + ic('check') + '</div><div>' + ic(kindIcon(it.k)) + '</div><div class="nm"></div><div class="tp">' + kindName(it.k) + '</div>');
      t.querySelector('.nm').textContent = it.name || '';
      t.tabIndex = 0;
      t.onclick = function () { if (sel[it.id]) delete sel[it.id]; else sel[it.id] = 1; t.classList.toggle('sel', !!sel[it.id]); };
      grid.appendChild(t);
    });
    el.appendChild(grid);
    var row = h('div', 'row');
    row.appendChild(btn('OK', 'check', 'pri', function () {
      var ids = Object.keys(sel); if (!ids.length) return;
      startPlay({ mode: 'selected', ids: ids, loop: S.ui.loopSel });
    }));
    row.appendChild(toggle(L('Loop', 'تكرار'), S.ui.loopSel, function (v) { S.ui.loopSel = v; save(); }));
    row.appendChild(btn(L('Back', 'رجوع'), 'chevron-left', 'small', function () { go('home'); }));
    el.appendChild(row);
    var f = grid.querySelector('.f') || row.querySelector('.f'); if (f) f.focus();
  }

  /* ---------- local media library (USB / internal storage) ---------- */
  function openLibrary() {
    if (N) { try { N.pickLocal(); return; } catch (e) {} }
    go('fs', { path: '/storage' });
  }
  window.__picked = function (json) {
    var items = []; try { items = JSON.parse(json); } catch (e) {}
    if (!items.length) { if (view !== 'fs') go('setup'); return; }
    S.local = { items: items };
    startPlay({ mode: 'local', ids: [], loop: true });
  };
  window.__pickFail = function () { go('fs', { path: '/storage' }); };

  function vFs(el) {
    var path = (viewArg && viewArg.path) || '/storage', data = { entries: [] };
    try { data = JSON.parse(N.listDir(path)); } catch (e) {}
    el.appendChild(h('div', 'title', path));
    var list = h('div', 'list');
    if (data.perm === false) list.appendChild(h('div', 'li', L('Allow file access, then press Back and try again', 'اسمح بالوصول للملفات ثم ارجع وحاول مجددا')));
    var top = btn(L('Use this folder', 'استخدم هذا المجلد'), 'check', 'pri', function () {
      var r = []; try { r = JSON.parse(N.scanDir(path)); } catch (e) {}
      window.__picked(JSON.stringify(r));
    });
    el.appendChild(top);
    if (path !== '/storage' && path !== '/') {
      var up = h('div', 'f li', ic('chevron-left') + '<span>..</span>'); up.tabIndex = 0;
      up.onclick = function () { go('fs', { path: path.replace(/\/[^\/]+\/?$/, '') || '/storage' }); }; list.appendChild(up);
    }
    (data.entries || []).forEach(function (en) {
      if (!en.d) return;
      var li = h('div', 'f li', ic('folder') + '<span></span>'); li.lastChild.textContent = en.n; li.tabIndex = 0;
      li.onclick = function () { go('fs', { path: en.p }); }; list.appendChild(li);
    });
    el.appendChild(list);
    el.appendChild(btn(L('Back', 'رجوع'), 'chevron-left', 'small', function () { go('setup'); }));
    top.focus();
  }

  /* ---------- link / unlink ---------- */
  function unlink() {
    if (S.dev) api({ a: 'screen.unlink', id: S.dev, secret: S.secret }, 8000).catch(function () {});
    unlinkLocal();
  }
  function unlinkLocal() {
    if (playing()) stopPlay(true);
    Object.keys(cached).forEach(function (id) { try { N.deleteMedia(id); } catch (e) {} });
    cached = {};
    S.dev = null; S.secret = null; S.linked = false; S.manifest = null; S.play = null; S.cmdRev = 0; save();
    go('setup');
  }

  /* ---------- sync with server ---------- */
  function sync(cb, ms) {
    if (!S.dev) { if (cb) cb(null); return; }
    api({ a: 'screen.poll', id: S.dev, secret: S.secret }, ms).then(function (r) {
      if (r.status === 'linked') {
        S.linked = true; S.linkExp = r.linkExp; S.manifest = r.manifest;
        var nl = r.manifest.cfg && r.manifest.cfg.lang;
        if (nl && nl !== S.lang) { S.lang = nl; applyLang(); if (view && view !== 'boot') render(); }
        handleCmd(r.manifest.cmd);
        save(); mediaSync();
        if (playing() && queueSig() !== pl.sig) restartPlay();
      } else if (r.status === 'unknown' || r.status === 'expired') { unlinkLocal(); }
      if (cb) cb(r);
    }).catch(function () { if (cb) cb(null); });
  }
  function handleCmd(c) {
    if (!c || !(c.rev > S.cmdRev)) return;
    S.cmdRev = c.rev; save();
    if (c.action === 'stop') { if (playing()) { stopPlay(); go('home'); } }
    else startPlay({ mode: c.mode || 'all', ids: c.ids || [], loop: c.loop !== false });
  }

  /* ---------- playback ---------- */
  var pl = { run: 0, idx: -1, cancel: null, flip: 0, sig: '', prev: null, on: false };
  function playing() { return pl.on; }
  function queue() {
    var p = S.play || {};
    var items = p.mode === 'local' ? ((S.local && S.local.items) || []) : ((S.manifest && S.manifest.items) || []).filter(active);
    if (p.mode === 'selected') items = items.filter(function (i) { return (p.ids || []).indexOf(i.id) >= 0; });
    return items;
  }
  function queueSig() { return queue().map(function (i) { return i.id + ':' + (i.v || 0); }).join(','); }

  function startPlay(p) {
    S.play = p; save();
    clearTimers();
    pl.on = true; pl.run++; pl.idx = -1; pl.sig = queueSig();
    $('#v').classList.add('hide'); $('#player').classList.remove('hide');
    cycle(pl.run);
  }
  function restartPlay() { pl.sig = queueSig(); pl.run++; if (pl.cancel) pl.cancel(); pl.idx = -1; cycle(pl.run); }
  function stopPlay(silent) {
    pl.on = false; pl.run++;
    if (pl.cancel) pl.cancel();
    if (pl.prev) { try { pl.prev(); } catch (e) {} pl.prev = null; }
    $('#L0').innerHTML = ''; $('#L1').innerHTML = ''; $('#L0').classList.remove('on'); $('#L1').classList.remove('on');
    $('#player').classList.add('hide'); $('#v').classList.remove('hide');
    S.play = null; save();
  }
  function cycle(run) {
    if (run !== pl.run) return;
    var q = queue();
    if (!q.length) { setTimeout(function () { cycle(run); }, 5000); return; }
    pl.idx++;
    if (pl.idx >= q.length) {
      if (!S.play.loop) { stopPlay(); S.play = null; save(); go(S.linked ? 'home' : 'setup'); return; }
      pl.idx = 0;
    }
    playItem(q[pl.idx], q.length === 1 && S.play.loop, function () { cycle(run); });
  }
  function show(box) {
    var nxt = pl.flip ^ 1, a = $('#L' + nxt), b = $('#L' + pl.flip);
    a.innerHTML = ''; a.appendChild(box); a.classList.add('on'); b.classList.remove('on');
    pl.flip = nxt;
    var old = pl.prev; pl.prev = null;
    setTimeout(function () { if (old) { try { old(); } catch (e) {} } if (!b.classList.contains('on')) b.innerHTML = ''; }, 900);
  }
  function playItem(it, single, cb) {
    var fin = false, tm = null, cleanup = null;
    function end(silent) {
      if (fin) return; fin = true; clearTimeout(tm); pl.cancel = null;
      if (cleanup) pl.prev = cleanup;
      if (silent !== true) cb();
    }
    pl.cancel = function () { end(true); };
    function skip() { tm = setTimeout(end, 1200); }
    var box = h('div'); box.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center';
    var fit = it.fit || 'contain', url;

    if (it.k === 'video') {
      url = mediaUrl(it); if (!url) return skip();
      var v = document.createElement('video');
      v.muted = !!it.mute; v.autoplay = true; v.setAttribute('playsinline', ''); v.style.objectFit = fit === 'fill' ? 'fill' : fit;
      if (single && !(it.te > 0) && !(it.ts > 0)) v.loop = true;
      var shown = false, stall = setTimeout(end, 25000);
      var showOnce = function () { if (!shown) { shown = true; show(box); } };
      v.addEventListener('loadeddata', showOnce);
      v.addEventListener('playing', function () { clearTimeout(stall); showOnce(); });
      v.addEventListener('loadedmetadata', function () { if (it.ts > 0) { try { v.currentTime = it.ts; } catch (e) {} } });
      v.addEventListener('ended', function () { end(); });
      v.addEventListener('timeupdate', function () { if (it.te > 0 && v.currentTime >= it.te) end(); });
      v.addEventListener('error', function () { clearTimeout(stall); tm = setTimeout(end, 1500); });
      box.appendChild(v); v.src = url;
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () { v.muted = true; try { v.play(); } catch (e) {} });
      cleanup = function () { clearTimeout(stall); try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} };
      setTimeout(showOnce, 4000);

    } else if (it.k === 'image') {
      url = mediaUrl(it); if (!url) return skip();
      var im = document.createElement('img'); im.style.objectFit = fit === 'fill' ? 'fill' : fit;
      im.onload = function () { show(box); tm = setTimeout(end, (it.dur || C.IMAGE_SEC) * 1000); };
      im.onerror = function () { skip(); };
      box.appendChild(im); im.src = url;

    } else if (it.k === 'text') {
      var r = window.RENDER.build(it.td || {}, window.innerWidth, window.innerHeight, false);
      box.appendChild(r.wrap); show(box);
      tm = setTimeout(end, (it.dur || C.TEXT_SEC) * 1000);

    } else if (it.k === 'pdf') {
      url = mediaUrl(it); if (!url || !window.pdfjsLib) return skip();
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/shared/assets/pdf.worker.min.js';
      var cv = document.createElement('canvas'); cv.width = window.innerWidth; cv.height = window.innerHeight; cv.style.background = '#000';
      box.appendChild(cv);
      var per = (it.pdur || C.PAGE_SEC) * 1000, doc = null, first = true;
      var drawPage = function (n) {
        if (fin) return;
        if (n > doc.numPages) return end();
        doc.getPage(n).then(function (pg) {
          var vp = pg.getViewport({ scale: 1 }), sc = Math.min(cv.width / vp.width, cv.height / vp.height);
          var vp2 = pg.getViewport({ scale: sc }), ctx = cv.getContext('2d');
          ctx.fillStyle = it.pbg || '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
          return pg.render({ canvasContext: ctx, viewport: vp2, transform: [1, 0, 0, 1, (cv.width - vp2.width) / 2, (cv.height - vp2.height) / 2] }).promise;
        }).then(function () {
          if (first) { first = false; show(box); }
          tm = setTimeout(function () { drawPage(n + 1); }, per);
        }).catch(function () { skip(); });
      };
      window.pdfjsLib.getDocument(url).promise.then(function (d) { doc = d; drawPage(1); }).catch(function () { skip(); });
      cleanup = function () { try { if (doc) doc.destroy(); } catch (e) {} };

    } else if (it.k === 'gslides') {
      if (navigator.onLine === false || !it.sid) return skip();
      var ifr = document.createElement('iframe'), delay = Math.max(2, it.pdur || C.PAGE_SEC) * 1000;
      ifr.setAttribute('allow', 'autoplay; fullscreen');
      ifr.src = 'https://docs.google.com/presentation/d/' + it.sid + '/embed?start=true&loop=false&rm=minimal&delayms=' + delay;
      box.appendChild(ifr); show(box);
      tm = setTimeout(end, (it.dur || 60) * 1000);
      cleanup = function () { try { ifr.src = 'about:blank'; } catch (e) {} };
    } else { skip(); }
  }

  /* ---------- remote control ---------- */
  function focusables() { return [].slice.call(document.querySelectorAll('#v .f')).filter(function (e) { return e.offsetParent; }); }
  function move(dir) {
    var cur = document.activeElement, list = focusables();
    if (list.indexOf(cur) < 0) { if (list[0]) list[0].focus(); return; }
    var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, best = null, bd = 1e9;
    list.forEach(function (e) {
      if (e === cur) return;
      var q = e.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy, ok, d;
      if (dir === 'R') { ok = dx > 4; d = dx + Math.abs(dy) * 2.2; }
      else if (dir === 'L') { ok = dx < -4; d = -dx + Math.abs(dy) * 2.2; }
      else if (dir === 'D') { ok = dy > 4; d = dy + Math.abs(dx) * 2.2; }
      else { ok = dy < -4; d = -dy + Math.abs(dx) * 2.2; }
      if (ok && d < bd) { bd = d; best = e; }
    });
    if (best) { best.focus(); try { best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
  }
  function doBack() {
    if (playing()) { stopPlay(); go(S.linked ? 'home' : 'setup'); return; }
    if (view === 'pair' || view === 'fs') go('setup');
    else if (view === 'pick') go('home');
  }
  window.onNativeBack = doBack;
  document.addEventListener('keydown', function (e) {
    var k = e.key, c = e.keyCode;
    var back = k === 'Escape' || k === 'Backspace' || k === 'GoBack' || c === 4 || c === 27 || c === 8;
    if (playing()) {
      if (back || k === 'Enter' || c === 13 || k === 'ContextMenu' || c === 82) { e.preventDefault(); stopPlay(); go(S.linked ? 'home' : 'setup'); }
      return;
    }
    if (back) { e.preventDefault(); doBack(); return; }
    if (k === 'ArrowRight' || c === 39) { e.preventDefault(); move('R'); }
    else if (k === 'ArrowLeft' || c === 37) { e.preventDefault(); move('L'); }
    else if (k === 'ArrowDown' || c === 40) { e.preventDefault(); move('D'); }
    else if (k === 'ArrowUp' || c === 38) { e.preventDefault(); move('U'); }
    else if (k === 'Enter' || c === 13 || c === 23) { var a = document.activeElement; if (a && a.classList.contains('f')) { e.preventDefault(); a.click(); } }
  });

  /* ---------- boot ---------- */
  function resumeLocal() {
    var items = (S.local && S.local.items) || [];
    if (items.length && items[0].url.indexOf('/fs') === 0) return startPlay(S.play);
    if (N) { try { N.reloadLocal(); return; } catch (e) {} }
    go('setup');
  }
  function route() {
    if (S.linked && S.dev) {
      if (S.play && S.play.mode !== 'local') startPlay(S.play); else go('home');
    } else if (S.play && S.play.mode === 'local' && S.local) resumeLocal();
    else go('setup');
  }
  function boot() {
    applyLang(); go('boot'); refreshCache();
    var t0 = Date.now();
    var finish = function () { setTimeout(route, Math.max(0, 2500 - (Date.now() - t0))); };
    if (S.dev && S.linked) sync(finish, 6000); else finish();
    setInterval(function () { if (S.dev && S.linked) sync(); }, (C.POLL_SEC || 60) * 1000);
    window.addEventListener('online', function () { if (S.dev && S.linked) sync(); });
  }
  boot();
})();
