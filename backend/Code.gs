/**
 * Dur Al-Razi Signage — backend (Google Apps Script)
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone
 *
 * Responsibilities: pairing screens by 9-digit code (30-day link), device registry,
 * content manifest, playback commands, admin authentication (Google access token).
 * Files themselves live in the admin's Google Drive (uploaded from the admin app).
 */

// ====== EDIT THESE TWO LINES ======
var ADMINS = ['PUT_ADMIN_GMAIL_HERE@gmail.com'];            // emails allowed to manage the system
var CLIENT_ID = 'PUT_OAUTH_CLIENT_ID.apps.googleusercontent.com'; // same value as GOOGLE_CLIENT_ID in config.js
// ==================================

var LINK_MS = 30 * 24 * 3600 * 1000;   // link validity
var CODE_MS = 10 * 60 * 1000;          // pairing code validity
var P = PropertiesService.getScriptProperties();

/* ---------- storage helpers (chunked JSON in Script Properties) ---------- */
function esc_(s) { return s.replace(/[\u0080-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); }
function kvGet(k, def) {
  var n = P.getProperty(k + '#n'); if (!n) return def;
  var s = ''; for (var i = 0; i < +n; i++) s += P.getProperty(k + '#' + i) || '';
  try { return JSON.parse(s); } catch (e) { return def; }
}
function kvSet(k, v) {
  var s = esc_(JSON.stringify(v)), n = Math.max(1, Math.ceil(s.length / 8000));
  var old = +(P.getProperty(k + '#n') || 0), o = {};
  o[k + '#n'] = String(n);
  for (var i = 0; i < n; i++) o[k + '#' + i] = s.substr(i * 8000, 8000);
  P.setProperties(o);
  for (var j = n; j < old; j++) P.deleteProperty(k + '#' + j);
}
function devs_() { return kvGet('dev', {}); }
function items_() { return kvGet('items', []); }
function cfg_() { return kvGet('cfg', { screenLang: 'en', folderId: '' }); }

/* ---------- http ---------- */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out_({ ok: true, service: 'dur-alrazi-signage' }); }

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'bad_json' }); }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var a = String(d.a || '');
    if (a.indexOf('screen.') === 0) return out_(screen_(a, d));
    if (a.indexOf('admin.') === 0) return out_(admin_(a, d));
    return out_({ error: 'unknown_action' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------- helpers ---------- */
function rid_(n) { var c = 'abcdefghijklmnopqrstuvwxyz0123456789', s = ''; for (var i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
function newCode_(devs) {
  var now = Date.now();
  for (var t = 0; t < 50; t++) {
    var c = String(Math.floor(1e8 + Math.random() * 9e8)), clash = false;
    for (var id in devs) if (devs[id].code === c && devs[id].codeExp > now) clash = true;
    if (!clash) return c;
  }
  return String(Math.floor(1e8 + Math.random() * 9e8));
}
function auth_(tok) {
  if (!tok) throw new Error('auth_required');
  var cache = CacheService.getScriptCache();
  var key = 'tk' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tok)).slice(0, 40);
  var em = cache.get(key);
  if (!em) {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(tok), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('auth_invalid');
    var j = JSON.parse(r.getContentText());
    if (CLIENT_ID.indexOf('PUT_') !== 0 && j.aud !== CLIENT_ID && j.azp !== CLIENT_ID) throw new Error('auth_wrong_client');
    em = String(j.email || '').toLowerCase();
    cache.put(key, em, 600);
  }
  var ok = ADMINS.some(function (x) { return x.toLowerCase() === em; });
  if (!ok) throw new Error('not_allowed');
  return em;
}
function seen_(id) { var v = CacheService.getScriptCache().get('seen:' + id); return v ? +v : 0; }

/* ---------- screen API (no Google login; secret per device) ---------- */
function screen_(a, d) {
  var devs = devs_(), now = Date.now(), dev;

  if (a === 'screen.register') {
    dev = d.id && devs[d.id];
    if (!dev || dev.secret !== d.secret) {
      var id = rid_(10);
      dev = devs[id] = { id: id, secret: rid_(32), linked: false, name: '', created: now, rev: 0, cmd: null };
    }
    if (!dev.linked) { dev.code = newCode_(devs); dev.codeExp = now + CODE_MS; }
    kvSet('dev', devs);
    return { status: dev.linked ? 'linked' : 'pending', id: dev.id, secret: dev.secret, code: dev.code, codeExp: dev.codeExp };
  }

  dev = devs[d.id];
  if (!dev || dev.secret !== d.secret) return { status: 'unknown' };

  if (a === 'screen.newcode') {
    if (dev.linked) return { status: 'linked' };
    dev.code = newCode_(devs); dev.codeExp = now + CODE_MS; kvSet('dev', devs);
    return { status: 'pending', code: dev.code, codeExp: dev.codeExp };
  }

  if (a === 'screen.unlink') { delete devs[dev.id]; kvSet('dev', devs); return { status: 'unknown' }; }

  if (a === 'screen.poll') {
    var cache = CacheService.getScriptCache();
    if (!cache.get('seen:' + dev.id)) { dev.lastSeen = now; kvSet('dev', devs); }
    cache.put('seen:' + dev.id, String(now), 21600);
    if (!dev.linked) {
      if (!dev.code || dev.codeExp < now) { dev.code = newCode_(devs); dev.codeExp = now + CODE_MS; kvSet('dev', devs); }
      return { status: 'pending', code: dev.code, codeExp: dev.codeExp };
    }
    if (dev.linkExp < now) { delete devs[dev.id]; kvSet('dev', devs); return { status: 'expired' }; }
    var cfg = cfg_();
    var list = items_().filter(function (it) {
      return it.on !== false && (it.targets === 'all' || (it.targets || []).indexOf(dev.id) >= 0);
    });
    return {
      status: 'linked', linkExp: dev.linkExp, serverTime: now,
      manifest: { items: list, cmd: dev.cmd, cfg: { lang: cfg.screenLang }, name: dev.name }
    };
  }
  return { error: 'unknown_action' };
}

/* ---------- admin API (Google access token + allow-list) ---------- */
function admin_(a, d) {
  var email = auth_(d.tok);
  var devs = devs_(), now = Date.now();

  if (a === 'admin.state') {
    var list = [];
    for (var id in devs) {
      var v = devs[id]; if (!v.linked) continue;
      list.push({ id: v.id, name: v.name, linkExp: v.linkExp, lastSeen: seen_(v.id) || v.lastSeen || 0, cmd: v.cmd });
    }
    return { email: email, devices: list, items: items_(), cfg: cfg_(), now: now };
  }

  if (a === 'admin.pair') {
    var code = String(d.code || '').replace(/\D/g, '');
    for (var k in devs) {
      var x = devs[k];
      if (!x.linked && x.code === code && x.codeExp > now) {
        x.linked = true; x.linkExp = now + LINK_MS; x.name = d.name || ('Screen ' + (Object.keys(devs).length));
        x.code = null; x.cmd = null;
        kvSet('dev', devs);
        return { ok: true, id: x.id };
      }
    }
    throw new Error('code_invalid');
  }

  if (a === 'admin.device.update') {
    var dv = devs[d.id]; if (!dv) throw new Error('device_missing');
    if (typeof d.name === 'string') dv.name = d.name.slice(0, 60);
    if (d.cmd) { dv.cmd = { rev: ((dv.cmd && dv.cmd.rev) || 0) + 1, action: d.cmd.action || 'play', mode: d.cmd.mode || 'all', ids: d.cmd.ids || [], loop: d.cmd.loop !== false }; }
    if (d.renew) dv.linkExp = now + LINK_MS;
    kvSet('dev', devs);
    return { ok: true };
  }

  if (a === 'admin.device.unlink') { delete devs[d.id]; kvSet('dev', devs); return { ok: true }; }

  if (a === 'admin.item.save') {
    var it = d.item; if (!it || !it.k) throw new Error('bad_item');
    var items = items_(), i = -1;
    if (!it.id) it.id = rid_(10);
    items.forEach(function (q, n) { if (q.id === it.id) i = n; });
    if (i >= 0) items[i] = it; else items.push(it);
    kvSet('items', items);
    return { ok: true, id: it.id };
  }

  if (a === 'admin.item.delete') {
    kvSet('items', items_().filter(function (q) { return q.id !== d.id; }));
    return { ok: true };
  }

  if (a === 'admin.item.order') {                       // d.ids = full ordered list of ids
    var cur = items_(), map = {}; cur.forEach(function (q) { map[q.id] = q; });
    var nx = []; (d.ids || []).forEach(function (id2) { if (map[id2]) { nx.push(map[id2]); delete map[id2]; } });
    for (var r in map) nx.push(map[r]);
    kvSet('items', nx);
    return { ok: true };
  }

  if (a === 'admin.items.targets') {                    // d.changes = [{id, targets}]
    var all = items_(), by = {}; all.forEach(function (q) { by[q.id] = q; });
    (d.changes || []).forEach(function (c) { if (by[c.id]) by[c.id].targets = c.targets; });
    kvSet('items', all);
    return { ok: true };
  }

  if (a === 'admin.cfg.set') {
    var cf = cfg_();
    if (d.screenLang) cf.screenLang = d.screenLang === 'ar' ? 'ar' : 'en';
    if (typeof d.folderId === 'string') cf.folderId = d.folderId;
    kvSet('cfg', cf);
    return { ok: true };
  }
  return { error: 'unknown_action' };
}
