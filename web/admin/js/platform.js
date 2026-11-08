/* Bridge to the Android shell. In a normal browser (PWA) window.NativeBridge does not exist and P.native is false.
   JS -> native: P.call('method', args) returns a Promise.   native -> JS: window.__native.cb / window.__native.event */
(function () {
  'use strict';
  var bridge = window.NativeBridge || null;
  var pending = {}, seq = 0, listeners = {};

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      if (!bridge) { reject(new Error('NOT_NATIVE')); return; }
      var id = 'c' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try { bridge.call(method, JSON.stringify(args == null ? {} : args), id); }
      catch (e) { delete pending[id]; reject(e); }
    });
  }

  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
  function emit(name, data) { (listeners[name] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* keep going */ } }); }

  window.__native = {
    cb: function (id, ok, json) {
      var p = pending[id];
      if (!p) return;
      delete pending[id];
      var val = null;
      try { val = json ? JSON.parse(json) : null; } catch (e) { val = json; }
      if (ok) p.resolve(val);
      else p.reject(new Error(val && val.error ? val.error : String(val || 'NATIVE')));
    },
    event: function (name, json) {
      var data = null;
      try { data = json ? JSON.parse(json) : null; } catch (e) { data = json; }
      emit(name, data);
    }
  };

  window.P = { native: !!bridge, call: call, on: on, emit: emit };
})();
