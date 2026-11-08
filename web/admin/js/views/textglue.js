/* Saves a text slide: uploads any picture layers (data: URLs) and stores the item through the backend. */
(function () {
  'use strict';
  var UI = window.UI, Api = window.Api, P = window.P;

  function dataToFile(src, name) {
    var p = src.split(','), mime = /data:([^;]+)/.exec(p[0])[1], bin = atob(p[1]), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], name + '-' + Date.now() + '.' + (mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1]), { type: mime });
  }

  function putImage(src) {
    if (P.native) return P.call('upload.dataUrl', { dataUrl: src, name: 'slide-image' });
    var file = dataToFile(src, 'slide-image');
    return window.Drive.upload(file, function () {}, {}).then(function (m) {
      return window.Drive.makePublic(m.id).then(function () { return { id: m.id, size: file.size }; });
    });
  }

  /* prev: existing item or null, res: editor result {name, dur, td}, targets: 'all' | [ids] */
  function commit(prev, res, targets) {
    var td = UI.clone(res.td), assets = [];
    var jobs = td.layers.filter(function (l) { return l.k === 'i'; }).map(function (l) {
      if (/^data:/.test(l.src)) {
        return putImage(l.src).then(function (m) { l.src = 'drive:' + m.id; assets.push({ id: m.id, size: m.size || 0 }); });
      }
      var id = l.src && l.src.indexOf('drive:') === 0 ? l.src.slice(6) : '';
      if (id) assets.push({ id: id, size: ((prev && prev.assets) || []).filter(function (a) { return a.id === id; }).map(function (a) { return a.size; })[0] || 0 });
      return Promise.resolve();
    });
    return Promise.all(jobs).then(function () {
      var item = prev ? UI.clone(prev) : { k: 'text', on: true, fit: 'contain', ts: 0, te: 0, sched: null, targets: targets || 'all' };
      item.k = 'text'; item.td = td; item.dur = res.dur; item.assets = assets; item.v = Date.now();
      var defaults = ['New text slide', 'شريحة نصية جديدة'];
      if (res.name && (prev ? res.name !== prev.name : defaults.indexOf(res.name) < 0)) item.name = res.name;
      return Api.post('admin.item.save', { item: item }).then(function (r) { item.id = r.id; item.n = r.n; item.name = r.name; return item; });
    });
  }

  window.TextGlue = { commit: commit };
})();
