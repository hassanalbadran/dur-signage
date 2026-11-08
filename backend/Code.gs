/**
 * Dur Al-Razi Signage - backend (Google Apps Script)
 *
 * Deploy: Deploy > New deployment > Web app
 *         Execute as: Me | Who has access: Anyone
 *
 * What it does
 *  - Pairs screens with a 9-digit code (link valid for 30 days)
 *  - Keeps the device registry, the content list and the playback commands
 *  - Receives a small status report from every screen (offline readiness, version, now playing)
 *  - Tells each screen which real-time topic to listen to (instant remote control)
 *  - Publishes the screen-app update announced by the admin app
 *
 * The two lines below are the ONLY private values. They live inside your Apps Script
 * project, never in GitHub. Replace the placeholders there.
 */

// ====== EDIT THESE TWO LINES (in the Apps Script editor only) ======
var ADMINS = ['PUT_ADMIN_EMAIL_HERE'];                 // accounts allowed to manage the system
var CLIENT_IDS = ['PUT_ANDROID_CLIENT_ID', 'PUT_WEB_CLIENT_ID']; // OAuth clients (Android app + website)
// ===================================================================

var LINK_MS = 30 * 24 * 3600 * 1000;   // how long a screen stays linked
var CODE_MS = 10 * 60 * 1000;          // how long a pairing code stays valid
var KIND_WORD = { video: 'Video', image: 'Image', gslides: 'Slides', pdf: 'PDF', text: 'Text' };
var PROPS = PropertiesService.getScriptProperties();


/* ------------------------------------------------------------------ */
/* Storage helpers: JSON chunked inside Script Properties              */
/* ------------------------------------------------------------------ */

