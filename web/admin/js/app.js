/* App shell: boot, onboarding, dock navigation, upload bubble, routing between views. */
(function () {
  'use strict';
  var C = window.DR, UI = window.UI, Api = window.Api, P = window.P, Up = window.Up;
  var L = UI.L, h = UI.h, ic = UI.ic;
  var root = document.getElementById('app');
  var App = { views: {}, tab: 'screens', pages: {}, subs: [] };
  window.App = App;

  var TABS = [['screens', 'link', 'Screens', 'الشاشات'], ['library', 'film', 'Library', 'المكتبة'], ['remote', 'remote', 'Remote', 'التحكم'], ['settings', 'settings', 'Settings', 'الإعدادات']];
  var LOGO = '../shared/brand/logo.png';

  /* ---------- registering views ---------- */
  App.register = function (id, view) { App.views[id] = view; };

  App.render = function (id) {
    var v = App.views[id], pg = App.pages[id];
    if (!v || !pg) return;
    var col = pg.firstChild;
    var top = pg.scrollTop;
    col.innerHTML = '';
    v.render(col);
    pg.scrollTop = top;
  };
  App.renderAll = function () { Object.keys(App.views).forEach(App.render); updateChrome(); };
  App.rebuild = function () { Object.keys(App.views).forEach(App.render); buildChrome(); };

  App.go = function (id) {
    var prev = App.tab, order = TABS.map(function (t) { return t[0]; });
    var dir = order.indexOf(id) > order.indexOf(prev) ? 1 : -1;
    if (document.documentElement.dir === 'rtl') dir = -dir;
    Object.keys(App.pages).forEach(function (k) {
      var pg = App.pages[k];
      pg.style.setProperty('--shift', (k === id ? dir * 22 : dir * -22) + 'px');
      pg.classList.toggle('on', k === id);
    });
    if (prev === 'remote' && id !== 'remote') Api.stopWatch();
    App.tab = id;
    var v = App.views[id];
    if (v && v.show) v.show();
    updateChrome();
    UI.buzz(8);
  };

  /* ---------- chrome (top bar + dock) ---------- */
  var topTitle, topSub, dockTabs = {}, logoBtn, logoRing;

  function buildChrome() {
    var old = root.querySelector('.topbar'); if (old) old.remove();
    old = root.querySelector('.dock'); if (old) old.remove();

    topTitle = h('div', { class: 'title' });
    topSub = h('div', { class: 'sub' });
    root.appendChild(h('div', { class: 'topbar' }, h('img', { class: 'brand-mini', src: LOGO, alt: '' }),
      h('div', { class: 'titles' }, topTitle, topSub)));

    var dock = h('div', { class: 'dock' });
    function tab(t) {
      var b = h('button', { class: 'tab', 'aria-label': L(t[2], t[3]), onclick: function () { App.go(t[0]); } },
        h('span', { html: ic(t[1]) }), h('span', { text: L(t[2], t[3]) }));
      dockTabs[t[0]] = b;
      return b;
    }
    dock.appendChild(tab(TABS[0])); dock.appendChild(tab(TABS[1]));
    dock.appendChild(h('div'));
    dock.appendChild(tab(TABS[2])); dock.appendChild(tab(TABS[3]));

    logoRing = h('svg', { class: 'prog', viewBox: '0 0 100 100', html: '<circle class="bg" cx="50" cy="50" r="46"/><circle class="fg" cx="50" cy="50" r="46"/>' });
    logoBtn = h('button', { class: 'logo-btn', 'aria-label': L('Upload', 'رفع'), onclick: function () { window.UploadSheet.open(); } },
      logoRing, h('img', { src: LOGO, alt: '' }), h('span', { class: 'plus', html: ic('plus') }));
    dock.appendChild(logoBtn);
    root.appendChild(dock);
    updateChrome();
    paintProgress();
  }

  function updateChrome() {
    var t = TABS.filter(function (x) { return x[0] === App.tab; })[0];
    if (topTitle) topTitle.textContent = L(t[2], t[3]);
    if (topSub) topSub.textContent = L(C.BRAND_EN, C.BRAND_AR);
    Object.keys(dockTabs).forEach(function (k) { dockTabs[k].classList.toggle('on', k === App.tab); });
    var s = Api.S.cfg && Api.S.cfg.screenUpdate;
    var st = window.Updates && window.Updates.pending();
    var tabSet = dockTabs.settings;
    if (tabSet) {
      var d = tabSet.querySelector('.dotbadge');
      if (st && !d) tabSet.appendChild(h('i', { class: 'dotbadge' }));
      if (!st && d) d.remove();
    }
    void s;
  }
  App.updateChrome = updateChrome;

  /* ---------- upload progress: dock ring + draggable bubble ---------- */
  var bubble = null, bubbleXY = null;

  function paintProgress() {
    var p = Up.progress();
    if (logoBtn) {
      logoBtn.classList.toggle('busy', p.n > 0);
      var fg = logoRing && logoRing.querySelector('.fg');
      if (fg) fg.style.strokeDashoffset = String(289 - 289 * p.pct / 100);
    }
    var showBubble = (p.n > 0 || p.failed > 0) && !document.querySelector('.overlay.upq');
    if (showBubble && !bubble) {
      bubble = h('button', { class: 'bubble', 'aria-label': L('Uploads', 'الرفع'),
        html: '<svg viewBox="0 0 50 50"><circle class="bg" cx="25" cy="25" r="22"/><circle class="fg" cx="25" cy="25" r="22"/></svg>' }, h('span', { class: 'pc' }));
      var xy = bubbleXY || { x: root.clientWidth - 72, y: root.clientHeight * .28 };
      bubble.style.left = xy.x + 'px'; bubble.style.top = xy.y + 'px';
      makeDraggable(bubble, function () { window.UploadSheet.queue(); });
      root.appendChild(bubble);
    }
    if (bubble) {
      if (!showBubble) { bubble.remove(); bubble = null; return; }
      bubble.classList.toggle('fail', p.n === 0 && p.failed > 0);
      var f = bubble.querySelector('.fg');
      f.style.strokeDashoffset = String(138.2 - 138.2 * (p.n ? p.pct : 100) / 100);
      bubble.querySelector('.pc').textContent = p.n ? p.pct + '%' : '!';
    }
  }

  function makeDraggable(el, onTap) {
    var sx, sy, ox, oy, moved = false, down = false;
    el.addEventListener('pointerdown', function (e) {
      down = true; moved = false; sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      var x = Math.max(4, Math.min(root.clientWidth - el.offsetWidth - 4, ox + dx));
      var y = Math.max(60, Math.min(root.clientHeight - el.offsetHeight - 120, oy + dy));
      el.style.left = x + 'px'; el.style.top = y + 'px';
      bubbleXY = { x: x, y: y };
    });
    el.addEventListener('pointerup', function () {
      down = false;
      if (!moved) { onTap(); return; }
      var mid = root.clientWidth / 2, x = el.offsetLeft + el.offsetWidth / 2 < mid ? 6 : root.clientWidth - el.offsetWidth - 6;
      el.style.transition = 'left .35s cubic-bezier(.34,1.56,.64,1)'; el.style.left = x + 'px';
      bubbleXY.x = x;
      setTimeout(function () { el.style.transition = ''; }, 400);
    });
  }

  /* ---------- splash ---------- */
  function splash(sub) {
    var s = h('div', { class: 'splash' }, h('img', { class: 'logo', src: LOGO, alt: '' }),
      h('div', { class: 'brand-ar', text: C.BRAND_AR }), h('div', { class: 'brand-en', text: C.BRAND_EN.toUpperCase() }),
      sub ? h('div', { class: 'welcome', text: sub }) : null, h('div', { class: 'spin' }));
    root.appendChild(s);
    return { hide: function () { s.style.transition = 'opacity .45s'; s.style.opacity = '0'; setTimeout(function () { s.remove(); }, 480); } };
  }

  /* ---------- onboarding ---------- */
  var ART = [
    '<svg class="art" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><rect x="28" y="48" width="144" height="92" rx="14"/><path d="M80 164h40M100 140v24"/><path class="blink" d="M90 78l30 16-30 16z" fill="currentColor"/></g></svg>',
    '<svg class="art" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><rect x="26" y="62" width="40" height="52" rx="10"/><rect x="80" y="62" width="40" height="52" rx="10"/><rect x="134" y="62" width="40" height="52" rx="10"/><path class="draw" d="M46 140h108"/><path class="blink" d="M46 88h0M100 88h0M154 88h0" stroke-width="12"/></g></svg>',
    '<svg class="art" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><path d="M58 138a32 32 0 1 1 8-62 42 42 0 0 1 80 14 28 28 0 0 1-6 48z"/><g class="float2"><path d="M100 150V100M80 118l20-20 20 20"/></g></g></svg>',
    '<svg class="art" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><rect x="62" y="24" width="76" height="152" rx="24"/><circle cx="100" cy="76" r="14" class="blink"/><path d="M100 112v0M82 132h0M118 132h0M100 150v0" stroke-width="10"/><path d="M148 52a60 60 0 0 1 0 50M160 40a80 80 0 0 1 0 74" class="spinr" style="transform-origin:100px 76px;animation:none"/></g></svg>',
    '<svg class="art" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><path d="M52 138a32 32 0 1 1 8-62 42 42 0 0 1 80 14 28 28 0 0 1-6 48z"/><path class="draw" d="M82 112l14 14 26-30"/></g></svg>'
  ];

  function onboarding(done) {
    var slides = [
      [L('Welcome', 'أهلاً بك'), L('Manage the waiting-room screens of the center from your phone.', 'أدِيري شاشات صالة الانتظار في المركز من هاتفك.')],
      [L('Link a screen', 'اربطي شاشة'), L('Type the 9-digit code that appears on the screen. That is all.', 'اكتبي الكود المكوّن من ٩ أرقام الظاهر على الشاشة. هذا كل شيء.')],
      [L('Upload content', 'ارفعي المحتوى'), L('Videos, images, slides and text. Uploads continue in the background.', 'فيديو وصور وشرائح ونصوص. يستمر الرفع في الخلفية.')],
      [L('Remote control', 'تحكّم عن بُعد'), L('Next, pause, mute and more, instantly and wirelessly.', 'التالي، إيقاف مؤقت، كتم الصوت وغيرها، فورياً ولاسلكياً.')],
      [L('Connect your cloud', 'اربطي سحابتك'), L('Sign in once with Google. Your files stay in your own storage.', 'سجّلي الدخول مرة واحدة بحساب كوكل. ملفاتك تبقى في مساحتك الخاصة.')]
    ];
    var i = 0, el = h('div', { class: 'onb' });
    var track = h('div', { class: 'track' }), dots = h('div', { class: 'dots' });
    var next = h('button', { class: 'btn pri block' });
    var skip = h('button', { class: 'skip', text: L('Skip', 'تخطّي'), onclick: function () { i = slides.length - 1; paint(); } });
    slides.forEach(function (s, n) {
      track.appendChild(h('div', { class: 'slide' }, h('div', { html: ART[n] }), h('h2', { text: s[0] }), h('p', { text: s[1] })));
      dots.appendChild(h('i'));
    });
    next.addEventListener('click', function () {
      if (i < slides.length - 1) { i++; paint(); return; }
      el.style.transition = 'opacity .4s'; el.style.opacity = '0';
      setTimeout(function () { el.remove(); done(); }, 420);
    });
    function paint() {
      [].forEach.call(track.children, function (s, n) { s.className = 'slide' + (n === i ? ' on' : n < i ? ' past' : ''); });
      [].forEach.call(dots.children, function (d, n) { d.className = n === i ? 'on' : ''; });
      var last = i === slides.length - 1;
      next.innerHTML = ic(last ? 'cloud' : 'arrow-right') + '<span>' + (last ? L('Sign in to cloud', 'تسجيل الدخول إلى السحابة') : L('Next', 'التالي')) + '</span>';
      skip.style.visibility = last ? 'hidden' : 'visible';
    }
    el.appendChild(skip); el.appendChild(track);
    el.appendChild(h('div', { class: 'foot' }, dots, next));
    root.appendChild(el);
    paint();
  }

  /* ---------- sub pages (About / Updates) ---------- */
  App.openSub = function (title, build) {
    var pg = h('div', { class: 'subpage' });
    var col = h('div', { class: 'col' });
    pg.appendChild(h('div', { class: 'bar' }, h('button', { class: 'ibtn', 'aria-label': 'back', html: ic(document.documentElement.dir === 'rtl' ? 'arrow-right' : 'arrow-left'), onclick: App.back }), h('div', { class: 't', text: title })));
    pg.appendChild(col);
    root.appendChild(pg);
    build(col);
    requestAnimationFrame(function () { requestAnimationFrame(function () { pg.classList.add('on'); }); });
    App.subs.push(pg);
  };
  App.back = function () {
    var pg = App.subs.pop();
    if (!pg) return false;
    pg.classList.remove('on');
    setTimeout(function () { pg.remove(); }, 520);
    return true;
  };

  /* ---------- sign in (cloud) ---------- */
  App.signIn = function () {
    var p = P.native ? P.call('auth.signIn') : window.Drive.signIn().then(function () { return window.Drive.userEmail().then(function (e) { return { email: e }; }); });
    return p.then(function (r) {
      UI.st.linked = true; UI.save();
      if (r && r.email) Api.S.email = r.email;
      return Api.refresh();
    }).then(function () {
      UI.confetti('big'); App.renderAll();
      UI.toast(L('Connected', 'تم الربط'));
    }).catch(function (e) { UI.toast(Api.explain(e), true); throw e; });
  };

  /* ---------- boot ---------- */
  function boot() {
    UI.applyLook();
    window.RENDER.setResolver(function (s) { return s && s.indexOf('drive:') === 0 ? window.Drive.fileUrl(s.slice(6)) : s; });
    Api.loadCache();
    if (!P.native && window.Drive && C.GOOGLE_CLIENT_ID) { try { window.Drive.init(); } catch (e) { /* ignore */ } }

    root.innerHTML = '';
    var stage = h('div', { class: 'stage' });
    TABS.forEach(function (t) {
      var pg = h('div', { class: 'page' }, h('div', { class: 'col' }));
      App.pages[t[0]] = pg; stage.appendChild(pg);
    });
    root.appendChild(stage);
    buildChrome();

    var sp = splash(Api.S.email ? L('Welcome back', 'أهلاً بعودتك') : '');
    var minDelay = new Promise(function (r) { setTimeout(r, 1100); });

    Object.keys(App.views).forEach(App.render);
    App.go('screens');

    Up.subscribe(paintProgress);
    if (P.native) {
      P.call('prefs.set', { lang: UI.st.lang, wifiOnly: UI.st.wifiOnly, notif: UI.st.notif }).catch(function () {});
      P.on('update', function () { App.updateChrome(); if (App.views.settings) App.render('settings'); });
      P.on('share', function (d) { window.UploadSheet.share(d); });
      P.on('goto', function (d) { if (d && d.tab) App.go(d.tab); if (d && d.upload) window.UploadSheet.open(); });
      P.on('back', function () { if (!App.back() && App.tab !== 'screens') App.go('screens'); else if (!App.subs.length && App.tab === 'screens') P.call('app.exit').catch(function () {}); });
    }

    function enter() {
      sp.hide();
      if (UI.st.linked) refreshLoop();
      if (window.Updates) window.Updates.init();
      if (P.native) P.call('app.ready').catch(function () {});
    }

    minDelay.then(function () {
      if (!UI.st.onb) {
        sp.hide();
        onboarding(function () {
          UI.st.onb = true; UI.save();
          if (P.native) P.call('app.notifPerm').catch(function () {});
          App.go('settings');
          if (App.views.settings.openCloud) App.views.settings.openCloud();
        });
        if (window.Updates) window.Updates.init();
      } else enter();
    });
  }

  function refreshLoop() {
    function go() { Api.refresh().then(function () { App.renderAll(); }).catch(function (e) { if (/AUTH|auth_|not_allowed/.test(e.message)) UI.toast(Api.explain(e), true); }); }
    go();
    setInterval(function () { if (!document.hidden && App.tab !== 'remote') go(); }, 45000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) go(); });
  }
  App.refresh = function () { return Api.refresh().then(function () { App.renderAll(); }); };

  document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
})();
