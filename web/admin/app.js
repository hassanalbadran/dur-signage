/* Dur Al-Razi — admin app (PWA). Library, screens control, uploads, settings. */
(function () {
  'use strict';
  var C = window.DR, Drive = window.Drive, UI = window.UI, L = UI.L, ic = UI.ic, h = UI.h;
  var root = document.getElementById('app');
  var A = { items: [], devices: [], cfg: {}, email: '', skew: 0, tab: 'lib', content: null, sw: null };
  var rid = function () { return Math.random().toString(36).slice(2, 11); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var nowS = function () { return Date.now() + A.skew; };

  window.RENDER.setResolver(function (s) { return s && s.indexOf('drive:') === 0 ? Drive.fileUrl(s.slice(6)) : s; });

  /* ---------- server ---------- */
  function api(a, d) {
    return Drive.token().then(function (t) {
      return fetch(C.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ a: a, tok: t }, d || {})) });
    }).then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error); return j; });
  }
  function refresh() {
    return api('admin.state').then(function (r) {
      A.items = r.items || []; A.devices = r.devices || []; A.cfg = r.cfg || {}; A.email = r.email || ''; A.skew = (r.now || Date.now()) - Date.now();
    });
  }
  function explain(e) {
    var m = (e && e.message) || String(e), r = e && e.reason, s = e && e.status;
    if (m === 'NET' || /Failed to fetch|NetworkError|Load failed/i.test(m)) return L('No internet connection', 'لا يوجد اتصال بالإنترنت');
    if (r === 'storageQuotaExceeded' || /quota/i.test(m)) return L('Google Drive storage is full', 'مساحة كوكل درايف ممتلئة');
    if (m === 'not_allowed') return L('This Google account is not allowed to manage the screens', 'هذا الحساب غير مصرح له بإدارة الشاشات');
    if (s === 401 || m === 'AUTH' || /^auth_/.test(m)) return L('Sign-in expired, please sign in again', 'انتهت صلاحية تسجيل الدخول، سجّلي الدخول مرة أخرى');
    if (m === 'code_invalid') return L('The code is wrong or has expired', 'الكود غير صحيح أو منتهي الصلاحية');
    if (m === 'CANCELLED') return L('Cancelled', 'تم الإلغاء');
    if (m === 'EMPTY') return L('The file is empty', 'الملف فارغ');
    if (s === 403) return L('Google refused the request (check Drive API settings)', 'رفضت كوكل الطلب (راجعي إعدادات Drive API)');
    if (s === 404 || s === 410) return L('Upload session expired, retry', 'انتهت جلسة الرفع، أعيدي المحاولة');
    return m;
  }

  /* ---------- helpers ---------- */
  function kindName(k) { return { video: L('Video', 'فيديو'), image: L('Image', 'صورة'), text: L('Text', 'نص'), pdf: 'PDF', gslides: L('Slides', 'شرائح') }[k] || k; }
  function kindIcon(k) { return { video: 'film', image: 'image', text: 'type', pdf: 'file-text', gslides: 'presentation' }[k] || 'file-text'; }
  function devName(id) { var d = A.devices.filter(function (x) { return x.id === id; })[0]; return d ? (d.name || id) : '?'; }
  function targetsText(it) {
    if (it.targets === 'all' || !it.targets) return L('All screens', 'كل الشاشات');
    return it.targets.map(devName).join(', ') || '-';
  }
  function field(label, ctrl) { return h('div', { class: 'field' }, h('label', { text: label }), ctrl); }
  function sw(on, fn) { var b = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: function () { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); fn(on); } }, h('i')); return b; }
  function seg(opts, cur, fn) {
    var box = h('div', { class: 'segc' });
    opts.forEach(function (o) {
      var b = h('button', { class: o[0] === cur ? 'on' : '', text: o[1], onclick: function () { [].forEach.call(box.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); fn(o[0]); } });
      box.appendChild(b);
    });
    return box;
  }
  function empty(t, s) { return h('div', { class: 'empty' }, h('div', { class: 'ico', html: ic('film') }), h('div', { class: 't', text: t }), h('div', { class: 's', text: s })); }
  function upsertLocal(it) { var i = -1; A.items.forEach(function (q, n) { if (q.id === it.id) i = n; }); if (i >= 0) A.items[i] = it; else A.items.push(it); }
  function dataToFile(src, name) {
    var p = src.split(','), mime = /data:([^;]+)/.exec(p[0])[1], bin = atob(p[1]), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], name + '-' + Date.now() + '.' + (mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1]), { type: mime });
  }

  /* ---------- splash / login / errors ---------- */
  function brandBlock() { return [h('div', { class: 'logo', html: ic('heart-pulse') }), h('div', { class: 'brand', text: L(C.BRAND_EN, C.BRAND_AR) })]; }
  function splash(sub, spin) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'splash' }, brandBlock(), sub ? h('div', { class: 'welcome', text: sub }) : null, spin ? h('div', { class: 'spin' }) : null));
  }
  function loginView(msg) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'splash' }, brandBlock(),
      h('div', { class: 'hint', text: L('Sign in with Google to continue', 'سجّلي الدخول بحساب كوكل للمتابعة') }),
      msg ? h('div', { class: 'err', text: msg }) : null,
      h('button', { class: 'btn pri', html: ic('cloud') + '<span>' + L('Sign in with Google', 'تسجيل الدخول بحساب كوكل') + '</span>',
        onclick: function () { Drive.signIn().then(load).catch(function (e) { loginView(explain(e)); }); } })));
  }
  function fatal(e) {
    if (e && (e.message === 'AUTH' || /^auth_/.test(e.message))) return loginView();
    root.innerHTML = '';
    var acts = [h('button', { class: 'btn pri', html: ic('refresh-cw') + '<span>' + L('Try again', 'إعادة المحاولة') + '</span>', onclick: start })];
    if (e && e.message === 'not_allowed') acts.push(h('button', { class: 'btn', text: L('Use another account', 'استخدام حساب آخر'), onclick: function () { Drive.signOut(); loginView(); } }));
    root.appendChild(h('div', { class: 'splash' }, brandBlock(), h('div', { class: 'err', text: explain(e) }), h('div', { class: 'row' }, acts)));
  }

  function start() {
    UI.applyLang(); UI.applyTheme(); splash('', true);
    if (String(C.GAS_URL).indexOf('PASTE') === 0) return fatal(new Error('Edit web/shared/config.js first (GAS_URL, GOOGLE_CLIENT_ID, DRIVE_API_KEY)'));
    Drive.init().then(function () {
      var signed = false; try { signed = localStorage.getItem('dra_signed'); } catch (e) {}
      if (!signed) return loginView();
      return Drive.token().then(load, function () { loginView(); });
    }).catch(fatal);
  }
  function load() {
    var t0 = Date.now();
    splash(L('Welcome, ' + C.ADMIN_NAME_EN, 'أهلاً بكِ، ' + C.ADMIN_NAME_AR), true);
    refresh().then(function () { setTimeout(main, Math.max(0, 5000 - (Date.now() - t0))); }).catch(fatal);
  }

  /* ---------- shell ---------- */
  function main() {
    root.innerHTML = '';
    var top = h('header', { class: 'top' },
      h('button', { class: 'ibtn', 'aria-label': 'menu', html: ic('menu'), onclick: openDrawer }),
      h('div', { class: 'ttl', id: 'ttl' }), h('div', { class: 'logo sm', html: ic('heart-pulse') }));
    A.content = h('main', { class: 'content' });
    var nav = h('nav', { class: 'nav' },
      h('button', { id: 'nv-lib', html: ic('film') + '<span>' + L('Library', 'المحتوى') + '</span>', onclick: function () { A.tab = 'lib'; renderTab(); } }),
      h('button', { id: 'nv-scr', html: ic('monitor') + '<span>' + L('Screens', 'الشاشات') + '</span>', onclick: function () { A.tab = 'scr'; renderTab(); } }));
    var fab = h('button', { class: 'fab', id: 'fab', 'aria-label': 'add', html: ic('plus'), onclick: function () { if (A.tab === 'lib') addContent(); else addScreen(); } });
    root.appendChild(top); root.appendChild(A.content); root.appendChild(nav); root.appendChild(fab);
    renderTab(); ensureBubble(); updateBubble();
  }
  function renderTab() {
    var c = A.content; if (!c) return;
    c.innerHTML = '';
    document.getElementById('ttl').textContent = A.tab === 'lib' ? L('Content library', 'مكتبة المحتوى') : L('Screens', 'الشاشات');
    document.getElementById('nv-lib').classList.toggle('on', A.tab === 'lib');
    document.getElementById('nv-scr').classList.toggle('on', A.tab === 'scr');
    if (A.tab === 'lib') renderLib(); else renderScr();
  }
  setInterval(function () {
    if (A.tab === 'scr' && A.content && !document.hidden) refresh().then(renderTab).catch(function () {});
  }, 30000);

  /* ---------- library ---------- */
  function renderLib() {
    var c = A.content;
    if (!A.items.length) { c.appendChild(empty(L('No content yet', 'لا يوجد محتوى بعد'), L('Tap + to add videos, images, slides or text', 'اضغطي + لإضافة فيديو أو صور أو شرائح أو نص'))); return; }
    A.items.forEach(function (it, i) { c.appendChild(itemCard(it, i)); });
  }
  function thumbEl(it) {
    var box = h('div', { class: 'thumb' });
    if (it.k === 'text' && it.td) { box.appendChild(window.RENDER.build(it.td, 76, 43, true).wrap); return box; }
    var id = (it.k === 'video' || it.k === 'image') && it.file ? it.file.id : (it.k === 'gslides' ? it.sid : null);
    var fallback = function () { box.innerHTML = ic(kindIcon(it.k)); };
    if (id) { var im = h('img', { src: Drive.thumbUrl(id), alt: '', loading: 'lazy' }); im.onerror = fallback; box.appendChild(im); } else fallback();
    return box;
  }
  function itemCard(it, i) {
    return h('div', { class: 'card item' + (it.on === false ? ' off' : '') },
      thumbEl(it),
      h('div', { class: 'meta', onclick: function () { editItem(it); } },
        h('div', { class: 'nm', text: it.name || '-' }),
        h('div', { class: 'sub', text: kindName(it.k) + ' · ' + targetsText(it) })),
      h('div', { class: 'acts' },
        h('button', { class: 'ibtn', 'aria-label': 'up', html: ic('arrow-up'), onclick: function () { moveItem(i, -1); } }),
        h('button', { class: 'ibtn', 'aria-label': 'down', html: ic('arrow-down'), onclick: function () { moveItem(i, 1); } }),
        sw(it.on !== false, function (v) { it.on = v; it.v = Date.now(); api('admin.item.save', { item: it }).then(renderTab).catch(function (e) { UI.toast(explain(e), true); }); })));
  }
  function moveItem(i, d) {
    var j = i + d; if (j < 0 || j >= A.items.length) return;
    var t = A.items[i]; A.items[i] = A.items[j]; A.items[j] = t; renderTab();
    api('admin.item.order', { ids: A.items.map(function (x) { return x.id; }) }).catch(function (e) { UI.toast(explain(e), true); });
  }
  function chips(ref) {
    var box = h('div', { class: 'chips' });
    function chip(t, on, fn) { return h('button', { class: 'chip' + (on ? ' on' : ''), text: t, onclick: fn }); }
    function draw() {
      box.innerHTML = '';
      box.appendChild(chip(L('All screens', 'كل الشاشات'), ref.v === 'all', function () { ref.v = 'all'; draw(); }));
      A.devices.forEach(function (d) {
        var on = ref.v !== 'all' && ref.v.indexOf(d.id) >= 0;
        box.appendChild(chip(d.name || d.id, on, function () {
          if (ref.v === 'all') ref.v = [d.id]; else { var i = ref.v.indexOf(d.id); if (i >= 0) ref.v.splice(i, 1); else ref.v.push(d.id); if (!ref.v.length) ref.v = 'all'; }
          draw();
        }));
      });
    }
    draw(); return box;
  }
  function fitSelect(d) {
    return h('select', { onchange: function (e) { d.fit = e.target.value; } },
      [['contain', L('Original proportions (no cropping)', 'بحجمه الأصلي (بدون قص)')], ['fill', L('Stretch to fill the screen', 'ملء الشاشة (تمدد)')], ['cover', L('Fill the screen (crop edges)', 'ملء الشاشة (قص الأطراف)')]]
        .map(function (o) { return h('option', { value: o[0], text: o[1], selected: (d.fit || 'contain') === o[0] }); }));
  }
  function num(d, key, min, max) { return h('input', { type: 'number', min: min, max: max, value: d[key] == null ? '' : d[key], onchange: function (e) { var v = Number(e.target.value); d[key] = e.target.value === '' ? 0 : Math.max(min, v); } }); }

  function editItem(it) {
    var d = clone(it), tg = { v: d.targets === 'all' || !d.targets ? 'all' : d.targets.slice() }, s = d.sched = d.sched || {};
    var body = h('div', { class: 'form' });
    body.appendChild(field(L('Name', 'الاسم'), h('input', { type: 'text', value: d.name || '', oninput: function (e) { d.name = e.target.value; } })));
    if (d.k === 'text') body.appendChild(h('button', { class: 'btn', html: ic('pencil') + '<span>' + L('Edit the slide', 'تعديل الشريحة') + '</span>', onclick: function () { sh.close(); editText(it); } }));
    if (d.k === 'video' || d.k === 'image') body.appendChild(field(L('How to display', 'طريقة العرض'), fitSelect(d)));
    if (d.k === 'video') {
      body.appendChild(field(L('Mute sound', 'كتم الصوت'), sw(!!d.mute, function (v) { d.mute = v; })));
      body.appendChild(h('div', { class: 'two' }, field(L('Start at (sec)', 'يبدأ من (ثانية)'), num(d, 'ts', 0, 86400)), field(L('End at (sec, 0 = full)', 'ينتهي عند (0 = كامل)'), num(d, 'te', 0, 86400))));
    }
    if (d.k === 'image' || d.k === 'text') body.appendChild(field(L('Seconds on screen', 'مدة العرض بالثواني'), num(d, 'dur', 3, 600)));
    if (d.k === 'pdf' || d.k === 'gslides') {
      body.appendChild(field(L('Seconds per slide / page', 'ثواني لكل شريحة / صفحة'), h('input', { type: 'number', min: 2, max: 300, value: d.pdur || C.PAGE_SEC, onchange: function (e) { d.pdur = Math.max(2, Number(e.target.value) || C.PAGE_SEC); if (d.k === 'gslides' && d.pages) d.dur = d.pages * d.pdur; } })));
      if (d.pages) body.appendChild(h('div', { class: 'hint', text: L('Pages: ', 'عدد الصفحات: ') + d.pages }));
    }
    body.appendChild(field(L('Show on', 'العرض على'), chips(tg)));
    body.appendChild(h('div', { class: 'sect', text: L('Schedule (optional)', 'الجدولة (اختياري)') }));
    body.appendChild(h('div', { class: 'two' },
      field(L('From date', 'من تاريخ'), h('input', { type: 'date', value: s.from || '', onchange: function (e) { s.from = e.target.value; } })),
      field(L('To date', 'إلى تاريخ'), h('input', { type: 'date', value: s.to || '', onchange: function (e) { s.to = e.target.value; } }))));
    body.appendChild(h('div', { class: 'two' },
      field(L('Daily from', 'يوميا من'), h('input', { type: 'time', value: s.t1 || '', onchange: function (e) { s.t1 = e.target.value; } })),
      field(L('Daily until', 'يوميا حتى'), h('input', { type: 'time', value: s.t2 || '', onchange: function (e) { s.t2 = e.target.value; } }))));
    var sh = UI.sheet(d.name || kindName(d.k), body, [
      { label: L('Delete', 'حذف'), cls: 'danger', fn: function () { UI.confirm(L('Delete this item from the cloud and the screens?', 'حذف هذا العنصر من السحابة ومن الشاشات؟'), L('Delete', 'حذف'), true).then(function (ok) { if (ok) deleteItem(it); }); return true; } },
      { label: L('Save', 'حفظ'), cls: 'pri', fn: function () {
        d.targets = tg.v;
        if (!s.from && !s.to && !s.t1 && !s.t2) delete d.sched;
        d.v = Date.now();
        api('admin.item.save', { item: d }).then(function () { upsertLocal(d); renderTab(); UI.toast(L('Saved', 'تم الحفظ')); }).catch(function (e) { UI.toast(explain(e), true); });
      } }
    ], { full: true });
  }
  function deleteItem(it) {
    api('admin.item.delete', { id: it.id }).then(function () {
      A.items = A.items.filter(function (x) { return x.id !== it.id; }); renderTab();
      if (it.file) Drive.remove(it.file.id);
      if (it.sid) Drive.remove(it.sid);
      (it.assets || []).forEach(function (a) { Drive.remove(a.id); });
      UI.toast(L('Deleted', 'تم الحذف'));
    }).catch(function (e) { UI.toast(explain(e), true); });
  }

  /* ---------- text slides ---------- */
  function editText(it, targets) {
    return window.TextEditor.open(it).then(function (res) {
      if (!res) return;
      var item = it ? clone(it) : { k: 'text', on: true, targets: targets || 'all', fit: 'contain' };
      item.name = res.name; item.dur = res.dur; item.td = res.td; item.v = Date.now();
      return saveTextItem(item, it);
    });
  }
  function saveTextItem(item, prev) {
    UI.toast(L('Saving...', 'جاري الحفظ...'));
    var chain = Promise.resolve();
    item.td.layers.forEach(function (l) {
      if (l.k === 'i' && /^data:/.test(l.src)) {
        chain = chain.then(function () {
          return Drive.upload(dataToFile(l.src, 'slide-image'), function () {}, {}).then(function (m) { return Drive.makePublic(m.id).then(function () { l.src = 'drive:' + m.id; }); });
        });
      }
    });
    return chain.then(function () {
      var as = []; item.td.layers.forEach(function (l) { if (l.k === 'i' && l.src.indexOf('drive:') === 0) as.push({ id: l.src.slice(6), size: 0 }); });
      item.assets = as;
      ((prev && prev.assets) || []).forEach(function (o) { if (!as.some(function (a) { return a.id === o.id; })) Drive.remove(o.id); });
      return api('admin.item.save', { item: item });
    }).then(function (r) { item.id = r.id; upsertLocal(item); renderTab(); UI.toast(L('Saved', 'تم الحفظ')); })
      .catch(function (e) { UI.toast(explain(e), true); });
  }

  /* ---------- add content ---------- */
  function addContent() {
    var ctx = { k: 'video', targets: 'all', fit: 'contain', sec: C.PAGE_SEC }, tg = { v: 'all' };
    var body = h('div', { class: 'form' }), tiles = h('div', { class: 'tiles' }), extra = h('div');
    var kinds = [['video', 'film', L('Video', 'فيديو')], ['image', 'image', L('Images', 'صور')], ['slides', 'presentation', L('Slides (PPTX / PDF)', 'شرائح (PPTX / PDF)')], ['text', 'type', L('Text', 'نص')]];
    function drawTiles() {
      tiles.innerHTML = '';
      kinds.forEach(function (k) {
        tiles.appendChild(h('button', { class: 'tile' + (ctx.k === k[0] ? ' on' : ''), html: ic(k[1]) + '<span>' + k[2] + '</span>', onclick: function () { ctx.k = k[0]; drawTiles(); drawExtra(); } }));
      });
    }
    function drawExtra() {
      extra.innerHTML = '';
      if (ctx.k === 'video' || ctx.k === 'image') extra.appendChild(field(L('How to display', 'طريقة العرض'), fitSelect(ctx)));
      if (ctx.k === 'slides') {
        extra.appendChild(field(L('Seconds per slide / page', 'ثواني لكل شريحة / صفحة'), h('input', { type: 'number', min: 2, max: 300, value: ctx.sec, onchange: function (e) { ctx.sec = Math.max(2, Number(e.target.value) || C.PAGE_SEC); } })));
        extra.appendChild(h('div', { class: 'hint', text: L('PDF plays offline. PPTX is converted by Google Slides (keeps most animations, needs internet on the screen). For 100% exact PowerPoint look, export it as MP4 from PowerPoint and add it as a video.', 'PDF يعمل بدون إنترنت. PPTX يتحول عبر Google Slides (يحافظ على أغلب الحركات ويحتاج إنترنت على الشاشة). للحصول على شكل PowerPoint مطابق 100% صدّريه فيديو MP4 من PowerPoint وأضيفيه كفيديو.') }));
      }
    }
    drawTiles(); drawExtra();
    body.appendChild(tiles); body.appendChild(extra); body.appendChild(field(L('Show on', 'العرض على'), chips(tg)));
    var accept = { video: 'video/*', image: 'image/*', slides: '.pdf,.pptx,.ppt' };
    var fi = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: function (e) {
      if (!e.target.files.length) return;
      ctx.targets = tg.v === 'all' ? 'all' : tg.v.slice();
      enqueue(e.target.files, ctx); sh.close();
    } });
    body.appendChild(fi);
    var sh = UI.sheet(L('Add content', 'إضافة محتوى'), body, [{ label: L('Choose', 'اختيار'), cls: 'pri', fn: function () {
      ctx.targets = tg.v === 'all' ? 'all' : tg.v.slice();
      if (ctx.k === 'text') { setTimeout(function () { editText(null, ctx.targets); }, 230); return true; }
      fi.accept = accept[ctx.k]; fi.click(); return false;
    } }], { full: true });
  }

  /* ---------- upload manager ---------- */
  var U = { q: [], busy: false, wake: null, lastNote: 0, onchange: null };
  function enqueue(files, ctx) {
    [].forEach.call(files, function (f) {
      var kind = ctx.k === 'slides' ? (/\.pdf$/i.test(f.name) ? 'pdf' : 'gslides') : ctx.k;
      U.q.push({ id: rid(), file: f, ctx: clone(ctx), kind: kind, state: 'wait', p: 0, err: null });
    });
    if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) {} }
    updateBubble(); pump();
  }
  window.onbeforeunload = function () { return U.busy ? 'upload' : undefined; };
  function setWake(on) {
    try {
      if (on && navigator.wakeLock && !U.wake) navigator.wakeLock.request('screen').then(function (w) { U.wake = w; w.addEventListener('release', function () { U.wake = null; }); }).catch(function () {});
      if (!on && U.wake) { U.wake.release(); U.wake = null; }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && U.busy) setWake(true); });
  function pump() {
    if (U.busy) return;
    var job = U.q.filter(function (j) { return j.state === 'wait'; })[0];
    if (!job) { setWake(false); allDone(); return; }
    U.busy = true; job.state = 'up'; job.p = 0; job.err = null; setWake(true); updateBubble();
    runJob(job).then(function () { job.state = 'done'; job.p = 1; }).catch(function (e) { job.state = 'fail'; job.err = explain(e); })
      .then(function () { U.busy = false; updateBubble(); if (job.state === 'fail') notify(job.file.name + ': ' + job.err, true); pump(); });
  }
  function runJob(job) {
    var f = job.file, ctx = job.ctx, ctl = job.ctl = { cancelled: false };
    return Drive.upload(f, function (p) { job.p = p * 0.92; updateBubble(); }, ctl)
      .then(function (meta) { return Drive.makePublic(meta.id).then(function () { return meta; }); })
      .then(function (meta) {
        if (job.kind === 'gslides') return Drive.convertToSlides(meta.id, f.name).then(function (r) { Drive.remove(meta.id); return { sid: r.sid, pages: r.pages }; });
        if (job.kind === 'pdf') return Drive.countPdfPages(f).then(function (n) { return { file: { id: meta.id, mime: meta.mimeType, size: Number(meta.size) || f.size }, pages: n }; });
        return { file: { id: meta.id, mime: meta.mimeType, size: Number(meta.size) || f.size } };
      })
      .then(function (extra) {
        var item = { k: job.kind, name: f.name.replace(/\.[^.]+$/, ''), targets: ctx.targets, on: true, fit: ctx.fit, v: Date.now() };
        if (job.kind === 'image') item.dur = C.IMAGE_SEC;
        if (job.kind === 'pdf' || job.kind === 'gslides') item.pdur = ctx.sec;
        Object.assign(item, extra);
        if (job.kind === 'gslides') item.dur = Math.max(10, (extra.pages || 10) * ctx.sec);
        return api('admin.item.save', { item: item }).then(function (r) { item.id = r.id; upsertLocal(item); if (A.tab === 'lib') renderTab(); });
      });
  }
  function overall() {
    var n = 0, s = 0; U.q.forEach(function (j) { n++; s += j.state === 'done' ? 1 : (j.state === 'fail' ? j.p : j.p); }); return n ? s / n : 0;
  }
  function allDone() {
    var fails = U.q.filter(function (j) { return j.state === 'fail'; }).length;
    if (U.q.length) notify(fails ? L('Some uploads failed', 'فشل رفع بعض الملفات') : L('All uploads finished', 'اكتمل رفع كل الملفات'), true);
    updateBubble();
    if (!fails) setTimeout(function () { if (!U.busy && !U.q.some(function (j) { return j.state === 'wait' || j.state === 'fail'; })) { U.q = []; updateBubble(); } }, 5000);
  }
  function notify(msg, final) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var o = { body: msg, tag: 'dr-upload', renotify: !!final, silent: !final, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    try { if (A.sw) A.sw.showNotification(L(C.BRAND_EN, C.BRAND_AR), o); else new Notification(L(C.BRAND_EN, C.BRAND_AR), o); } catch (e) {}
  }

  /* floating, draggable progress circle */
  var bubble = null;
  function ensureBubble() {
    if (bubble) { if (!bubble.parentNode) document.body.appendChild(bubble); return; }
    bubble = h('div', { class: 'bubble hide', html: '<svg viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="22"/><circle class="fg" cx="28" cy="28" r="22" stroke-dasharray="138.2" stroke-dashoffset="138.2"/></svg><span class="pc">0%</span>' });
    var pos = { x: window.innerWidth - 76, y: window.innerHeight - 190 };
    try { var sv = JSON.parse(localStorage.getItem('dra_bubble') || 'null'); if (sv) pos = sv; } catch (e) {}
    bubble.style.left = Math.max(4, Math.min(window.innerWidth - 64, pos.x)) + 'px'; bubble.style.top = Math.max(4, Math.min(window.innerHeight - 64, pos.y)) + 'px';
    var down = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    bubble.addEventListener('pointerdown', function (e) { down = true; moved = false; sx = e.clientX; sy = e.clientY; var r = bubble.getBoundingClientRect(); ox = r.left; oy = r.top; try { bubble.setPointerCapture(e.pointerId); } catch (x) {} });
    bubble.addEventListener('pointermove', function (e) {
      if (!down) return; var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { bubble.style.left = Math.max(4, Math.min(window.innerWidth - 64, ox + dx)) + 'px'; bubble.style.top = Math.max(4, Math.min(window.innerHeight - 64, oy + dy)) + 'px'; }
    });
    bubble.addEventListener('pointerup', function () {
      down = false;
      if (moved) { try { localStorage.setItem('dra_bubble', JSON.stringify({ x: parseFloat(bubble.style.left), y: parseFloat(bubble.style.top) })); } catch (e) {} }
      else openQueue();
    });
    document.body.appendChild(bubble);
  }
  function updateBubble() {
    ensureBubble();
    var show = U.q.length > 0, p = overall(), fail = U.q.some(function (j) { return j.state === 'fail'; });
    bubble.classList.toggle('hide', !show); bubble.classList.toggle('fail', fail);
    bubble.querySelector('.fg').setAttribute('stroke-dashoffset', String(138.2 * (1 - Math.min(1, p))));
    bubble.querySelector('.pc').textContent = Math.round(p * 100) + '%';
    var now = Date.now();
    if (U.busy && now - U.lastNote > 4000) { U.lastNote = now; var cur = U.q.filter(function (j) { return j.state === 'up'; })[0]; notify(Math.round(p * 100) + '% - ' + (cur ? cur.file.name : ''), false); }
    if (U.onchange) U.onchange();
  }
  function openQueue() {
    var list = h('div', { class: 'qlist' });
    function draw() {
      list.innerHTML = '';
      if (!U.q.length) { list.appendChild(h('div', { class: 'hint', text: L('Nothing is uploading', 'لا يوجد رفع حاليا') })); return; }
      U.q.forEach(function (j) {
        var st = { wait: L('Waiting', 'بالانتظار'), up: Math.round(j.p * 100) + '%', done: L('Done', 'تم'), fail: L('Failed', 'فشل') }[j.state];
        var row = h('div', { class: 'qrow ' + j.state },
          h('div', { class: 'qtop' }, h('div', { class: 'nm', text: j.file.name }), h('div', { class: 'st', text: st })),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(j.p * 100) + '%' })));
        if (j.state === 'fail') row.appendChild(h('div', { class: 'qerr' }, h('span', { text: j.err || '' }),
          h('button', { class: 'btn small', html: ic('refresh-cw') + '<span>' + L('Retry', 'إعادة المحاولة') + '</span>', onclick: function () { j.state = 'wait'; j.err = null; j.p = 0; updateBubble(); pump(); } }),
          h('button', { class: 'btn small', text: L('Remove', 'إزالة'), onclick: function () { U.q = U.q.filter(function (x) { return x !== j; }); updateBubble(); } })));
        if (j.state === 'up') row.appendChild(h('div', { class: 'qerr' }, h('button', { class: 'btn small', text: L('Cancel', 'إلغاء'), onclick: function () { if (j.ctl) j.ctl.cancelled = true; } })));
        list.appendChild(row);
      });
    }
    draw(); U.onchange = draw;
    UI.sheet(L('Uploads', 'الرفع'), list, [], { onclose: function () { U.onchange = null; } });
  }

  /* ---------- screens ---------- */
  function cmdText(c) {
    if (!c) return L('Waiting for a command', 'بانتظار أمر');
    if (c.action === 'stop') return L('Stopped', 'متوقفة');
    if (c.mode === 'selected') return L('Playing ' + (c.ids || []).length + ' selected', 'تعرض ' + (c.ids || []).length + ' محتوى محدد') + (c.loop ? ' · ' + L('loop', 'تكرار') : '');
    return L('Playing all content', 'تعرض كل المحتوى') + (c.loop ? ' · ' + L('loop', 'تكرار') : '');
  }
  function renderScr() {
    var c = A.content;
    if (!A.devices.length) { c.appendChild(empty(L('No screens linked', 'لا توجد شاشات مرتبطة'), L('Tap + and enter the 9-digit code shown on the screen', 'اضغطي + وأدخلي الكود المكون من 9 أرقام الظاهر على الشاشة'))); return; }
    A.devices.forEach(function (d) { c.appendChild(devCard(d)); });
  }
  function sendCmd(d, cmd) {
    api('admin.device.update', { id: d.id, cmd: cmd }).then(refresh).then(renderTab).then(function () { UI.toast(L('Command sent', 'تم إرسال الأمر')); }).catch(function (e) { UI.toast(explain(e), true); });
  }
  function devCard(d) {
    var online = nowS() - d.lastSeen < 180000, days = Math.max(0, Math.ceil((d.linkExp - nowS()) / 86400000)), loopAll = { v: true };
    function sbtn(icon, label, fn, cls) { return h('button', { class: 'btn small ' + (cls || ''), html: ic(icon) + '<span>' + label + '</span>', onclick: fn }); }
    return h('div', { class: 'card dev' },
      h('div', { class: 'dtop' }, h('div', { class: 'dot ' + (online ? 'on' : '') }),
        h('div', { class: 'meta' }, h('div', { class: 'nm', text: d.name || d.id }),
          h('div', { class: 'sub', text: (online ? L('Online', 'متصلة') : L('Offline', 'غير متصلة')) + ' · ' + L('link ends in ' + days + ' days', 'الربط ينتهي بعد ' + days + ' يوم') })),
        h('button', { class: 'ibtn', 'aria-label': 'rename', html: ic('pencil'), onclick: function () { renameDev(d); } })),
      h('div', { class: 'sub st', text: cmdText(d.cmd) }),
      h('div', { class: 'drow' },
        sbtn('monitor-play', L('Play all', 'عرض الكل'), function () { sendCmd(d, { action: 'play', mode: 'all', ids: [], loop: loopAll.v }); }, 'pri'),
        h('div', { class: 'lp' }, h('span', { html: ic('repeat') }), sw(true, function (v) { loopAll.v = v; }))),
      h('div', { class: 'drow' },
        sbtn('list-checks', L('Play selected', 'عرض محدد'), function () { playSelected(d); }),
        sbtn('stop-circle', L('Stop', 'إيقاف'), function () { sendCmd(d, { action: 'stop' }); })),
      h('div', { class: 'drow' },
        sbtn('layers', L('Assign content', 'تحديد المحتوى'), function () { assignSheet(d); }),
        sbtn('refresh-cw', L('Renew link', 'تجديد الربط'), function () { api('admin.device.update', { id: d.id, renew: true }).then(refresh).then(renderTab).then(function () { UI.toast(L('Link renewed for 30 days', 'تم تجديد الربط 30 يوما')); }).catch(function (e) { UI.toast(explain(e), true); }); }),
        sbtn('unlink', L('Unlink', 'فك الربط'), function () {
          UI.confirm(L('Unlink this screen?', 'فك ارتباط هذه الشاشة؟'), L('Unlink', 'فك الربط'), true).then(function (ok) {
            if (ok) api('admin.device.unlink', { id: d.id }).then(refresh).then(renderTab).catch(function (e) { UI.toast(explain(e), true); });
          });
        }, 'danger')));
  }
  function checklist(items, checked) {
    var box = h('div', { class: 'checks' });
    if (!items.length) box.appendChild(h('div', { class: 'hint', text: L('No content', 'لا يوجد محتوى') }));
    items.forEach(function (it) {
      var row = h('button', { class: 'crow' + (checked[it.id] ? ' on' : ''), onclick: function () { checked[it.id] = !checked[it.id]; row.classList.toggle('on', !!checked[it.id]); } },
        h('span', { class: 'cb', html: ic('check') }), h('span', { class: 'ct' }, h('b', { text: it.name || '-' }), h('small', { text: kindName(it.k) })));
      box.appendChild(row);
    });
    return box;
  }
  function playSelected(d) {
    var mine = A.items.filter(function (it) { return it.on !== false && (it.targets === 'all' || (it.targets || []).indexOf(d.id) >= 0); }), ck = {}, loop = { v: true };
    var body = h('div', { class: 'form' }, checklist(mine, ck), h('div', { class: 'lp wide' }, h('span', { html: ic('repeat') + ' ' + L('Loop forever', 'تكرار للأبد') }), sw(true, function (v) { loop.v = v; })));
    UI.sheet(L('Play selected on ', 'عرض محدد على ') + (d.name || ''), body, [{ label: L('Play', 'تشغيل'), cls: 'pri', fn: function () {
      var ids = Object.keys(ck).filter(function (k) { return ck[k]; }); if (!ids.length) { UI.toast(L('Select at least one', 'اختاري عنصرا واحدا على الأقل'), true); return false; }
      sendCmd(d, { action: 'play', mode: 'selected', ids: ids, loop: loop.v });
    } }], { full: true });
  }
  function assignSheet(d) {
    var ck = {}; A.items.forEach(function (it) { ck[it.id] = it.targets === 'all' || (it.targets || []).indexOf(d.id) >= 0; });
    var body = h('div', { class: 'form' }, h('div', { class: 'hint', text: L('Tick what this screen should show.', 'علّمي على ما تريدين عرضه على هذه الشاشة.') }), checklist(A.items, ck));
    UI.sheet(L('Content of ', 'محتوى ') + (d.name || ''), body, [{ label: L('Save', 'حفظ'), cls: 'pri', fn: function () {
      var changes = [];
      A.items.forEach(function (it) {
        var was = it.targets === 'all' || (it.targets || []).indexOf(d.id) >= 0, now = !!ck[it.id];
        if (was === now) return;
        var t;
        if (now) t = it.targets === 'all' ? 'all' : (it.targets || []).concat([d.id]);
        else t = it.targets === 'all' ? A.devices.filter(function (x) { return x.id !== d.id; }).map(function (x) { return x.id; }) : it.targets.filter(function (x) { return x !== d.id; });
        if (Array.isArray(t) && !t.length) t = [];
        changes.push({ id: it.id, targets: t }); it.targets = t;
      });
      if (!changes.length) return;
      api('admin.items.targets', { changes: changes }).then(function () { renderTab(); UI.toast(L('Saved', 'تم الحفظ')); }).catch(function (e) { UI.toast(explain(e), true); });
    } }], { full: true });
  }
  function renameDev(d) {
    var inp = h('input', { type: 'text', value: d.name || '' });
    UI.sheet(L('Screen name', 'اسم الشاشة'), h('div', { class: 'form' }, inp), [{ label: L('Save', 'حفظ'), cls: 'pri', fn: function () {
      api('admin.device.update', { id: d.id, name: inp.value }).then(refresh).then(renderTab).catch(function (e) { UI.toast(explain(e), true); });
    } }]);
  }
  function addScreen() {
    var code = h('input', { type: 'text', inputmode: 'numeric', maxlength: 11, placeholder: '000 000 000', class: 'codein', oninput: function (e) {
      var v = e.target.value.replace(/\D/g, '').slice(0, 9); e.target.value = v.replace(/(\d{3})(?=\d)/g, '$1 ');
    } });
    var name = h('input', { type: 'text', placeholder: L('e.g. Waiting room', 'مثلا: صالة الانتظار') });
    var body = h('div', { class: 'form' }, field(L('Code shown on the screen', 'الكود الظاهر على الشاشة'), code), field(L('Screen name', 'اسم الشاشة'), name));
    UI.sheet(L('Add screen', 'إضافة شاشة'), body, [{ label: L('Link', 'ربط'), cls: 'pri', fn: function () {
      var c = code.value.replace(/\D/g, ''); if (c.length !== 9) { UI.toast(L('Enter all 9 digits', 'أدخلي الأرقام التسعة كاملة'), true); return false; }
      api('admin.pair', { code: c, name: name.value }).then(refresh).then(function () { A.tab = 'scr'; renderTab(); UI.toast(L('Screen linked for 30 days', 'تم ربط الشاشة لمدة 30 يوما')); }).catch(function (e) { UI.toast(explain(e), true); });
    } }]);
  }

  /* ---------- settings drawer ---------- */
  function openDrawer() {
    var ov = h('div', { class: 'overlay drawer-ov' }), dr = h('aside', { class: 'drawer' });
    function close() { ov.classList.remove('open'); setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220); }
    function sect(t) { return h('div', { class: 'sect', text: t }); }
    dr.appendChild(h('div', { class: 'dh' }, h('div', { class: 'logo sm', html: ic('heart-pulse') }), h('div', { class: 'dt', text: L('Settings', 'الإعدادات') }),
      h('button', { class: 'ibtn', html: ic('x'), onclick: close })));
    dr.appendChild(sect(L('App language', 'لغة التطبيق')));
    dr.appendChild(seg([['en', 'English'], ['ar', 'العربية']], UI.st.lang, function (v) { UI.st.lang = v; UI.save(); UI.applyLang(); close(); main(); }));
    dr.appendChild(sect(L('Screen language', 'لغة الشاشة')));
    dr.appendChild(seg([['en', 'English'], ['ar', 'العربية']], A.cfg.screenLang || 'en', function (v) {
      api('admin.cfg.set', { screenLang: v }).then(function () { A.cfg.screenLang = v; UI.toast(L('Screens will update shortly', 'ستتحدث الشاشات خلال لحظات')); }).catch(function (e) { UI.toast(explain(e), true); });
    }));
    dr.appendChild(sect(L('Appearance', 'المظهر')));
    dr.appendChild(seg([['auto', L('Auto', 'تلقائي')], ['light', L('Light', 'فاتح')], ['dark', L('Dark', 'داكن')]], UI.st.theme, function (v) { UI.st.theme = v; UI.save(); UI.applyTheme(); }));
    dr.appendChild(sect(L('Cloud storage', 'التخزين السحابي')));
    var cloud = h('div', { class: 'prov on' }, h('div', { class: 'pn' }, h('b', { text: 'Google Drive' }), h('small', { text: L('15 GB free · connected', '15 غيغا مجانا · متصل') + (A.email ? ' · ' + A.email : '') })),
      h('button', { class: 'btn small', text: L('Reconnect', 'إعادة الربط'), onclick: function () { Drive.signIn().then(function () { UI.toast(L('Connected', 'تم الربط')); }).catch(function (e) { UI.toast(explain(e), true); }); } }));
    dr.appendChild(cloud);
    [['Dropbox', L('2 GB free', '2 غيغا مجانا')], ['Microsoft OneDrive', L('5 GB free', '5 غيغا مجانا')], ['Cloudinary', L('25 GB free credits / month', '25 غيغا رصيد مجاني شهريا')]].forEach(function (p) {
      dr.appendChild(h('div', { class: 'prov off' }, h('div', { class: 'pn' }, h('b', { text: p[0] }), h('small', { text: p[1] })), h('span', { class: 'badge', text: L('Soon', 'قريبا') })));
    });
    dr.appendChild(sect(L('Storage', 'التخزين')));
    dr.appendChild(h('button', { class: 'btn', html: ic('trash-2') + '<span>' + L('Clear temporary data', 'مسح البيانات المؤقتة') + '</span>', onclick: clearTemp }));
    dr.appendChild(h('button', { class: 'btn', html: ic('log-out') + '<span>' + L('Sign out', 'تسجيل الخروج') + '</span>', onclick: function () { close(); Drive.signOut(); loginView(); } }));
    dr.appendChild(h('div', { class: 'hint', text: 'Dur Al-Razi Signage 1.0' }));
    ov.appendChild(dr); document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('open'); });
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  }
  function clearTemp() {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('dra_up_') === 0) localStorage.removeItem(k); }); } catch (e) {}
    var p = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
    p.then(function () { UI.toast(L('Temporary data cleared', 'تم مسح البيانات المؤقتة')); });
  }

  /* ---------- go ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(function (r) { A.sw = r; }).catch(function () {});
  start();
})();
