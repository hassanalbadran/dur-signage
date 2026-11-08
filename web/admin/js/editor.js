/* Touch-first text-slide editor: layers (text / image) you drag with a finger, simple controls below.
   TextEditor.open(item|null) -> Promise<{name, dur, td}|null>. Images stay as data: URLs until app.js uploads them on save. */
(function () {
  var C = window.DR;
  var rid = function () { return Math.random().toString(36).slice(2, 9); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  function newText(txt) {
    return { id: rid(), k: 't', text: txt || '', x: 10, y: 38, w: 80, fs: 96, color: '#FFFFFF', font: 'plex', ta: 'center', b: 1, i: 0, u: 0, fx: 'fade' };
  }

  function downscale(file, max) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var sc = Math.min(1, max / Math.max(im.width, im.height)), w = Math.round(im.width * sc), h = Math.round(im.height * sc);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var png = /png|webp|gif/.test(file.type);
        res({ src: cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), ratio: h / w });
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('IMG')); };
      im.src = url;
    });
  }

  function open(item) {
    return new Promise(function (resolve) {
      var td = item && item.td ? clone(item.td) : { bg: RENDER.BACKGROUNDS[0].b, bgc: RENDER.BACKGROUNDS[0].c, layers: [newText(L('Welcome', 'أهلاً بكم'))] };
      var dur = (item && item.dur) || C.TEXT_SEC;
      var name = (item && item.name) || L('New text slide', 'شريحة نصية جديدة');
      var sel = td.layers.length ? td.layers[0].id : null;
      var stageBox = h('div', { class: 'ed-stage' });
      var panel = h('div', { class: 'ed-panel' });
      var root = h('div', { class: 'ed' });
      var W = 0, H = 0, drag = null, els = {};

      function layer() { return td.layers.filter(function (l) { return l.id === sel; })[0] || null; }

      function measure() { W = Math.min(window.innerWidth - 24, 640); H = Math.round(W * 9 / 16); stageBox.style.width = W + 'px'; stageBox.style.height = H + 'px'; }

      function mark() {
        Object.keys(els).forEach(function (id) { els[id].style.outline = id === sel ? '6px dashed #35C3BC' : 'none'; els[id].style.outlineOffset = '6px'; });
      }

      function redraw() {
        measure();
        stageBox.innerHTML = '';
        var r = RENDER.build(td, W, H, true);
        els = r.els;
        stageBox.appendChild(r.wrap);
        td.layers.forEach(function (l) {
          var e = els[l.id]; if (!e) return;
          e.style.touchAction = 'none'; e.style.cursor = 'move';
          e.addEventListener('pointerdown', function (ev) {
            ev.preventDefault();
            if (sel !== l.id) { sel = l.id; mark(); buildPanel(); }
            drag = { id: l.id, sx: ev.clientX, sy: ev.clientY, ox: l.x, oy: l.y };
            try { e.setPointerCapture(ev.pointerId); } catch (x) {}
          });
          e.addEventListener('pointermove', function (ev) {
            if (!drag || drag.id !== l.id) return;
            l.x = Math.max(-30, Math.min(100, drag.ox + (ev.clientX - drag.sx) / W * 100));
            l.y = Math.max(-30, Math.min(100, drag.oy + (ev.clientY - drag.sy) / H * 100));
            e.style.left = l.x + '%'; e.style.top = l.y + '%';
          });
          var up = function () { drag = null; };
          e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up);
        });
        mark();
      }

      function restyle(l) {
        var e = els[l.id]; if (!e) return;
        e.style.cssText = 'position:absolute;touch-action:none;cursor:move;' + RENDER.layerStyle(l);
        if (l.k === 'i') e.style.height = 'auto';
        mark();
      }

      function row(label, ctrl) { return h('div', { class: 'ed-row' }, h('label', { text: label }), ctrl); }
      function range(min, max, val, fn) { return h('input', { type: 'range', min: min, max: max, value: val, oninput: function (e) { fn(Number(e.target.value)); } }); }
      function tbtn(icon, on, fn) { var b = h('button', { class: 'ibtn tg' + (on ? ' on' : ''), html: window.ic(icon), onclick: function () { fn(b); } }); return b; }

      function buildPanel() {
        panel.innerHTML = '';
        var l = layer();

        var bar = h('div', { class: 'ed-bar' },
          h('button', { class: 'btn small', html: ic('type') + '<span>' + L('Text', 'نص') + '</span>', onclick: function () { var t = newText(L('Text', 'نص')); t.y = 20 + td.layers.length * 8; td.layers.push(t); sel = t.id; redraw(); buildPanel(); } }),
          h('button', { class: 'btn small', html: ic('image') + '<span>' + L('Image / logo', 'صورة / شعار') + '</span>', onclick: function () { fi.click(); } }),
          l ? h('button', { class: 'btn small danger', html: ic('trash-2'), onclick: function () { td.layers = td.layers.filter(function (q) { return q.id !== sel; }); sel = td.layers.length ? td.layers[td.layers.length - 1].id : null; redraw(); buildPanel(); } }) : null);
        panel.appendChild(bar);

        var sw = h('div', { class: 'swatches' });
        RENDER.BACKGROUNDS.forEach(function (b) {
          sw.appendChild(h('button', { class: 'sw' + (td.bg === b.b ? ' on' : ''), style: 'background:' + b.b, 'aria-label': 'bg', onclick: function () { td.bg = b.b; td.bgc = b.c; redraw(); buildPanel(); } }));
        });
        panel.appendChild(row(L('Background', 'الخلفية'), sw));

        if (l && l.k === 't') {
          panel.appendChild(h('textarea', { class: 'ed-text', rows: 3, dir: 'auto', value: l.text, oninput: function (e) { l.text = e.target.value; if (els[l.id]) els[l.id].textContent = l.text; } }));
          var fs = h('select', { onchange: function (e) { l.font = e.target.value; restyle(l); } },
            [['plex', 'IBM Plex Sans Arabic'], ['cairo', 'Cairo'], ['tajawal', 'Tajawal'], ['amiri', 'Amiri']].map(function (f) { return h('option', { value: f[0], text: f[1], selected: l.font === f[0] }); }));
          panel.appendChild(row(L('Font', 'الخط'), fs));
          panel.appendChild(row(L('Size', 'الحجم'), range(24, 260, l.fs, function (v) { l.fs = v; restyle(l); })));
          panel.appendChild(row(L('Width', 'العرض'), range(10, 100, l.w, function (v) { l.w = v; restyle(l); })));
          var col = h('input', { type: 'color', value: l.color, oninput: function (e) { l.color = e.target.value; restyle(l); } });
          var al = h('div', { class: 'seg' });
          [['align-left', 'left'], ['align-center', 'center'], ['align-right', 'right']].forEach(function (a) {
            al.appendChild(h('button', { class: 'ibtn tg' + (l.ta === a[1] ? ' on' : ''), html: ic(a[0]), onclick: function () { l.ta = a[1]; restyle(l); buildPanel(); } }));
          });
          panel.appendChild(row(L('Color & alignment', 'اللون والمحاذاة'), h('div', { class: 'ed-inline' }, col, al,
            tbtn('bold', l.b, function (b) { l.b = l.b ? 0 : 1; b.classList.toggle('on', !!l.b); restyle(l); }),
            tbtn('italic', l.i, function (b) { l.i = l.i ? 0 : 1; b.classList.toggle('on', !!l.i); restyle(l); }),
            tbtn('underline', l.u, function (b) { l.u = l.u ? 0 : 1; b.classList.toggle('on', !!l.u); restyle(l); }))));
          var fx = h('select', { onchange: function (e) { l.fx = e.target.value; } },
            [['none', L('None', 'بدون')], ['fade', L('Fade in', 'ظهور تدريجي')], ['up', L('Slide up', 'صعود')], ['zoom', L('Zoom in', 'تكبير')], ['glow', L('Glow', 'توهج')], ['pulse', L('Pulse', 'نبض')]]
              .map(function (f) { return h('option', { value: f[0], text: f[1], selected: l.fx === f[0] }); }));
          panel.appendChild(row(L('Effect', 'التأثير'), fx));
        } else if (l && l.k === 'i') {
          panel.appendChild(row(L('Image width', 'عرض الصورة'), range(4, 100, l.w, function (v) { l.w = v; restyle(l); })));
        } else {
          panel.appendChild(h('div', { class: 'hint', text: L('Add text or an image, then drag it with your finger.', 'أضيفي نصا أو صورة ثم حركيها بإصبعك.') }));
        }

        panel.appendChild(row(L('Seconds on screen', 'مدة العرض بالثواني'), h('input', { type: 'number', min: 3, max: 600, value: dur, onchange: function (e) { dur = Math.max(3, Number(e.target.value) || C.TEXT_SEC); } })));
        panel.appendChild(row(L('Slide name', 'اسم الشريحة'), h('input', { type: 'text', value: name, oninput: function (e) { name = e.target.value; } })));
      }

      var fi = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        downscale(f, 900).then(function (r) {
          var im = { id: rid(), k: 'i', src: r.src, x: 8, y: 8, w: 22 };
          td.layers.push(im); sel = im.id; redraw(); buildPanel();
        }).catch(function () { UI.toast(L('Could not read the image', 'تعذر قراءة الصورة'), true); });
      } });

      function close(v) { window.removeEventListener('resize', onRes); if (root.parentNode) root.parentNode.removeChild(root); resolve(v); }
      function onRes() { redraw(); }
      window.addEventListener('resize', onRes);

      var head = h('div', { class: 'ed-head' },
        h('button', { class: 'btn', text: L('Cancel', 'إلغاء'), onclick: function () { close(null); } }),
        h('div', { class: 'ed-title', text: L('Text slide', 'شريحة نصية') }),
        h('button', { class: 'btn pri', text: L('Save', 'حفظ'), onclick: function () {
          if (!td.layers.length) return UI.toast(L('Add something to the slide first', 'أضيفي شيئا للشريحة أولا'), true);
          close({ name: name || L('Text slide', 'شريحة نصية'), dur: dur, td: td });
        } }));
      root.appendChild(head);
      root.appendChild(h('div', { class: 'ed-body' }, stageBox, panel, fi));
      document.getElementById('app').appendChild(root);
      redraw(); buildPanel();
    });
  }

  window.TextEditor = { open: open };
})();
