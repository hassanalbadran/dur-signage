/* Library page: search, filters, multi-select, edit sheet (name, order, screens, fit, duration, schedule). */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, App = window.App, L = UI.L, h = UI.h, ic = UI.ic;
  var view = { q: '', kind: 'all', sel: {} };
  var KINDS = [['all', 'All', 'الكل'], ['video', 'Videos', 'فيديو'], ['image', 'Images', 'صور'], ['text', 'Text', 'نصوص'], ['slides', 'Slides', 'شرائح']];
  var FITS = [['contain', 'minimize', 'Fit', 'ملاءمة'], ['cover', 'crop', 'Fill', 'ملء'], ['fill', 'maximize', 'Stretch', 'تمديد']];

  function isSlides(k) { return k === 'pdf' || k === 'gslides'; }
  function fileId(it) {
    var s = it.file && it.file.src && it.file.src.filter(function (x) { return x.p === 'drive'; })[0];
    return s ? s.id : (it.file && it.file.id) || '';
  }
  function save(it) { return Api.post('admin.item.save', { item: it }).then(function () { it.v = Date.now(); Api.upsert(it); App.renderAll(); }); }
  function fail(e) { UI.toast(Api.explain(e), true); }
  function selIds() { return Object.keys(view.sel); }

  function thumb(it) {
    var box = h('div', { class: 'thumb' }, h('span', { html: ic(Api.kindIcon(it.k)) }), h('span', { class: 'seq', text: '#' + (it.n || '') }));
    var id = (it.k === 'image' || it.k === 'video') ? fileId(it) : (it.sid || '');
    if (id && window.Drive) {
      var img = h('img', { src: window.Drive.thumbUrl(id), loading: 'lazy', alt: '' });
      img.addEventListener('load', function () { box.insertBefore(img, box.firstChild); });
    }
    return box;
  }

  function row(it, i) {
    var pressTimer = 0, long = false;
    var el = h('div', { class: 'card item rise press' + (it.on === false ? ' off' : '') + (view.sel[it.id] ? ' sel' : ''), style: '--i:' + Math.min(i, 12) },
      thumb(it),
      h('div', { class: 'meta' }, h('div', { class: 'nm', text: it.name }),
        h('div', { class: 'sub', html: ic('tv') + '<span></span>' })),
      h('button', { class: 'pick', 'aria-label': 'select', html: ic('check') }));
    el.querySelector('.sub span').textContent = Api.targetsText(it);
    function toggle() { if (view.sel[it.id]) delete view.sel[it.id]; else view.sel[it.id] = 1; UI.buzz(10); App.render('library'); }
    el.querySelector('.pick').addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    el.addEventListener('pointerdown', function () { long = false; pressTimer = setTimeout(function () { long = true; toggle(); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(function (n) { el.addEventListener(n, function () { clearTimeout(pressTimer); }); });
    el.addEventListener('click', function () {
      if (long) return;
      if (selIds().length) toggle(); else edit(it);
    });
    return el;
  }

  function match(it) {
    if (view.kind === 'slides' ? !isSlides(it.k) : (view.kind !== 'all' && it.k !== view.kind)) return false;
    return !view.q || (it.name || '').toLowerCase().indexOf(view.q.toLowerCase()) >= 0;
  }

  /* ---------- screens chooser ---------- */
  function targetsPicker(current, onchange) {
    var all = current === 'all' || !current, set = {};
    if (!all) current.forEach(function (id) { set[id] = 1; });
    var box = h('div', { class: 'checks' });
    function emit() { onchange(all ? 'all' : Object.keys(set)); }
    function paint() {
      box.innerHTML = '';
      function rowFor(label, sub, on, fn) {
        var r = h('button', { class: 'crow' + (on ? ' on' : '') }, h('span', { class: 'cb', html: ic('check') }), h('span', { class: 'ct' }, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
        r.addEventListener('click', function () { fn(); UI.buzz(8); paint(); emit(); });
        box.appendChild(r);
      }
      rowFor(L('All screens', 'كل الشاشات'), L('Including screens linked later', 'بما فيها الشاشات المربوطة لاحقاً'), all, function () { all = true; set = {}; });
      Api.S.devices.forEach(function (d) {
        rowFor(d.name || d.id, '', !all && set[d.id], function () { if (all) { all = false; set = {}; } if (set[d.id]) delete set[d.id]; else set[d.id] = 1; if (!Object.keys(set).length) all = true; });
      });
    }
    paint();
    return box;
  }

  /* ---------- edit one item ---------- */
  function edit(it) {
    var d = UI.clone(it);
    var m = /^(.*?)\s*(\d+)$/.exec(d.name || '') || [0, d.name || '', String(d.n || '')];
    var word = h('input', { type: 'text', value: m[1] || Api.kindWord(d.k), maxlength: 30 });
    var num = h('input', { type: 'number', value: m[2] || d.n || 1, min: 0 });
    var dur = h('input', { type: 'number', min: 2, max: 600, value: d.dur || (d.k === 'text' ? window.DR.TEXT_SEC : window.DR.IMAGE_SEC) });
    var pdur = h('input', { type: 'number', min: 2, max: 120, value: d.pdur || window.DR.PAGE_SEC });
    var from = h('input', { type: 'date', value: d.ts ? new Date(d.ts).toISOString().slice(0, 10) : '' });
    var to = h('input', { type: 'date', value: d.te ? new Date(d.te).toISOString().slice(0, 10) : '' });
    var fitBox = h('div', { class: 'fits' });
    function paintFit() {
      fitBox.innerHTML = '';
      FITS.forEach(function (f) {
        var b = h('button', { class: d.fit === f[0] || (!d.fit && f[0] === 'contain') ? 'on' : '', html: ic(f[1]) + '<span>' + L(f[2], f[3]) + '</span>' });
        b.addEventListener('click', function () { d.fit = f[0]; paintFit(); });
        fitBox.appendChild(b);
      });
    }
    paintFit();

    var body = h('div', { class: 'form' },
      h('div', { class: 'two' }, UI.field(L('Name', 'الاسم'), word), UI.field(L('Number', 'الرقم'), num)),
      h('div', { class: 'rowline' }, h('div', null, h('div', { class: 't', text: L('Show on screens', 'العرض على الشاشات') }), h('div', { class: 'd', text: L('Turn off to hide without deleting', 'أطفئيه للإخفاء دون حذف') })),
        UI.sw(d.on !== false, function (v) { d.on = v; })),
      h('div', { class: 'sect', text: L('Screens', 'الشاشات') }),
      targetsPicker(d.targets, function (t) { d.targets = t; }));
    if (d.k === 'video' || d.k === 'image' || d.k === 'pdf' || d.k === 'gslides') {
      body.appendChild(h('div', { class: 'sect', text: L('Fit', 'ملاءمة العرض') }));
      body.appendChild(fitBox);
    }
    if (d.k === 'image' || d.k === 'text') body.appendChild(UI.field(L('Seconds on screen', 'ثوانٍ على الشاشة'), dur));
    if (isSlides(d.k)) body.appendChild(UI.field(L('Seconds per page', 'ثوانٍ لكل صفحة'), pdur));
    body.appendChild(h('div', { class: 'sect', text: L('Schedule (optional)', 'الجدولة (اختياري)') }));
    body.appendChild(h('div', { class: 'two' }, UI.field(L('From', 'من'), from), UI.field(L('Until', 'إلى'), to)));
    body.appendChild(h('div', { class: 'row', style: 'display:flex;gap:.5rem' },
      h('button', { class: 'btn small', html: ic('arrow-up') + '<span>' + L('Earlier', 'أبكر') + '</span>', onclick: function () { move(it, -1); } }),
      h('button', { class: 'btn small', html: ic('arrow-down') + '<span>' + L('Later', 'أبعد') + '</span>', onclick: function () { move(it, 1); } })));

    var actions = [
      { label: L('Delete', 'حذف'), cls: 'danger', fn: function () { remove([it.id]); } },
      { label: L('Save', 'حفظ'), cls: 'pri', fn: function () {
        d.name = (word.value.trim() + ' ' + num.value).trim();
        if (d.k === 'image' || d.k === 'text') d.dur = Math.max(2, Number(dur.value) || 10);
        if (isSlides(d.k)) d.pdur = Math.max(2, Number(pdur.value) || 8);
        d.ts = from.value ? new Date(from.value).getTime() : 0;
        d.te = to.value ? new Date(to.value + 'T23:59:59').getTime() : 0;
        return save(d).then(function () { UI.toast(L('Saved', 'تم الحفظ')); }).catch(function (e) { fail(e); return false; });
      } }
    ];
    if (d.k === 'text') actions.unshift({ label: L('Edit slide', 'تحرير الشريحة'), fn: function () { setTimeout(function () { editText(it); }, 300); } });
    UI.sheet(it.name, body, actions, { full: true });
  }

  function editText(it) {
    window.TextEditor.open(it).then(function (r) {
      if (!r) return;
      return window.TextGlue.commit(it, r, it.targets).then(function (saved) { Api.upsert(saved); App.renderAll(); UI.toast(L('Saved', 'تم الحفظ')); });
    }).catch(fail);
  }

  function move(it, dir) {
    var list = Api.S.items.slice().sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
    var i = list.indexOf(list.filter(function (x) { return x.id === it.id; })[0]), j = i + dir;
    if (j < 0 || j >= list.length) return;
    var a = list[i], b = list[j], na = a.n, nb = b.n;
    a.n = nb; b.n = na;
    Api.post('admin.items.seq', { changes: [{ id: a.id, n: a.n }, { id: b.id, n: b.n }] }).then(function () { Api.saveCache(); App.renderAll(); }).catch(function (e) { a.n = na; b.n = nb; fail(e); });
  }

  function remove(ids) {
    UI.confirm(L('Delete ', 'حذف ') + ids.length + L(' item(s) from the library?', ' عنصر من المكتبة؟'), L('Delete', 'حذف'), true).then(function (ok) {
      if (!ok) return;
      Api.post('admin.item.delete', { ids: ids }).then(function () {
        Api.S.items = Api.S.items.filter(function (x) { return ids.indexOf(x.id) < 0; }); view.sel = {}; Api.saveCache(); App.renderAll();
      }).catch(fail);
    });
  }

  function bulk() {
    var ids = selIds();
    function patch(p) { return Api.post('admin.items.patch', { ids: ids, patch: p }).then(function () { return Api.refresh(); }).then(function () { view.sel = {}; App.renderAll(); }).catch(fail); }
    var tg = 'all';
    var body = h('div', { class: 'form' }, h('div', { class: 'sect', text: L('Show on', 'عرض على') }), targetsPicker('all', function (t) { tg = t; }));
    return h('div', { class: 'selbar' },
      h('div', { class: 'grow', text: ids.length + L(' selected', ' محدد') }),
      h('button', { class: 'ibtn', 'aria-label': 'screens', html: ic('tv'), onclick: function () { UI.sheet(L('Choose screens', 'اختاري الشاشات'), body, [{ label: L('Apply', 'تطبيق'), cls: 'pri', fn: function () { patch({ targets: tg }); } }]); } }),
      h('button', { class: 'ibtn', 'aria-label': 'show', html: ic('eye'), onclick: function () { patch({ on: true }); } }),
      h('button', { class: 'ibtn', 'aria-label': 'delete', html: ic('trash-2'), onclick: function () { remove(ids); } }),
      h('button', { class: 'ibtn', 'aria-label': 'cancel', html: ic('x'), onclick: function () { view.sel = {}; App.render('library'); } }));
  }

  App.register('library', {
    render: function (col) {
      var items = Api.S.items.slice().sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
      var search = h('div', { class: 'search' }, h('span', { html: ic('search') }), h('input', { type: 'text', placeholder: L('Search the library', 'ابحثي في المكتبة'), value: view.q }));
      var inp = search.querySelector('input');
      inp.addEventListener('input', function () { view.q = inp.value; paintList(); });
      var filters = h('div', { class: 'filters' });
      KINDS.forEach(function (k) {
        var c = h('button', { class: 'chip' + (view.kind === k[0] ? ' on' : ''), text: L(k[1], k[2]) });
        c.addEventListener('click', function () { view.kind = k[0]; App.render('library'); });
        filters.appendChild(c);
      });
      var list = h('div', { class: 'col', style: 'gap:.6rem;max-width:none' });
      function paintList() {
        list.innerHTML = '';
        var shown = items.filter(match);
        if (!shown.length) {
          list.appendChild(h('div', { class: 'empty' }, h('div', { class: 'art', html: '<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><g class="float"><rect x="34" y="50" width="132" height="100" rx="16"/><path d="M34 120l36-30 30 24 24-18 42 34"/><circle cx="76" cy="82" r="9"/></g></svg>' }),
            h('div', { class: 't', text: items.length ? L('Nothing matches', 'لا توجد نتائج') : L('The library is empty', 'المكتبة فارغة') }),
            items.length ? null : h('div', { text: L('Tap the logo below to upload', 'اضغطي على الشعار بالأسفل للرفع') })));
          return;
        }
        shown.forEach(function (it, i) { list.appendChild(row(it, i)); });
      }
      col.appendChild(search); col.appendChild(filters);
      if (selIds().length) col.appendChild(bulk());
      col.appendChild(list);
      paintList();
    }
  });
  window.TargetsPicker = targetsPicker;
  window.UI.emitLib = function () { App.render('library'); };
})();
