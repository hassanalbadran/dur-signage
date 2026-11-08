/* Settings page: smooth accordions (Cloud, Appearance, Languages, Uploads, Storage) + About / Updates + credit. */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, App = window.App, P = window.P, C = window.DR, L = UI.L, h = UI.h, ic = UI.ic;
  var openId = '', clouds = null;
  var PROV = {
    drive: { name: 'Google Drive', mark: 'G', color: '#3A93B5' },
    dropbox: { name: 'Dropbox', mark: 'D', color: '#2B6FD6' },
    onedrive: { name: 'OneDrive', mark: 'O', color: '#2A7DB8' }
  };

  function loadClouds() {
    var p;
    if (P.native) p = P.call('cloud.list');
    else {
      p = window.Drive.gjson('https://www.googleapis.com/drive/v3/about?fields=storageQuota').then(function (j) {
        var q = j.storageQuota || {};
        return [{ p: 'drive', connected: UI.st.linked, email: Api.S.email, used: Number(q.usage || 0), total: Number(q.limit || 0), def: true }];
      }).catch(function () { return [{ p: 'drive', connected: UI.st.linked, email: Api.S.email, def: true }]; });
    }
    return p.then(function (list) { clouds = list || []; App.render('settings'); }).catch(function () { clouds = clouds || []; });
  }

  function provider(c) {
    var meta = PROV[c.p] || { name: c.p, mark: '?', color: '#888' };
    var pct = c.total ? Math.round(100 * c.used / c.total) : 0;
    var left = c.total ? UI.fmtBytes(c.total - c.used) : null;
    var btn = c.connected
      ? h('button', { class: 'btn small danger', text: L('Disconnect', 'فصل'), onclick: function () { disconnect(c.p); } })
      : h('button', { class: 'btn small pri', text: L('Connect', 'ربط'), onclick: function () { connect(c.p); } });
    return h('div', { class: 'prov' },
      h('div', { class: 'top' }, h('div', { class: 'mark', style: 'background:' + meta.color, text: meta.mark }),
        h('div', { class: 'pn' }, h('b', { text: meta.name + (c.def ? L('  (default)', '  (الافتراضي)') : '') }),
          h('small', { text: c.connected ? (c.email || L('Connected', 'متصل')) : L('Not connected', 'غير متصل') })), btn),
      c.connected ? h('div', null, h('div', { class: 'meter' }, h('i', { style: 'width:' + Math.max(2, pct) + '%' })),
        h('div', { class: 'hint', style: 'margin-top:.35rem', text: c.total ? L('Remaining ', 'المتبقي ') + left + L(' of ', ' من ') + UI.fmtBytes(c.total) : L('Space info unavailable', 'معلومات المساحة غير متاحة') })) : null);
  }

  function connect(p) {
    var run = p === 'drive' ? App.signIn() : P.call('cloud.connect', { p: p });
    run.then(function () { UI.confetti(); return loadClouds(); }).catch(function (e) { UI.toast(Api.explain(e), true); });
  }
  function disconnect(p) {
    UI.confirm(L('Disconnect this cloud? Files already uploaded stay where they are.', 'فصل هذه السحابة؟ الملفات المرفوعة تبقى في مكانها.'), L('Disconnect', 'فصل'), true).then(function (ok) {
      if (!ok) return;
      var run = P.native ? P.call('cloud.disconnect', { p: p }) : Promise.resolve(window.Drive.signOut());
      run.then(function () { if (p === 'drive') { UI.st.linked = false; UI.save(); } return loadClouds(); }).then(function () { App.renderAll(); });
    });
  }

  function accordion(id, icon, title, sub, build) {
    var el = h('div', { class: 'card acc rise' + (openId === id ? ' open' : '') });
    var inner = h('div', { class: 'inner' });
    el.appendChild(h('button', { class: 'hd', onclick: function () {
      var was = el.classList.contains('open');
      [].forEach.call(el.parentNode.querySelectorAll('.acc.open'), function (x) { x.classList.remove('open'); });
      if (!was) el.classList.add('open');
      openId = was ? '' : id; UI.buzz(8);
    } }, h('span', { class: 'badge-ic', html: ic(icon) }), h('span', { class: 't' }, title, sub ? h('div', { class: 'sub', text: sub }) : null), h('span', { class: 'chev', html: ic('chevron-down') })));
    el.appendChild(h('div', { class: 'bd' }, h('div', null, inner)));
    build(inner);
    return el;
  }

  function line(title, desc, ctrl) {
    return h('div', { class: 'rowline' }, h('div', null, h('div', { class: 't', text: title }), desc ? h('div', { class: 'd', text: desc }) : null), ctrl);
  }

  function setLang(l) { UI.st.lang = l; UI.save(); UI.applyLook(); App.rebuild(); if (P.native) P.call('prefs.set', { lang: l }).catch(function () {}); }

  if (P.native) P.on('cloud', function () { loadClouds(); });

  App.register('settings', {
    openCloud: function () { openId = 'cloud'; App.render('settings'); loadClouds(); if (!UI.st.linked && P.native) setTimeout(function () { connect('drive'); }, 500); },
    render: function (col) {
      var i = 0;
      function add(el) { el.style.setProperty('--i', String(i++)); col.appendChild(el); }

      add(accordion('cloud', 'cloud', L('Cloud storage', 'التخزين السحابي'), UI.st.linked ? (Api.S.email || L('Connected', 'متصل')) : L('Not connected', 'غير متصل'), function (b) {
        if (!clouds) { b.appendChild(h('div', { class: 'skeleton' })); loadClouds(); return; }
        (clouds.length ? clouds : [{ p: 'drive', connected: false }, { p: 'dropbox', connected: false }, { p: 'onedrive', connected: false }]).forEach(function (c) { b.appendChild(provider(c)); });
        if (P.native) {
          var have = ['dropbox', 'onedrive'].some(function (p) { return !clouds.filter(function (c) { return c.p === p; }).length; });
          if (have) b.appendChild(h('div', { class: 'hint', text: L('More providers can be added by connecting them above.', 'يمكن إضافة مزودين آخرين بربطهم من الأعلى.') }));
        }
        b.appendChild(h('div', { class: 'hint', text: L('Every upload is mirrored to all connected clouds. Google Drive is the default.', 'كل ملف يُرفع إلى جميع السحابات المربوطة. كوكل درايف هو الافتراضي.') }));
      }));

      add(accordion('look', 'sun', L('Appearance', 'المظهر'), '', function (b) {
        b.appendChild(UI.field(L('Theme', 'السمة'), UI.seg([['auto', L('Auto', 'تلقائي')], ['light', L('Light', 'فاتح')], ['dark', L('Dark', 'داكن')]], UI.st.theme, function (v) { UI.st.theme = v; UI.save(); UI.applyLook(); })));
        var fs = h('input', { type: 'range', min: .85, max: 1.3, step: .05, value: UI.st.fs });
        fs.addEventListener('input', function () { UI.st.fs = Number(fs.value); UI.save(); UI.applyLook(); });
        b.appendChild(UI.field(L('Font size', 'حجم الخط'), fs));
        b.appendChild(line(L('Reduce animations', 'تقليل الحركة'), '', UI.sw(UI.st.reduce, function (v) { UI.st.reduce = v; UI.save(); UI.applyLook(); })));
        b.appendChild(line(L('Haptic feedback', 'الاهتزاز عند اللمس'), '', UI.sw(UI.st.haptic, function (v) { UI.st.haptic = v; UI.save(); })));
      }));

      add(accordion('lang', 'globe', L('Languages', 'اللغات'), '', function (b) {
        b.appendChild(UI.field(L('App language', 'لغة التطبيق'), UI.seg([['en', 'English'], ['ar', 'العربية']], UI.st.lang, setLang)));
        b.appendChild(UI.field(L('Screen language', 'لغة الشاشة'), UI.seg([['en', 'English'], ['ar', 'العربية']], Api.S.cfg.screenLang || UI.st.sLang, function (v) {
          UI.st.sLang = v; UI.save();
          Api.post('admin.cfg.set', { screenLang: v }).then(function () { Api.S.cfg.screenLang = v; UI.toast(L('Screens will switch shortly', 'ستتغير الشاشات خلال لحظات')); }).catch(function (e) { UI.toast(Api.explain(e), true); });
        })));
      }));

      add(accordion('up', 'upload', L('Uploads & notifications', 'الرفع والإشعارات'), '', function (b) {
        b.appendChild(line(L('Upload on Wi-Fi only', 'الرفع عبر واي فاي فقط'), L('Saves mobile data', 'يوفر بيانات الهاتف'), UI.sw(UI.st.wifiOnly, function (v) { UI.st.wifiOnly = v; UI.save(); if (P.native) P.call('prefs.set', { wifiOnly: v }).catch(function () {}); })));
        b.appendChild(line(L('Notifications', 'الإشعارات'), L('Progress, finished and failed uploads', 'تقدم الرفع واكتماله وفشله'), UI.sw(UI.st.notif, function (v) { UI.st.notif = v; UI.save(); if (P.native) P.call('prefs.set', { notif: v }).catch(function () {}); })));
      }));

      add(accordion('store', 'hard-drive', L('Storage', 'التخزين'), '', function (b) {
        b.appendChild(h('div', { class: 'hint', text: L('Clears the app\'s local copy. Your cloud files are not touched.', 'يمسح النسخة المحلية في التطبيق. ملفاتك في السحابة لا تتأثر.') }));
        b.appendChild(h('button', { class: 'btn danger', html: ic('trash-2') + '<span>' + L('Clear app cache', 'مسح ذاكرة التطبيق') + '</span>', onclick: function () {
          try { localStorage.removeItem('dra_state'); } catch (e) { /* ignore */ }
          if (P.native) P.call('app.clearCache').catch(function () {});
          Api.S.items = []; Api.S.devices = []; UI.toast(L('Cache cleared', 'تم مسح الذاكرة')); App.refresh().catch(function () {});
        } }));
      }));

      var upd = window.Updates && window.Updates.pending();
      add(h('div', { class: 'card acc rise' },
        h('button', { class: 'navrow', onclick: function () { window.Updates.open(); } }, h('span', { class: 'badge-ic', style: 'width:2.4rem;height:2.4rem;border-radius:14px;background:var(--pri-soft);color:var(--pri);display:grid;place-items:center', html: ic('package') }),
          h('span', { class: 't', text: L('Updates', 'التحديثات') }), upd ? h('span', { class: 'badge', text: L('New', 'جديد') }) : null, h('span', { html: ic('chevron-right') })),
        h('button', { class: 'navrow', onclick: function () { window.About.open(); } }, h('span', { style: 'width:2.4rem;height:2.4rem;border-radius:14px;background:var(--pri-soft);color:var(--pri);display:grid;place-items:center', html: ic('info') }),
          h('span', { class: 't', text: L('About', 'حول التطبيق') }), h('span', { html: ic('chevron-right') }))));

      col.appendChild(h('div', { class: 'credit' }, h('a', { href: C.DEV_SITE, target: '_blank', rel: 'noopener', html: ic('sparkles') + '<span>' + L('Made by ', 'تطوير ') + '<b>' + C.DEV_NAME + '</b></span>',
        onclick: function (e) { if (P.native) { e.preventDefault(); P.call('app.openUrl', { url: C.DEV_SITE }).catch(function () {}); } } })));
    }
  });
})();
