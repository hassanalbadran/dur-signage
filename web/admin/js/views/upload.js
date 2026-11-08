/* Upload sheet (opened from the logo), queue sheet (from the bubble) and share-target sheet. */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, App = window.App, Up = window.Up, P = window.P, L = UI.L, h = UI.h, ic = UI.ic;
  var lastTargets = 'all';

  function needCloud() {
    if (UI.st.linked) return false;
    UI.toast(L('Connect your cloud first', 'اربطي السحابة أولاً'), true);
    App.go('settings'); App.views.settings.openCloud();
    return true;
  }

  function open() {
    if (needCloud()) return;
    var targets = lastTargets;
    var picker = window.TargetsPicker(targets, function (t) { targets = t; lastTargets = t; });
    var sh;
    function tile(icon, en, ar, fn) {
      return h('button', { class: 'tile', html: ic(icon) + '<span>' + L(en, ar) + '</span>', onclick: fn });
    }
    function pick(kind) { sh.close(); Up.pick(kind, targets).catch(function (e) { if (e.message !== 'CANCELLED') UI.toast(Api.explain(e), true); }); }
    var body = h('div', { class: 'form' },
      h('div', { class: 'sect', text: L('Show on', 'العرض على') }), picker,
      h('div', { class: 'sect', text: L('What do you want to add?', 'ماذا تريدين أن تضيفي؟') }),
      h('div', { class: 'tiles' },
        tile('film', 'Videos', 'فيديو', function () { pick('video'); }),
        tile('image', 'Images', 'صور', function () { pick('image'); }),
        tile('presentation', 'Slides (PDF / PPTX)', 'شرائح (PDF / PPTX)', function () { pick('slides'); }),
        tile('type', 'Text slide', 'شريحة نصية', function () {
          sh.close();
          setTimeout(function () {
            window.TextEditor.open(null).then(function (r) {
              if (!r) return;
              return window.TextGlue.commit(null, r, targets).then(function (it) { Api.upsert(it); App.renderAll(); UI.confetti(); UI.toast(L('Slide added', 'تمت إضافة الشريحة')); });
            }).catch(function (e) { UI.toast(Api.explain(e), true); });
          }, 300);
        })));
    sh = UI.sheet(L('Add content', 'إضافة محتوى'), body, null);
  }

  function queue() {
    var list = h('div', { class: 'qlist' }), sh;
    function paint(q) {
      list.innerHTML = '';
      if (!q.length) { list.appendChild(h('div', { class: 'empty', text: L('No uploads', 'لا توجد عمليات رفع') })); return; }
      q.forEach(function (r) {
        var pct = r.size ? Math.min(100, Math.round(100 * (r.done || 0) / r.size)) : (r.status === 'done' ? 100 : 0);
        var stx = { wait: L('Waiting', 'بالانتظار'), up: pct + '%', done: L('Done', 'تم'), fail: L('Failed', 'فشل') }[r.status] || '';
        var row = h('div', { class: 'qrow' + (r.status === 'fail' ? ' fail' : '') },
          h('div', { class: 'qtop' }, h('div', { class: 'nm', text: r.name }), h('div', { class: 'stx', text: stx })),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + (r.status === 'fail' ? 100 : pct) + '%' })));
        if (r.status === 'fail') {
          row.appendChild(h('div', { class: 'qerr' }, h('span', { text: r.err || L('Unknown error', 'سبب غير معروف') }),
            h('button', { class: 'btn small soft', html: ic('refresh-cw') + '<span>' + L('Retry', 'إعادة المحاولة') + '</span>', onclick: function () { Up.retry(r.id); } }),
            h('button', { class: 'btn small', text: L('Remove', 'إزالة'), onclick: function () { Up.cancel(r.id); } })));
        } else if (r.status === 'wait') {
          row.appendChild(h('button', { class: 'btn small', text: L('Cancel', 'إلغاء'), onclick: function () { Up.cancel(r.id); } }));
        }
        list.appendChild(row);
      });
    }
    var fn = function (q) { paint(q); };
    Up.subscribe(fn);
    sh = UI.sheet(L('Uploads', 'الرفع'), list, [{ label: L('Clear finished', 'مسح المنتهية'), fn: function () { Up.clearDone(); return false; } }], {});
  }

  /* Files shared into the app from the gallery or any other app: ask only which screens. */
  function share(d) {
    if (needCloud()) { if (P.native) P.call('share.cancel', {}).catch(function () {}); return; }
    var targets = 'all', n = (d && d.count) || 1;
    var picker = window.TargetsPicker('all', function (t) { targets = t; });
    var started = false;
    UI.sheet(L('Show on which screens?', 'العرض على أي شاشة؟'), h('div', { class: 'form' },
      h('div', { class: 'hint', text: n + L(' file(s) will be uploaded in the background', ' ملف سيُرفع في الخلفية') }), picker),
      [{ label: L('Upload', 'رفع'), cls: 'pri', fn: function () { started = true; P.call('share.start', { targets: targets }).catch(function (e) { UI.toast(Api.explain(e), true); }); } }],
      { onclose: function () { if (!started) P.call('share.cancel', {}).catch(function () {}); } });
  }

  window.UploadSheet = { open: open, queue: queue, share: share };
})();