function escapeUnicode_(text) {
  return text.replace(/[\u0080-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function kvGet(key, fallback) {
  var chunks = PROPS.getProperty(key + '#n');
  if (!chunks) return fallback;

  var text = '';
  for (var i = 0; i < Number(chunks); i++) {
    text += PROPS.getProperty(key + '#' + i) || '';
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function kvSet(key, value) {
  var text = escapeUnicode_(JSON.stringify(value === undefined ? null : value) || 'null');
  var count = Math.max(1, Math.ceil(text.length / 8000));
  var previous = Number(PROPS.getProperty(key + '#n') || 0);
  var batch = {};

  batch[key + '#n'] = String(count);
  for (var i = 0; i < count; i++) {
    batch[key + '#' + i] = text.substr(i * 8000, 8000);
  }
  PROPS.setProperties(batch);

  for (var j = count; j < previous; j++) {
    PROPS.deleteProperty(key + '#' + j);
  }
}

function cachePut_(key, value, seconds) {
  CacheService.getScriptCache().put(key, JSON.stringify(value), seconds || 21600);
}

function cacheGet_(key) {
  var raw = CacheService.getScriptCache().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function devices_() { return kvGet('dev', {}); }
function items_() { return kvGet('items', []); }
function config_() { return kvGet('cfg', { screenLang: 'en', folderId: '', screenUpdate: null }); }


/* ------------------------------------------------------------------ */
/* HTTP entry points                                                   */
/* ------------------------------------------------------------------ */

function output_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return output_({ ok: true, service: 'dur-alrazi-signage', version: 2 });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return output_({ error: 'bad_json' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var action = String(data.a || '');
    if (action.indexOf('screen.') === 0) return output_(screenApi_(action, data));
    if (action.indexOf('admin.') === 0) return output_(adminApi_(action, data));
    return output_({ error: 'unknown_action' });
  } catch (err) {
    return output_({ error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}


/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function randomId_(length) {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var out = '';
  for (var i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function newPairingCode_(devices) {
  var now = Date.now();
  for (var attempt = 0; attempt < 50; attempt++) {
    var code = String(Math.floor(1e8 + Math.random() * 9e8));
    var clash = false;
    for (var id in devices) {
      if (devices[id].code === code && devices[id].codeExp > now) clash = true;
    }
    if (!clash) return code;
  }
  return String(Math.floor(1e8 + Math.random() * 9e8));
}

function realClientIds_() {
  return CLIENT_IDS.filter(function (id) { return id.indexOf('PUT_') !== 0; });
}

/** Verifies the Google access token sent by the admin app and checks the allow-list. */
function authenticate_(token) {
  if (!token) throw new Error('auth_required');

  var cache = CacheService.getScriptCache();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  var key = 'tk' + Utilities.base64EncodeWebSafe(digest).slice(0, 40);
  var email = cache.get(key);

  if (!email) {
    var response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) throw new Error('auth_invalid');

    var info = JSON.parse(response.getContentText());
    var ids = realClientIds_();
    if (ids.length && ids.indexOf(info.aud) < 0 && ids.indexOf(info.azp) < 0) {
      throw new Error('auth_wrong_client');
    }
    email = String(info.email || '').toLowerCase();
    cache.put(key, email, 600);
  }

  var allowed = ADMINS.some(function (admin) { return admin.toLowerCase() === email; });
  if (!allowed) throw new Error('not_allowed');
  return email;
}

function sortedItems_(items) {
  return items.slice().sort(function (a, b) {
    return (a.n || 1e9) - (b.n || 1e9);
  });
}

function nextSequence_(items) {
  var max = 0;
  items.forEach(function (item) { max = Math.max(max, item.n || 0); });
  return max + 1;
}


/* ------------------------------------------------------------------ */
/* Screen API (no Google login: every screen has its own secret)       */
/* ------------------------------------------------------------------ */

function screenApi_(action, data) {
  var devices = devices_();
  var now = Date.now();
  var device;

  if (action === 'screen.register') {
    device = data.id && devices[data.id];
    if (!device || device.secret !== data.secret) {
      var id = randomId_(10);
      device = devices[id] = {
        id: id, secret: randomId_(32), rt: 'drs' + randomId_(24),
        linked: false, name: '', created: now, cmd: null
      };
    }
    if (!device.rt) device.rt = 'drs' + randomId_(24);
    if (!device.linked) {
      device.code = newPairingCode_(devices);
      device.codeExp = now + CODE_MS;
    }
    kvSet('dev', devices);
    return {
      status: device.linked ? 'linked' : 'pending',
      id: device.id, secret: device.secret,
      code: device.code, codeExp: device.codeExp
    };
  }

  device = devices[data.id];
  if (!device || device.secret !== data.secret) return { status: 'unknown' };

  if (action === 'screen.newcode') {
    if (device.linked) return { status: 'linked' };
    device.code = newPairingCode_(devices);
    device.codeExp = now + CODE_MS;
    kvSet('dev', devices);
    return { status: 'pending', code: device.code, codeExp: device.codeExp };
  }

  if (action === 'screen.unlink') {
    delete devices[device.id];
    kvSet('dev', devices);
    return { status: 'unknown' };
  }

  if (action === 'screen.poll') return pollScreen_(device, devices, data, now);
  return { error: 'unknown_action' };
}

function pollScreen_(device, devices, data, now) {
  var cache = CacheService.getScriptCache();

  // Status report from the screen: kept in the cache (cheap), shown in the admin app.
  if (data.rep) {
    data.rep.t = now;
    cachePut_('rep:' + device.id, data.rep, 21600);
  }
  cache.put('seen:' + device.id, String(now), 21600);

  if (!device.linked) {
    if (!device.code || device.codeExp < now) {
      device.code = newPairingCode_(devices);
      device.codeExp = now + CODE_MS;
      kvSet('dev', devices);
    }
    return { status: 'pending', code: device.code, codeExp: device.codeExp };
  }

  if (device.linkExp < now) {
    delete devices[device.id];
    kvSet('dev', devices);
    return { status: 'expired' };
  }

  var config = config_();
  var visible = items_().filter(function (item) {
    return item.on !== false &&
      (item.targets === 'all' || (item.targets || []).indexOf(device.id) >= 0);
  });

  return {
    status: 'linked',
    linkExp: device.linkExp,
    serverTime: now,
    rt: device.rt,
    rc: cacheGet_('rc:' + device.id),
    manifest: {
      items: sortedItems_(visible),
      cmd: device.cmd,
      name: device.name,
      cfg: { lang: config.screenLang, update: config.screenUpdate }
    }
  };
}


/* ------------------------------------------------------------------ */
/* Admin API (Google access token + allow-list)                        */
/* ------------------------------------------------------------------ */

function adminApi_(action, data) {
  var email = authenticate_(data.tok);
  var devices = devices_();
  var now = Date.now();

  if (action === 'admin.state') {
    var list = [];
    for (var id in devices) {
      var device = devices[id];
      if (!device.linked) continue;
      list.push({
        id: device.id, name: device.name, linkExp: device.linkExp, cmd: device.cmd,
        rt: device.rt,
        lastSeen: Number(CacheService.getScriptCache().get('seen:' + device.id) || 0),
        rep: cacheGet_('rep:' + device.id)
      });
    }
    return {
      email: email, now: now, devices: list,
      items: sortedItems_(items_()), cfg: config_()
    };
  }

  if (action === 'admin.pair') {
    var code = String(data.code || '').replace(/\D/g, '');
    for (var key in devices) {
      var candidate = devices[key];
      if (!candidate.linked && candidate.code === code && candidate.codeExp > now) {
        candidate.linked = true;
        candidate.linkExp = now + LINK_MS;
        candidate.name = data.name || ('Screen ' + (Object.keys(devices).length));
        candidate.code = null;
        candidate.cmd = null;
        kvSet('dev', devices);
        return { ok: true, id: candidate.id, rt: candidate.rt };
      }
    }
    throw new Error('code_invalid');
  }

  if (action === 'admin.device.update') {
    var target = devices[data.id];
    if (!target) throw new Error('device_missing');

    if (typeof data.name === 'string') target.name = data.name.slice(0, 60);
    if (data.cmd) {
      target.cmd = {
        rev: ((target.cmd && target.cmd.rev) || 0) + 1,
        action: data.cmd.action || 'play',
        mode: data.cmd.mode || 'all',
        ids: data.cmd.ids || [],
        loop: data.cmd.loop !== false
      };
    }
    if (data.renew) target.linkExp = now + LINK_MS;
    kvSet('dev', devices);
    return { ok: true };
  }

  if (action === 'admin.device.unlink') {
    delete devices[data.id];
    kvSet('dev', devices);
    return { ok: true };
  }

  // Remote-control fallback: the instant path is the real-time topic; this copy is read on the next poll.
  if (action === 'admin.rc') {
    cachePut_('rc:' + data.id, { id: randomId_(8), op: data.op, arg: data.arg || 0, t: now }, 120);
    return { ok: true };
  }

  if (action === 'admin.item.save') return saveItem_(data.item);

  if (action === 'admin.item.delete') {
    var doomed = data.ids || [data.id];
    kvSet('items', items_().filter(function (item) { return doomed.indexOf(item.id) < 0; }));
    return { ok: true };
  }

  if (action === 'admin.items.targets') {
    var all = items_();
    var byId = {};
    all.forEach(function (item) { byId[item.id] = item; });
    (data.changes || []).forEach(function (change) {
      if (byId[change.id]) byId[change.id].targets = change.targets;
    });
    kvSet('items', all);
    return { ok: true };
  }

  if (action === 'admin.items.patch') {
    var current = items_();
    current.forEach(function (item) {
      if ((data.ids || []).indexOf(item.id) < 0) return;
      ['on', 'fit', 'targets'].forEach(function (field) {
        if (data.patch && data.patch[field] !== undefined) item[field] = data.patch[field];
      });
      item.v = now;
    });
    kvSet('items', current);
    return { ok: true };
  }

  if (action === 'admin.items.seq') {            // data.changes = [{id, n}] (used to reorder)
    var stored = items_();
    (data.changes || []).forEach(function (change) {
      stored.forEach(function (item) { if (item.id === change.id) item.n = change.n; });
    });
    kvSet('items', stored);
    return { ok: true };
  }

  if (action === 'admin.cfg.set') {
    var config = config_();
    if (data.screenLang) config.screenLang = data.screenLang === 'ar' ? 'ar' : 'en';
    if (typeof data.folderId === 'string') config.folderId = data.folderId;

    // Only ever move forward: the screen update is announced once per release.
    var update = data.screenUpdate;
    if (update && (!config.screenUpdate || update.v > config.screenUpdate.v)) {
      config.screenUpdate = update;
    }
    kvSet('cfg', config);
    return { ok: true, screenUpdate: config.screenUpdate };
  }

  return { error: 'unknown_action' };
}

function saveItem_(item) {
  if (!item || !item.k) throw new Error('bad_item');

  var items = items_();
  var index = -1;
  if (!item.id) item.id = randomId_(10);
  items.forEach(function (existing, i) { if (existing.id === item.id) index = i; });

  if (!item.n) item.n = nextSequence_(items);
  if (!item.name) item.name = (KIND_WORD[item.k] || 'Item') + ' ' + item.n;

  if (index >= 0) items[index] = item; else items.push(item);
  kvSet('items', items);
  return { ok: true, id: item.id, n: item.n, name: item.name };
}
