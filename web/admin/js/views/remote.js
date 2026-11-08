/* Remote control page: choose a screen, then a remote-like pad. Commands go over the instant channel. */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, App = window.App, L = UI.L, h = UI.h, ic = UI.ic;
  var cur = null, status = null, els = {};

  function dev() { return Api.S.devices.filter(function (d) { return d.id === cur; })[0] || Api.S.devices[0] || null; }

  function press(btn, op, arg, optimistic) {
    UI.buzz(14);
    btn.classList.remove('sent'); void btn.offsetWidth; btn.classList.add('sent');
    var d = dev(); if (!d) return;
    if (optimistic && status) { optimistic(status); paintStatus(); }
    Api.send(d, op, arg).catch(function (e) { UI.toast(Api.explain(e), true); });
  }

  function rbtn(icon, label, op, arg, cls, optimistic) {
    var b = h('button', { class: 'rbtn ' + (cls || ''), 'aria-label': label, html: ic(icon) + '<small>' + label + '</small>' });
    b.addEventListener('click', function () { press(b, op, arg, optimistic); });
    return b;
  }

  function paintStatus() {
    if (!els.name) return;
    var s = status, on = s && s.on;
    els.name.textContent = on ? s.n : (s ? L('Idle', 'متوقفة') : L('Waiting for the screen…', 'بانتظار الشاشة…'));
    els.pos.textContent = on ? s.i + ' / ' + s.c + (s.p ? ' · ' + L('Paused', 'متوقف مؤقتاً') : '') : (s ? s.c + L(' items ready', ' عنصر جاهز') : '');
    els.bar.style.width = on && s.d ? Math.min(100, 100 * s.t / s.d) + '%' : '0%';
    els.play.innerHTML = ic(on && !s.p ? 'pause' : 'play') + '<small></small>';
    els.mute.className = 'rbtn' + (s && s.mute ? ' on' : '');
    els.mute.innerHTML = ic(s && s.mute ? 'volume-x' : 'volume-2') + '<small>' + (s && s.mute ? L('Unmute', 'تشغيل الصوت') : L('Mute', 'كتم')) + '</small>';
  }

  function watch() {
    var d = dev();
    Api.stopWatch(); status = null; paintStatus();
    if (d) Api.startWatch(d, function (s) { status = s; paintStatus(); });
  }

  App.register('remote', {
    select: function (id) { cur = id; },
    render: function (col) {
      var devs = Api.S.devices;
      if (!devs.length) {
        col.appendChild(h('div', { class: 'empty' }, h('div', { class: 'art', html: '<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><g class="float"><rect x="62" y="24" width="76" height="152" rx="24"/><circle cx="100" cy="76" r="14"/><path d="M82 132h0M118 132h0M100 150h0" stroke-width="10"/></g></svg>' }),
          h('div', { class: 't', text: L('No screen to control', 'لا توجد شاشة للتحكم بها') }),
          h('button', { class: 'btn pri', text: L('Link a screen', 'ربط شاشة'), onclick: function () { App.go('screens'); } })));
        return;
      }
      if (!dev() || !cur) cur = devs[0].id;

      var pick = h('div', { class: 'devpick' });
      devs.forEach(function (d) {
        var c = h('button', { class: 'chip' + (d.id === cur ? ' on' : ''), html: '<i class="' + (d.lastSeen && Date.now() - d.lastSeen < 180000 ? 'on' : '') + '"></i>' });
        c.appendChild(document.createTextNode(d.name || d.id));
        c.addEventListener('click', function () { cur = d.id; App.render('remote'); watch(); });
        pick.appendChild(c);
      });
      if (devs.length > 1) col.appendChild(pick);

      els.name = h('div', { class: 'nm' }); els.pos = h('div', { class: 'pos' }); els.bar = h('i');
      col.appendChild(h('div', { class: 'card now' }, h('div', { class: 'top' }, h('div', { class: 'eq', html: ic('activity') }), h('div', { style: 'flex:1;min-width:0' }, els.name, els.pos)), h('div', { class: 'bar' }, els.bar)));

      els.play = h('button', { class: 'rbtn main', 'aria-label': 'play/pause' });
      els.play.addEventListener('click', function () { press(els.play, 'toggle', 0, function (s) { if (s.on) s.p = !s.p; else s.on = true; }); });
      els.mute = h('button', { class: 'rbtn', 'aria-label': 'mute' });
      els.mute.addEventListener('click', function () { press(els.mute, status && status.mute ? 'unmute' : 'mute', 0, function (s) { s.mute = !s.mute; }); });

      col.appendChild(h('div', { class: 'pad' },
        h('div', { class: 'line labelled' }, rbtn('skip-back', L('Previous', 'السابق'), 'prev'), els.play, rbtn('skip-forward', L('Next', 'التالي'), 'next')),
        h('div', { class: 'line labelled' }, rbtn('rewind', '−10s', 'seek', -10), els.mute, rbtn('fast-forward', '+10s', 'seek', 10)),
        h('div', { class: 'line labelled' }, rbtn('volume-1', L('Vol −', 'صوت −'), 'voldown'), rbtn('square', L('Stop', 'إيقاف'), 'stop', 0, 'warn'), rbtn('volume-2', L('Vol +', 'صوت +'), 'volup')),
        h('div', { class: 'line labelled' }, rbtn('rotate-ccw', L('Restart', 'من البداية'), 'restart'), rbtn('refresh-cw', L('Sync', 'مزامنة'), 'sync'), rbtn('power', L('Close app', 'إغلاق'), 'exit', 0, 'warn'))));
      col.appendChild(h('div', { class: 'hint', style: 'text-align:center', text: L('Commands reach the screen within a second when it is online.', 'تصل الأوامر إلى الشاشة خلال ثانية عندما تكون متصلة.') }));
      paintStatus();
    },
    show: function () { watch(); }
  });
})();
