/* Screens page: linked screens with status, link expiry, offline readiness, actions; add by 9-digit code. */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, App = window.App, L = UI.L, h = UI.h, ic = UI.ic;
  var DAY = 86400000;

  function online(d) { return d.lastSeen && Date.now() - d.lastSeen < 3 * 60000; }
  function daysLeft(d) { return Math.ceil(((d.linkExp || 0) - Api.now()) / DAY); }

  function fact(icon, key, val, cls, meter) {
    return h('div', { class: 'fact ' + (cls || '') }, h('div', { class: 'k', html: ic(icon) + '<span>' + key + '</span>' }),
      h('div', { class: 'v', text: val }), meter != null ? h('div', { class: 'meter' }, h('i', { style: 'width:' + Math.max(2, Math.min(100, meter)) + '%' })) : null);
  }

  function card(d, i) {
    var rep = d.rep || {}, on = online(d), left = daysLeft(d);
    var ready = rep.items ? Math.round(100 * (rep.ready || 0) / rep.items) : 100;
    var expCls = left <= 3 ? 'bad' : left <= 7 ? 'warn' : '';
    var readyCls = rep.items && ready < 100 ? 'warn' : 'ok';
    var playing = rep.playing ? rep.playing : '';
    var status = on ? (playing ? L('Playing: ', 'يعرض: ') + playing : L('Online', 'متصلة')) : L('Last seen ', 'آخر اتصال ') + UI.ago(d.lastSeen);

    var el = h('div', { class: 'card dev rise', style: '--i:' + i },
      h('div', { class: 'head' },
        h('div', { class: 'icon-wrap' }, h('span', { html: ic('tv') }), h('i', { class: 'dot' + (on ? ' on' : '') })),
        h('div', { class: 'meta' }, h('div', { class: 'nm', text: d.name || d.id }), h('div', { class: 'st', text: status })),
        h('button', { class: 'ibtn', 'aria-label': 'rename', html: ic('pencil'), onclick: function () { rename(d); } })),
      h('div', { class: 'facts' },
        fact('calendar', L('Link expires', 'انتهاء الربط'), left > 0 ? left + L(' days', ' يوم') : L('Expired', 'منتهي'), expCls, left > 0 ? left / 30 * 100 : 2),
        fact('download', L('Offline ready', 'جاهزية بدون إنترنت'), rep.items ? ready + '%' : '-', readyCls, rep.items ? ready : null),
        fact('hard-drive', L('Downloaded', 'تم تنزيله'), rep.total ? UI.fmtBytes(rep.bytes) + ' / ' + UI.fmtBytes(rep.total) : '-', ''),
        fact('smartphone', L('Screen app', 'تطبيق الشاشة'), rep.vn ? 'v' + rep.vn + (rep.upd ? ' ↑' : '') : '-', rep.upd ? 'warn' : '')),
      h('div', { class: 'row' },
        h('button', { class: 'btn soft small', html: ic('remote') + '<span>' + L('Remote', 'تحكم') + '</span>', onclick: function () { App.views.remote.select(d.id); App.go('remote'); } }),
        h('button', { class: 'btn small', html: ic('refresh-cw') + '<span>' + L('Renew link', 'تجديد الربط') + '</span>', onclick: function () { renew(d); } }),
        h('button', { class: 'btn danger small', html: ic('unlink'), 'aria-label': 'unlink', onclick: function () { unlink(d); } })));
    return el;
  }

  function renew(d) {
    Api.post('admin.device.update', { id: d.id, renew: true }).then(function () { UI.toast(L('Link renewed for 30 days', 'تم تجديد الربط لمدة ٣٠ يوماً')); return App.refresh(); })
      .catch(function (e) { UI.toast(Api.explain(e), true); });
  }
  function unlink(d) {
    UI.confirm(L('Unlink "', 'فك ربط "') + (d.name || d.id) + (L('" from this center?', '"؟')), L('Unlink', 'فك الربط'), true).then(function (ok) {
      if (!ok) return;
      Api.post('admin.device.unlink', { id: d.id }).then(function () { UI.toast(L('Screen unlinked', 'تم فك ربط الشاشة')); return App.refresh(); })
        .catch(function (e) { UI.toast(Api.explain(e), true); });
    });
  }
  function rename(d) {
    var inp = h('input', { type: 'text', value: d.name || '', maxlength: 40 });
    UI.sheet(L('Rename screen', 'تسمية الشاشة'), h('div', { class: 'form' }, UI.field(L('Name', 'الاسم'), inp)), [
      { label: L('Save', 'حفظ'), cls: 'pri', fn: function () {
        Api.post('admin.device.update', { id: d.id, name: inp.value.trim() }).then(function () { return App.refresh(); }).catch(function (e) { UI.toast(Api.explain(e), true); });
      } }]);
  }

  /* ---------- add by code ---------- */
  function addScreen() {
    var code = '', boxes = h('div', { class: 'codebox' }), name = h('input', { type: 'text', placeholder: L('Waiting room', 'صالة الانتظار'), maxlength: 40 });
    var hid = h('input', { type: 'text', inputmode: 'numeric', maxlength: 11, autocomplete: 'off', 'aria-label': 'code' });
    var digits = [];
    function mk() {
      boxes.innerHTML = ''; digits = [];
      for (var g = 0; g < 3; g++) {
        var grp = h('div', { class: 'grp' });
        for (var k = 0; k < 3; k++) { var d = h('div', { class: 'd' }); digits.push(d); grp.appendChild(d); }
        boxes.appendChild(grp);
      }
      boxes.appendChild(hid);
    }
    function paint() {
      digits.forEach(function (d, n) { d.textContent = code[n] || ''; d.className = 'd' + (code[n] ? ' fill' : '') + (n === code.length ? ' cur' : ''); });
    }
    mk(); paint();
    hid.addEventListener('input', function () { code = hid.value.replace(/\D/g, '').slice(0, 9); hid.value = code; paint(); UI.buzz(6); });
    var s = UI.sheet(L('Link a screen', 'ربط شاشة'), h('div', { class: 'form' },
      h('div', { class: 'hint', text: L('Open the screen app and type the 9-digit code shown on it.', 'افتحي تطبيق الشاشة واكتبي الكود المكوّن من ٩ أرقام الظاهر عليها.') }),
      boxes, UI.field(L('Screen name', 'اسم الشاشة'), name)), [
      { label: L('Link', 'ربط'), cls: 'pri', fn: function () {
        if (code.length !== 9) { UI.toast(L('Type all 9 digits', 'اكتبي الأرقام التسعة كاملة'), true); return false; }
        return Api.post('admin.pair', { code: code, name: name.value.trim() || L('Screen ', 'شاشة ') + (Api.S.devices.length + 1) }).then(function () {
          UI.confetti('big'); UI.toast(L('Screen linked', 'تم ربط الشاشة')); return App.refresh();
        }).catch(function (e) { UI.toast(Api.explain(e), true); return false; });
      } }]);
    setTimeout(function () { hid.focus(); }, 450);
    return s;
  }

  function art() {
    return '<svg class="art" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><rect x="28" y="48" width="144" height="92" rx="14"/><path d="M80 164h40M100 140v24"/><path class="blink" d="M92 80h16M92 96h16" /></g></svg>';
  }

  App.register('screens', {
    render: function (col) {
      var devs = Api.S.devices, nOn = devs.filter(online).length;
      if (!Api.S.loaded && UI.st.linked) { col.appendChild(h('div', { class: 'skeleton' })); col.appendChild(h('div', { class: 'skeleton' })); return; }
      if (!UI.st.linked) {
        col.appendChild(h('div', { class: 'empty' }, h('div', { html: art() }), h('div', { class: 't', text: L('Connect your cloud first', 'اربطي السحابة أولاً') }),
          h('div', { text: L('Sign in once to start managing screens.', 'سجّلي الدخول مرة واحدة لتبدأي بإدارة الشاشات.') }),
          h('button', { class: 'btn pri', html: ic('cloud') + '<span>' + L('Sign in to cloud', 'تسجيل الدخول إلى السحابة') + '</span>', onclick: function () { App.go('settings'); App.views.settings.openCloud(); } })));
        return;
      }
      if (!window.P.native && window.DR.GITHUB_REPO) col.appendChild(h('div', { class: 'banner' }, h('span', { html: ic('smartphone') }), h('div', { class: 'grow' }, L('Get the Android app', 'حمّلي تطبيق الأندرويد'), h('small', { text: L('Faster uploads in the background', 'رفع أسرع في الخلفية') })), h('button', { class: 'btn small pri', text: L('Download', 'تحميل'), onclick: function () { window.open('https://github.com/' + window.DR.GITHUB_REPO + '/releases/latest', '_blank', 'noopener'); } })));
      col.appendChild(h('div', { class: 'hero rise' }, h('div', { class: 'grow' },
        h('div', { class: 'big', text: devs.length ? nOn + L(' of ', ' من ') + devs.length + L(' online', ' متصلة') : L('No screens yet', 'لا توجد شاشات بعد') }),
        h('div', { class: 'small', text: devs.length ? L('Everything is synced to your cloud', 'كل شيء متزامن مع سحابتك') : L('Link your first screen with its code', 'اربطي أول شاشة بالكود الخاص بها') }))));
      if (!devs.length) col.appendChild(h('div', { class: 'empty' }, h('div', { html: art() })));
      devs.forEach(function (d, i) { col.appendChild(card(d, i + 1)); });
      col.appendChild(h('button', { class: 'btn pri block rise', style: '--i:' + (devs.length + 2), html: ic('plus') + '<span>' + L('Link a new screen', 'ربط شاشة جديدة') + '</span>', onclick: addScreen }));
    },
    show: function () { if (UI.st.linked) App.refresh().catch(function () {}); }
  });
  window.ScreensView = { addScreen: addScreen };
})();
