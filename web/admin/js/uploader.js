/* Upload queue facade. In the Android app the native foreground service does the work and pushes
   state through the 'upload' event. In a browser (PWA) the same queue is driven here with the Drive adapter.
   Queue row: {id, name, kind, targets, size, done, status: wait|up|done|fail, err} */
(function () {
  'use strict';
  var P = window.P, UI = window.UI, Api = window.Api, L = UI.L;
  var q = [], subs = [], webBusy = false;

  function emit() { subs.forEach(function (fn) { fn(q); }); }
  function setQueue(list) {
    var finished = q.filter(function (r) { return r.status !== 'done'; }).map(function (r) { return r.id; });
    q = list || [];
    q.forEach(function (r) {
      if (r.status === 'done' && finished.indexOf(r.id) >= 0) { UI.confetti(); Api.refresh().then(function () { UI.emitLib && UI.emitLib(); }).catch(function () {}); }
    });
    emit();
  }
  function subscribe(fn) { subs.push(fn); fn(q); }
  function active() { return q.filter(function (r) { return r.status === 'up' || r.status === 'wait'; }); }
  function progress() {
    var a = active(), tot = 0, done = 0;
    a.forEach(function (r) { tot += r.size || 1; done += r.done || 0; });
    return { n: a.length, pct: tot ? Math.min(100, Math.round(done * 100 / tot)) : 0, failed: q.filter(function (r) { return r.status === 'fail'; }).length };
  }

  if (P.native) P.on('upload', function (d) { setQueue(d && d.queue); });

  /* ---------- browser fallback ---------- */
  function kindOf(file) {
    var n = file.name.toLowerCase();
    if (/^video\//.test(file.type)) return 'video';
    if (/^image\//.test(file.type)) return 'image';
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.pptx?$/.test(n)) return 'gslides';
    return 'video';
  }
  function webEnqueue(files, kind, targets) {
    [].forEach.call(files, function (f) {
      q.push({ id: UI.rid(8), name: f.name, kind: kind || kindOf(f), targets: targets, size: f.size, done: 0, status: 'wait', err: '', _f: f });
    });
    emit(); webRun();
  }
  function webRun() {
    if (webBusy) return;
    var row = q.filter(function (r) { return r.status === 'wait'; })[0];
    if (!row) return;
    webBusy = true; row.status = 'up'; emit();
    var Drive = window.Drive, file = row._f;
    Drive.upload(file, function (f) { row.done = Math.round(f * file.size); emit(); }, {}).then(function (up) {
      return Drive.makePublic(up.id).then(function () { return up; });
    }).then(function (up) {
      var base = { id: UI.rid(9), k: row.kind, targets: row.targets, on: true, fit: 'contain', v: Date.now(), ts: 0, te: 0, sched: null };
      var item = Object.assign(base, { file: { id: up.id, size: file.size, mime: file.type, src: [{ p: 'drive', id: up.id }] } });
      var next = row.kind === 'gslides' ? Drive.convertToSlides(up.id, file.name).then(function (c) { item.sid = c.sid; item.pages = c.pages; item.k = 'gslides'; }) : Promise.resolve();
      return next.then(function () { return Api.post('admin.item.save', { item: item }); });
    }).then(function (r) {
      row.status = 'done'; row.done = row.size; delete row._f;
      if (r && r.id) { item.id = r.id; item.n = r.n; item.name = r.name; Api.upsert(item); }
      UI.confetti(); emit();
    }).catch(function (e) {
      row.status = 'fail'; row.err = Api.explain(e); emit();
    }).then(function () { webBusy = false; webRun(); });
  }

  /* ---------- public ---------- */
  function pick(kind, targets) {
    if (P.native) return P.call('upload.pick', { kind: kind, targets: targets });
    return new Promise(function (res) {
      var acc = { video: 'video/*', image: 'image/*', slides: '.pdf,.ppt,.pptx,application/pdf' }[kind] || '*/*';
      var inp = UI.h('input', { type: 'file', multiple: true, accept: acc, style: 'display:none' });
      inp.addEventListener('change', function () { if (inp.files.length) webEnqueue(inp.files, kind === 'slides' ? null : kind, targets); res(); inp.remove(); });
      document.body.appendChild(inp); inp.click();
    });
  }
  function retry(id) {
    if (P.native) return P.call('upload.retry', { id: id });
    q.forEach(function (r) { if (r.id === id && r.status === 'fail') { r.status = 'wait'; r.err = ''; } });
    emit(); webRun();
  }
  function cancel(id) {
    if (P.native) return P.call('upload.cancel', { id: id });
    q = q.filter(function (r) { return r.id !== id || r.status === 'up'; }); emit();
  }
  function clearDone() {
    if (P.native) return P.call('upload.clear', {});
    q = q.filter(function (r) { return r.status !== 'done'; }); emit();
  }

  window.Up = { subscribe: subscribe, pick: pick, retry: retry, cancel: cancel, clearDone: clearDone, progress: progress, active: active, queue: function () { return q; } };
})();
