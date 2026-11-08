/* About page (description + features with "go to" buttons) and Updates page (GitHub releases). */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, App = window.App, P = window.P, C = window.DR, L = UI.L, h = UI.h, ic = UI.ic;
  var cur = { name: 'web', code: 0 };
  var U = { state: 'none', v: '', notes: '', pct: 0, url: '' };

  function repoUrl(p) { return C.GITHUB_REPO ? 'https://github.com/' + C.GITHUB_REPO + (p || '') : '#'; }
  function openUrl(u) { if (P.native) P.call('app.openUrl', { url: u }).catch(function () {}); else window.open(u, '_blank', 'noopener'); }

  /* ---------- updates ---------- */
  function setState(d) { if (d) { Object.assign(U, d); } App.updateChrome(); if (App.views.settings && App.tab === 'settings') App.render('settings'); paintUpd(); }

  function checkWeb() {
    if (!C.GITHUB_REPO) return Promise.resolve();
    setState({ state: 'checking' });
    return fetch('https://api.github.com/repos/' + C.GITHUB_REPO + '/releases/latest').then(function (r) { return r.json(); }).then(function (j) {
      var asset = (j.assets || []).filter(function (a) { return /admin.*\.apk$/i.test(a.name); })[0];
      setState({ state: j.tag_name ? 'info' : 'error', v: j.tag_name || '', notes: j.body || '', url: asset ? asset.browser_download_url : repoUrl('/releases/latest') });
    }).catch(function () { setState({ state: 'error' }); });
  }

  function check() {
    if (P.native) { setState({ state: 'checking' }); return P.call('update.check').catch(function () { setState({ state: 'error' }); }); }
    return checkWeb();
  }

  function init() {
    if (P.native) {
      P.on('update', setState);
      P.call('app.version').then(function (v) { cur = v || cur; }).catch(function () {});
      P.call('update.state').then(setState).catch(function () {});
    } else checkWeb();
  }

  function pending() { return P.native && (U.state === 'ready' || U.state === 'downloading'); }

  function mdToNodes(md) {
    var box = h('div', { class: 'notes' }), ul = null;
    String(md || '').split('<!--end-->')[0].split(/\r?\n/).forEach(function (line) {
      var m;
      if (/^\s*(<|!\[)/.test(line)) return;
      if ((m = /^\s*[-*]\s+(.*)/.exec(line))) { if (!ul) { ul = h('ul'); box.appendChild(ul); } ul.appendChild(h('li', { text: m[1].replace(/[*_`]/g, '') })); return; }
      ul = null;
      if ((m = /^#+\s*(.*)/.exec(line))) box.appendChild(h('h4', { text: m[1] }));
      else if (line.trim()) box.appendChild(h('p', { text: line.replace(/[*_`]/g, '') }));
    });
    return box;
  }

  var updBody = null;
  function paintUpd() {
    if (!updBody || !updBody.isConnected) return;
    updBody.innerHTML = '';
    var msg = { none: L('Check for updates', 'ابحثي عن تحديث'), checking: L('Checking…', 'جارٍ البحث…'), uptodate: L('You are up to date', 'التطبيق محدّث'),
      downloading: L('Downloading update… ', 'جارٍ تنزيل التحديث… ') + (U.pct || 0) + '%', ready: L('Update ready to install', 'التحديث جاهز للتثبيت'), info: L('Latest release ', 'آخر إصدار ') + U.v, error: L('Could not check. Try again later.', 'تعذر التحقق. حاولي لاحقاً.') }[U.state];
    updBody.appendChild(h('div', { class: 'ver-card' }, h('div', { text: L('Version', 'الإصدار') }), h('div', { class: 'v', text: cur.name }), h('div', { text: msg })));
    if (U.state === 'downloading') updBody.appendChild(h('div', { class: 'meter' }, h('i', { style: 'width:' + (U.pct || 2) + '%' })));
    if (U.state === 'ready') updBody.appendChild(h('button', { class: 'btn pri block', html: ic('download') + '<span>' + L('Install now', 'تثبيت الآن') + '</span>', onclick: function () { P.call('update.install').catch(function () {}); } }));
    if (!P.native && U.url) updBody.appendChild(h('button', { class: 'btn pri block', html: ic('download') + '<span>' + L('Download the Android app', 'تحميل تطبيق الأندرويد') + '</span>', onclick: function () { openUrl(U.url); } }));
    updBody.appendChild(h('button', { class: 'btn block', html: ic('refresh-cw') + '<span>' + L('Check now', 'تحقق الآن') + '</span>', onclick: check }));
    if (U.notes) { updBody.appendChild(h('div', { class: 'sect', text: L('What is new', 'ما الجديد') })); updBody.appendChild(h('div', { class: 'card' }, mdToNodes(U.notes))); }
    var s = Api.S.cfg && Api.S.cfg.screenUpdate;
    if (s) updBody.appendChild(h('div', { class: 'hint', text: L('Screen app update announced: ', 'تحديث تطبيق الشاشة المعلن: ') + (s.name || s.v) }));
  }

  function openUpdates() {
    App.openSub(L('Updates', 'التحديثات'), function (col) { updBody = h('div', { class: 'col', style: 'padding:0' }); col.appendChild(updBody); paintUpd(); });
    if (U.state === 'none' || U.state === 'error') check();
  }

  /* ---------- about ---------- */
  var FEATURES = [
    ['link', 'Link screens', 'ربط الشاشات', 'Pair any Android screen with a 9-digit code, see expiry and readiness.', 'اربطي أي شاشة أندرويد بكود من ٩ أرقام وتابعي الانتهاء والجاهزية.', function () { App.go('screens'); }],
    ['film', 'Content library', 'مكتبة المحتوى', 'Videos, images, slides and text with short names, order and per-screen control.', 'فيديو وصور وشرائح ونصوص بأسماء قصيرة وترتيب وتحكم لكل شاشة.', function () { App.go('library'); }],
    ['upload', 'Background upload', 'الرفع في الخلفية', 'Multiple files, progress in the notification, retry with the reason on failure.', 'ملفات متعددة وتقدم في الإشعار وإعادة المحاولة مع ذكر السبب.', function () { window.UploadSheet.open(); }],
    ['type', 'Text slide editor', 'محرر الشرائح النصية', 'Touch-friendly fonts, colors, effects and image placement.', 'خطوط وألوان وتأثيرات ووضع الصور بلمسة.', function () { window.UploadSheet.open(); }],
    ['remote', 'Instant remote control', 'تحكم فوري عن بُعد', 'Next, previous, pause, mute and more, wirelessly.', 'التالي والسابق والإيقاف وكتم الصوت وغيرها لاسلكياً.', function () { App.go('remote'); }],
    ['cloud', 'Multi-cloud storage', 'تخزين متعدد السحابات', 'Google Drive by default, plus other clouds, with remaining space shown.', 'كوكل درايف افتراضياً مع سحابات أخرى وعرض المساحة المتبقية.', function () { App.go('settings'); App.views.settings.openCloud(); }],
    ['package', 'Automatic updates', 'تحديثات تلقائية', 'The app and the screens update themselves from GitHub releases.', 'يتحدث التطبيق والشاشات تلقائياً من إصدارات جيت هب.', openUpdates]
  ];

  function openAbout() {
    App.openSub(L('About', 'حول التطبيق'), function (col) {
      col.appendChild(h('div', { class: 'about-hero' }, h('img', { src: '../shared/brand/logo-full.png', alt: '' }),
        h('div', { class: 'hint', text: L('Version ', 'الإصدار ') + cur.name })));
      col.appendChild(h('div', { class: 'card' }, h('div', { text: L(
        'A free, open-source signage system for medical centers. Manage the waiting-room screens from your phone: link screens, upload content to your own cloud and control playback instantly.',
        'نظام عرض مجاني ومفتوح المصدر للمراكز الطبية. أدِيري شاشات صالة الانتظار من هاتفك: اربطي الشاشات وارفعي المحتوى إلى سحابتك وتحكمي بالعرض فورياً.') })));
      col.appendChild(h('div', { class: 'sect', text: L('Features', 'المزايا') }));
      FEATURES.forEach(function (f, i) {
        col.appendChild(h('div', { class: 'card feature rise', style: '--i:' + i },
          h('div', { class: 'badge-ic', html: ic(f[0]) }), h('div', { class: 'tx' }, h('b', { text: L(f[1], f[2]) }), h('span', { text: L(f[3], f[4]) })),
          h('button', { class: 'btn small soft', text: L('Open', 'افتح'), onclick: function () { App.back(); setTimeout(f[5], 250); } })));
      });
      col.appendChild(h('div', { class: 'card feature' }, h('div', { class: 'badge-ic', html: ic('github') }), h('div', { class: 'tx' }, h('b', { text: L('Open source', 'مفتوح المصدر') }), h('span', { text: L('Read the code and contribute on GitHub.', 'اقرأي الشيفرة وشاركي على جيت هب.') })),
        h('button', { class: 'btn small soft', text: 'GitHub', onclick: function () { openUrl(repoUrl()); } })));
      col.appendChild(h('div', { class: 'credit' }, h('a', { href: C.DEV_SITE, html: ic('sparkles') + '<span>' + L('Made by ', 'تطوير ') + '<b>' + C.DEV_NAME + '</b></span>', onclick: function (e) { e.preventDefault(); openUrl(C.DEV_SITE); } })));
    });
  }

  window.Updates = { init: init, pending: pending, open: openUpdates, check: check, state: function () { return U; } };
  window.About = { open: openAbout };
})();
