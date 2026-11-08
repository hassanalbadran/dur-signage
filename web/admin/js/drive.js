/* Google sign-in (Google Identity Services token flow) + Google Drive API (drive.file scope: the app only sees files it created).
   Resumable chunked upload with resume-after-failure. A provider adapter is exposed as window.Drive; other providers
   (Dropbox, OneDrive, ...) can later implement the same functions: init, token, signIn, signOut, ensureFolder, upload, makePublic, remove, fileUrl, thumbUrl. */
(function () {
  var C = window.DR;
  var SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  var API = 'https://www.googleapis.com/drive/v3';
  var tok = null, exp = 0, client = null, pend = null;

  function loadGis() {
    return new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('NET')); };
      document.head.appendChild(s);
    });
  }
  function settle(ok, v) { if (!pend) return; var p = pend; pend = null; if (ok) p.res(v); else p.rej(v); }
  function init() {
    return loadGis().then(function () {
      client = google.accounts.oauth2.initTokenClient({
        client_id: C.GOOGLE_CLIENT_ID, scope: SCOPE,
        callback: function (r) {
          if (r.error) return settle(false, new Error(r.error));
          tok = r.access_token; exp = Date.now() + (Number(r.expires_in || 3600) - 90) * 1000;
          try { localStorage.setItem('dra_signed', '1'); } catch (e) {}
          settle(true, tok);
        },
        error_callback: function (e) { settle(false, new Error((e && e.type) || 'popup')); }
      });
    });
  }
  function request(prompt) {
    return new Promise(function (res, rej) { pend = { res: res, rej: rej }; client.requestAccessToken({ prompt: prompt }); });
  }
  function token() {
    if (tok && Date.now() < exp) return Promise.resolve(tok);
    return request('none').catch(function () { throw new Error('AUTH'); });
  }
  function signIn() { return request(''); }
  function signOut() {
    try { if (tok && google.accounts.oauth2.revoke) google.accounts.oauth2.revoke(tok, function () {}); } catch (e) {}
    tok = null; exp = 0;
    try { localStorage.removeItem('dra_signed'); localStorage.removeItem('dra_folder'); } catch (e) {}
  }

  function gfetch(url, opt) {
    return token().then(function (t) {
      opt = opt || {};
      opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {});
      return fetch(url, opt);
    });
  }
  function toErr(r, j) {
    var e = new Error((j && j.error && (j.error.message || j.error)) || ('HTTP ' + r.status));
    e.status = r.status;
    e.reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
    return e;
  }
  function gjson(url, opt) {
    return gfetch(url, opt).then(function (r) {
      return r.text().then(function (tx) {
        var j = {}; try { j = tx ? JSON.parse(tx) : {}; } catch (e) {}
        if (!r.ok) throw toErr(r, j);
        return j;
      });
    });
  }

  function ensureFolder() {
    var cached = null; try { cached = localStorage.getItem('dra_folder'); } catch (e) {}
    var chk = cached
      ? gjson(API + '/files/' + cached + '?fields=id,trashed').then(function (f) { return f.trashed ? null : f.id; }).catch(function () { return null; })
      : Promise.resolve(null);
    return chk.then(function (id) {
      if (id) return id;
      var q = encodeURIComponent("name='" + C.DRIVE_FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
      return gjson(API + '/files?q=' + q + '&fields=files(id)&pageSize=1').then(function (r) {
        if (r.files && r.files[0]) return r.files[0].id;
        return gjson(API + '/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: C.DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) }).then(function (f) { return f.id; });
      });
    }).then(function (id) { try { localStorage.setItem('dra_folder', id); } catch (e) {} return id; });
  }

  function makePublic(id) {
    return gjson(API + '/files/' + id + '/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
  }
  function remove(id) { return gfetch(API + '/files/' + id, { method: 'DELETE' }).catch(function () {}); }
  function fileUrl(id) { return API + '/files/' + id + '?alt=media&key=' + C.DRIVE_API_KEY; }
  function thumbUrl(id) { return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w240'; }
  function userEmail() { return gfetch('https://www.googleapis.com/oauth2/v3/userinfo').then(function (r) { return r.json(); }).then(function (j) { return j.email || ''; }).catch(function () { return ''; }); }

  var MIMES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint' };
  function guessMime(n) { var e = (n.split('.').pop() || '').toLowerCase(); return MIMES[e] || 'application/octet-stream'; }

  /* ---------- resumable upload ---------- */
  function putChunk(uri, blob, start, end, total, onp) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open('PUT', uri);
      x.setRequestHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
      x.upload.onprogress = function (e) { if (e.lengthComputable) onp(e.loaded); };
      x.onload = function () { res({ status: x.status, text: x.responseText, range: x.getResponseHeader('Range') }); };
      x.onerror = function () { rej(new Error('NET')); };
      x.ontimeout = x.onerror; x.timeout = 180000;
      x.send(blob);
    });
  }
  function queryOffset(uri, total) {
    return new Promise(function (res) {
      var x = new XMLHttpRequest();
      x.open('PUT', uri);
      x.setRequestHeader('Content-Range', 'bytes */' + total);
      x.onload = function () {
        if (x.status === 308) { var r = x.getResponseHeader('Range'); var m = r && /bytes=0-(\d+)/.exec(r); res(m ? Number(m[1]) + 1 : 0); }
        else res(-1);
      };
      x.onerror = function () { res(-2); };
      x.send();
    });
  }

  function upload(file, onprog, ctl) {
    if (!file.size) return Promise.reject(new Error('EMPTY'));
    var mime = file.type || guessMime(file.name);
    var key = 'dra_up_' + file.size + '_' + file.lastModified + '_' + file.name;
    var CH = 8 * 1024 * 1024;

    function start(folder) {
      return gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(file.size) },
        body: JSON.stringify({ name: file.name, mimeType: mime, parents: [folder] })
      }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw toErr(r, j); });
        var u = r.headers.get('Location');
        if (!u) throw new Error('NO_SESSION');
        return u;
      });
    }
    function sendAll(uri, off) {
      return new Promise(function (res, rej) {
        var tries = 0;
        function next() {
          if (ctl && ctl.cancelled) return rej(new Error('CANCELLED'));
          var end = Math.min(off + CH, file.size), base = off;
          putChunk(uri, file.slice(off, end), off, end - 1, file.size, function (l) { onprog((base + l) / file.size); })
            .then(function (r) {
              tries = 0;
              if (r.status === 200 || r.status === 201) { try { localStorage.removeItem(key); } catch (e) {} return res(JSON.parse(r.text)); }
              if (r.status === 308) { off = end; return next(); }
              var e = new Error('HTTP ' + r.status); e.status = r.status; throw e;
            })
            .catch(function (e) {
              if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) {
                if (e.status === 404 || e.status === 410) { try { localStorage.removeItem(key); } catch (x) {} }
                return rej(e);
              }
              if (++tries > 6) return rej(e);
              setTimeout(function () { queryOffset(uri, file.size).then(function (o) { if (o >= 0) off = o; next(); }); }, Math.min(30000, 1500 * tries * tries));
            });
        }
        next();
      });
    }

    return ensureFolder().then(function (folder) {
      var uri = null; try { uri = localStorage.getItem(key); } catch (e) {}
      var p = uri ? queryOffset(uri, file.size) : Promise.resolve(-1);
      return p.then(function (off) {
        if (uri && off >= 0) return { uri: uri, off: off };
        try { localStorage.removeItem(key); } catch (e) {}
        return start(folder).then(function (u) { try { localStorage.setItem(key, u); } catch (e) {} return { uri: u, off: 0 }; });
      });
    }).then(function (s) { return sendAll(s.uri, s.off); });
  }

  /* ---------- slides ---------- */
  function countPdfPages(file) {
    return file.arrayBuffer().then(function (buf) {
      var t = new TextDecoder('latin1').decode(buf);
      var a = (t.match(/\/Type\s*\/Page[^s]/g) || []).length, b = 0, m, re = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g;
      while ((m = re.exec(t))) b = Math.max(b, Number(m[1]));
      return Math.max(a, b, 1);
    }).catch(function () { return 0; });
  }
  function convertToSlides(fileId, name) {
    return ensureFolder().then(function (folder) {
      return gjson(API + '/files/' + fileId + '/copy?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: 'application/vnd.google-apps.presentation', name: name.replace(/\.[^.]+$/, ''), parents: [folder] }) });
    }).then(function (c) {
      return makePublic(c.id).then(function () {
        return gfetch(API + '/files/' + c.id + '/export?mimeType=application/pdf').then(function (r) { return r.ok ? r.blob() : null; }).catch(function () { return null; });
      }).then(function (blob) {
        return (blob ? countPdfPages(blob) : Promise.resolve(0)).then(function (n) { return { sid: c.id, pages: n }; });
      });
    });
  }

  window.Drive = {
    init: init, token: token, signIn: signIn, signOut: signOut, gjson: gjson, gfetch: gfetch, ensureFolder: ensureFolder,
    makePublic: makePublic, remove: remove, fileUrl: fileUrl, thumbUrl: thumbUrl, upload: upload, userEmail: userEmail,
    countPdfPages: countPdfPages, convertToSlides: convertToSlides, name: 'Google Drive'
  };
})();
