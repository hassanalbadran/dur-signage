/* Shared renderer for text slides (used by the admin editor preview and by the screen player).
   A text slide = 1920x1080 stage, background, and layers (text / image) positioned in percent. */
(function () {
  var FONTS = {
    plex: "'IBM Plex Sans Arabic','IBM Plex Sans',system-ui,sans-serif",
    cairo: "'Cairo','IBM Plex Sans',system-ui,sans-serif",
    tajawal: "'Tajawal','IBM Plex Sans',system-ui,sans-serif",
    amiri: "'Amiri','IBM Plex Sans',serif"
  };
  var BACKGROUNDS = [
    { c: '#0B6E70', b: 'linear-gradient(135deg,#0F8B8D,#0B4F6C)' },
    { c: '#0B4F6C', b: 'linear-gradient(135deg,#0B4F6C,#16324F)' },
    { c: '#F4F8FA', b: '#F4F8FA' },
    { c: '#12191D', b: '#12191D' },
    { c: '#2F7D6B', b: 'linear-gradient(135deg,#2F7D6B,#1B4D5C)' },
    { c: '#FFFFFF', b: '#FFFFFF' }
  ];
  var resolve = function (src) { return src; };   // each app sets its own resolver for "drive:<id>" images

  function layerStyle(l) {
    if (l.k === 'i') return 'left:' + l.x + '%;top:' + l.y + '%;width:' + l.w + '%;';
    return 'left:' + l.x + '%;top:' + l.y + '%;width:' + l.w + '%;font-size:' + l.fs + 'px;color:' + l.color +
      ';text-align:' + l.ta + ';font-weight:' + (l.b ? 700 : 400) + ';font-style:' + (l.i ? 'italic' : 'normal') +
      ';text-decoration:' + (l.u ? 'underline' : 'none') + ';font-family:' + (FONTS[l.font] || FONTS.plex) +
      ';line-height:1.3;white-space:pre-wrap;word-break:break-word;';
  }

  function build(td, w, h, interactive) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;overflow:hidden;width:' + w + 'px;height:' + h + 'px;background:' + (td.bgc || '#0B6E70');
    var sc = Math.min(w / 1920, h / 1080);
    var st = document.createElement('div');
    st.style.cssText = 'position:absolute;width:1920px;height:1080px;transform-origin:0 0;left:' + ((w - 1920 * sc) / 2) + 'px;top:' + ((h - 1080 * sc) / 2) + 'px;transform:scale(' + sc + ');background:' + (td.bg || td.bgc || '#0B6E70');
    wrap.appendChild(st);
    var els = {};
    (td.layers || []).forEach(function (l) {
      var e;
      if (l.k === 'i') { e = document.createElement('img'); e.src = resolve(l.src); e.draggable = false; e.style.height = 'auto'; }
      else { e = document.createElement('div'); e.setAttribute('dir', 'auto'); e.textContent = l.text || ''; if (!interactive && l.fx && l.fx !== 'none') e.className = 'fx-' + l.fx; }
      e.style.cssText += 'position:absolute;' + layerStyle(l);
      st.appendChild(e); els[l.id] = e;
    });
    return { wrap: wrap, stage: st, els: els, scale: sc };
  }

  window.RENDER = {
    FONTS: FONTS, BACKGROUNDS: BACKGROUNDS, layerStyle: layerStyle, build: build,
    setResolver: function (f) { resolve = f; },
    resolve: function (s) { return resolve(s); }
  };
})();
