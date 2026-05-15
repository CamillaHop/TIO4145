// Floating study-assistant chat widget. Streams from /api/chat (NDJSON),
// renders markdown via marked + DOMPurify, math via KaTeX. Course-agnostic:
// reads the course name from a <meta name="course-name"> tag injected by
// main.js when features.chat.enabled is true.
(function () {
  'use strict';
  if (window.__STUDY_CHAT_WIDGET__) return;
  window.__STUDY_CHAT_WIDGET__ = true;

  // ─── CDN assets (with SRI) ──────────────────────────────────────────────
  var MARKED_SRC          = 'https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.umd.min.js';
  var MARKED_INTEGRITY    = 'sha384-EjL6IeH3KCXB9dkBQaYqnb/m6V3TOBP++kooL0bl43Vt6eCFJ2Pxck/B/dU4PB8d';
  var DOMPURIFY_SRC       = 'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js';
  var DOMPURIFY_INTEGRITY = 'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu';
  var KATEX_VERSION       = '0.16.21';
  var KATEX_CSS_HREF      = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.css';
  var KATEX_CSS_INTEGRITY = 'sha384-zh0CIslj+VczCZtlzBcjt5ppRcsAmDnRem7ESsYwWwg3m/OaJ2l4x7YBZl9Kxxib';
  var KATEX_JS_SRC        = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.js';
  var KATEX_JS_INTEGRITY  = 'sha384-Rma6DA2IPUwhNxmrB/7S3Tno0YY7sFu9WSYMCuulLhIqYSGZ2gKCJWIqhBWqMQfh';
  var KATEX_AR_SRC        = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/contrib/auto-render.min.js';
  var KATEX_AR_INTEGRITY  = 'sha384-hCXGrW6PitJEwbkoStFjeJxv+fSOOQKOPbJxSfM6G5sWZjAyWhXiTIIAmQqnlLlh';

  var KATEX_DELIMITERS = [
    { left: '$$',  right: '$$',  display: true  },
    { left: '$',   right: '$',   display: false },
    { left: '\\(', right: '\\)', display: false },
    { left: '\\[', right: '\\]', display: true  },
  ];

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      if ([].slice.call(document.scripts).some(function (s) { return s.src === src; })) {
        resolve(); return;
      }
      var s = document.createElement('script');
      s.src = src;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadCss(href, integrity) {
    if ([].slice.call(document.styleSheets).some(function (s) { return s.href === href; })) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    if (integrity) { l.integrity = integrity; l.crossOrigin = 'anonymous'; l.referrerPolicy = 'no-referrer'; }
    document.head.appendChild(l);
  }

  // ─── UI strings (English) ───────────────────────────────────────────────
  var courseName = (document.querySelector('meta[name="course-name"]') || {}).content || 'this course';
  var STR = {
    openChat:        'Ask about ' + courseName,
    title:           'Study assistant',
    resetAria:       'Clear conversation',
    resetTitle:      'Restart',
    closeAria:       'Close chat',
    closeTitle:      'Close',
    placeholder:     'Ask about the page or the course…',
    send:            'Send',
    hint:            'The assistant grounds answers in the visible page and course materials. It can be wrong — verify against the source.',
    errPrefix:       'Error',
    presetTriggerHint: 'Model',
    presets: {
      fast:     { label: 'Fast',      pros: ['Quick replies', 'Low latency'], cons: ['Less accurate', 'Short answers'] },
      balanced: { label: 'Balanced',  pros: ['Good balance', 'Decent accuracy'], cons: ['A bit slower than fast'] },
      quality:  { label: 'Smart',     pros: ['Best on hard questions', 'Detailed'], cons: ['Slower', 'May rate-limit'] },
    },
  };
  var PRESET_KEY = 'study_chat_preset';
  var VALID_PRESETS = ['fast', 'balanced', 'quality'];

  function getPreset() {
    try {
      var v = localStorage.getItem(PRESET_KEY);
      if (VALID_PRESETS.indexOf(v) >= 0) return v;
    } catch (e) {}
    return 'balanced';
  }
  function setPreset(p) { try { localStorage.setItem(PRESET_KEY, p); } catch (e) {} }

  // ─── Page context ───────────────────────────────────────────────────────
  function getPageContext() {
    var sectionId = null, sectionTitle = null;
    // section.html uses #section-id and #section-title
    var sidEl = document.getElementById('section-id');
    var titleEl = document.getElementById('section-title');
    if (sidEl && sidEl.textContent.trim()) sectionId = sidEl.textContent.trim();
    if (titleEl && titleEl.textContent.trim()) sectionTitle = titleEl.textContent.trim();

    var blocks = document.querySelectorAll('p, li, h2, h3, h4, td, th, pre, blockquote, dt, dd, figcaption');
    var vh = window.innerHeight;
    var margin = vh * 0.5;
    var visible = [];
    for (var j = 0; j < blocks.length; j++) {
      var rr = blocks[j].getBoundingClientRect();
      if (rr.bottom > -margin && rr.top < vh + margin) {
        var t = blocks[j].innerText.trim();
        if (t) visible.push(t);
      }
    }
    var text = visible.length ? visible.join('\n\n') : document.body.innerText;
    return {
      section_id:  sectionId,
      section:     sectionTitle ? { id: sectionId, title: sectionTitle } : null,
      url:         window.location.pathname,
      visible_text: (text || '').substring(0, 4500),
    };
  }

  // ─── Styles ─────────────────────────────────────────────────────────────
  var css =
    '.sca-toggle{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:var(--accent,#1f4e79);color:#fff;border:none;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18);z-index:9999;display:grid;place-items:center;font-family:var(--sans,system-ui);font-size:24px;transition:transform .15s,background .15s}' +
    '.sca-toggle:hover{transform:scale(1.06);background:var(--accent-dark,#163758)}' +
    '.sca-panel{position:fixed;bottom:96px;right:24px;width:420px;max-width:calc(100vw - 32px);height:min(78vh,720px);background:var(--paper,#f4f1ea);border:1px solid var(--line,#c9c0ae);border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.22);display:none;flex-direction:column;z-index:9999;overflow:hidden;font-family:var(--serif,Georgia,serif)}' +
    '.sca-panel.open{display:flex}' +
    '.sca-header{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line-soft,#ddd5c4);background:var(--paper-dark,#e8e3d6)}' +
    '.sca-header h3{margin:0;font-size:1rem;font-weight:500;flex:1}' +
    '.sca-icon-btn{background:none;border:none;color:var(--ink-faded,#6b6257);cursor:pointer;width:30px;height:30px;border-radius:4px;display:grid;place-items:center;font-size:18px}' +
    '.sca-icon-btn:hover{background:var(--paper,#f4f1ea);color:var(--ink,#1a1612)}' +
    '.sca-preset-bar{padding:6px 12px;border-bottom:1px solid var(--line-soft,#ddd5c4);background:var(--paper-dark,#e8e3d6);position:relative}' +
    '.sca-preset-trigger{font-family:var(--mono,monospace);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faded,#6b6257);background:none;border:1px solid var(--line,#c9c0ae);padding:4px 10px;border-radius:14px;cursor:pointer}' +
    '.sca-preset-trigger:hover{border-color:var(--accent,#1f4e79);color:var(--accent,#1f4e79)}' +
    '.sca-preset-pop{position:absolute;top:calc(100% + 4px);left:12px;right:12px;background:var(--paper,#f4f1ea);border:1px solid var(--line,#c9c0ae);border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,.12);padding:6px;display:none;z-index:5}' +
    '.sca-preset-pop.open{display:block}' +
    '.sca-preset-opt{display:block;width:100%;text-align:left;padding:8px 10px;background:none;border:none;border-radius:4px;cursor:pointer;font-family:var(--serif,Georgia);font-size:.9rem;color:var(--ink,#1a1612)}' +
    '.sca-preset-opt:hover,.sca-preset-opt.active{background:var(--paper-dark,#e8e3d6)}' +
    '.sca-messages{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth}' +
    '.sca-msg{font-size:.95rem;line-height:1.55;max-width:95%}' +
    '.sca-msg.user{align-self:flex-end;background:var(--accent,#1f4e79);color:#fff;padding:8px 12px;border-radius:12px 12px 2px 12px;max-width:80%}' +
    '.sca-msg.bot{align-self:flex-start;color:var(--ink,#1a1612)}' +
    '.sca-msg.bot p{margin:0 0 .6rem}.sca-msg.bot p:last-child{margin-bottom:0}' +
    '.sca-msg.bot pre{background:var(--paper-dark,#e8e3d6);padding:8px 10px;border-radius:4px;font-size:.82rem;overflow-x:auto}' +
    '.sca-msg.bot code{background:var(--paper-dark,#e8e3d6);padding:.1em .3em;border-radius:3px;font-size:.88em}' +
    '.sca-msg.bot pre code{background:none;padding:0}' +
    '.sca-msg.bot ul,.sca-msg.bot ol{padding-left:1.2rem;margin:.4rem 0}' +
    '.sca-msg.error{color:#a02020;font-style:italic}' +
    '.sca-hint{padding:0 16px 8px;font-size:.78rem;color:var(--ink-faded,#6b6257);font-style:italic;line-height:1.4}' +
    '.sca-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line-soft,#ddd5c4);background:var(--paper-dark,#e8e3d6)}' +
    '.sca-form textarea{flex:1;font-family:var(--serif,Georgia);font-size:.95rem;background:var(--paper,#f4f1ea);border:1px solid var(--line,#c9c0ae);border-radius:6px;padding:8px 10px;resize:none;min-height:40px;max-height:140px;outline:none}' +
    '.sca-form textarea:focus{border-color:var(--accent,#1f4e79)}' +
    '.sca-form button{background:var(--accent,#1f4e79);color:#fff;border:none;border-radius:6px;padding:0 16px;font-family:var(--sans,system-ui);font-size:.9rem;cursor:pointer}' +
    '.sca-form button:hover{background:var(--accent-dark,#163758)}' +
    '.sca-form button:disabled{opacity:.5;cursor:wait}' +
    '.sca-typing{font-size:.85rem;color:var(--ink-faded,#6b6257);font-style:italic}' +
    '@media (max-width:480px){.sca-panel{right:8px;left:8px;width:auto;bottom:80px;height:calc(100vh - 100px)}.sca-toggle{bottom:16px;right:16px}}';

  // ─── DOM ────────────────────────────────────────────────────────────────
  var toggleBtn, panel, messagesEl, formEl, textareaEl, sendBtn, presetTrigger, presetPop;
  var history = [];
  var busy = false;

  function injectStyle() {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildUI() {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'sca-toggle';
    toggleBtn.setAttribute('aria-label', STR.openChat);
    toggleBtn.title = STR.openChat;
    toggleBtn.textContent = '?';
    toggleBtn.addEventListener('click', togglePanel);
    document.body.appendChild(toggleBtn);

    panel = document.createElement('div');
    panel.className = 'sca-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', STR.title);
    panel.innerHTML =
      '<div class="sca-header">' +
        '<h3>' + STR.title + '</h3>' +
        '<button class="sca-icon-btn sca-reset" aria-label="' + STR.resetAria + '" title="' + STR.resetTitle + '">↻</button>' +
        '<button class="sca-icon-btn sca-close" aria-label="' + STR.closeAria + '" title="' + STR.closeTitle + '">×</button>' +
      '</div>' +
      '<div class="sca-preset-bar">' +
        '<button class="sca-preset-trigger" aria-haspopup="true">' + STR.presetTriggerHint + ': <span class="sca-preset-label">balanced</span> ▾</button>' +
        '<div class="sca-preset-pop" role="menu"></div>' +
      '</div>' +
      '<div class="sca-messages"></div>' +
      '<div class="sca-hint">' + STR.hint + '</div>' +
      '<form class="sca-form">' +
        '<textarea placeholder="' + STR.placeholder + '" rows="1"></textarea>' +
        '<button type="submit">' + STR.send + '</button>' +
      '</form>';
    document.body.appendChild(panel);

    messagesEl    = panel.querySelector('.sca-messages');
    formEl        = panel.querySelector('.sca-form');
    textareaEl    = formEl.querySelector('textarea');
    sendBtn       = formEl.querySelector('button');
    presetTrigger = panel.querySelector('.sca-preset-trigger');
    presetPop     = panel.querySelector('.sca-preset-pop');

    panel.querySelector('.sca-close').addEventListener('click', togglePanel);
    panel.querySelector('.sca-reset').addEventListener('click', resetChat);
    formEl.addEventListener('submit', onSubmit);
    textareaEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); formEl.requestSubmit(); }
    });
    textareaEl.addEventListener('input', autosize);

    presetTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      presetPop.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target)) presetPop.classList.remove('open');
    });

    renderPresetPopover();
    updatePresetLabel();
  }

  function renderPresetPopover() {
    var current = getPreset();
    presetPop.innerHTML = VALID_PRESETS.map(function (p) {
      var info = STR.presets[p];
      return '<button class="sca-preset-opt' + (p === current ? ' active' : '') + '" data-preset="' + p + '">' +
        '<strong>' + info.label + '</strong>' +
        '</button>';
    }).join('');
    presetPop.querySelectorAll('.sca-preset-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPreset(btn.dataset.preset);
        renderPresetPopover();
        updatePresetLabel();
        presetPop.classList.remove('open');
      });
    });
  }
  function updatePresetLabel() {
    var p = getPreset();
    var label = panel.querySelector('.sca-preset-label');
    if (label) label.textContent = STR.presets[p].label.toLowerCase();
  }

  function autosize() {
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(140, textareaEl.scrollHeight) + 'px';
  }
  function togglePanel() {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      setTimeout(function () { textareaEl.focus(); }, 100);
    }
  }
  function resetChat() { history = []; messagesEl.innerHTML = ''; }

  function appendMsg(role, text, opts) {
    var el = document.createElement('div');
    el.className = 'sca-msg ' + role + (opts && opts.error ? ' error' : '');
    if (role === 'user') el.textContent = text;
    else el.innerHTML = '<span class="sca-typing">…</span>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  // ─── Markdown + KaTeX render pipeline ───────────────────────────────────
  function preProcessMath(text) {
    function wrapDisplay(_, body) { return '$$' + body + '$$'; }
    function wrapInline(_, body)  { return '$'  + body + '$';  }
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, wrapDisplay);
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, wrapInline);
    text = text.replace(/^[ \t]*\[([ \t]*\\[a-zA-Z][\s\S]*?)\][ \t]*$/gm, wrapDisplay);
    text = text.replace(/(?<!\\)\(([^()\n]*\\[a-zA-Z][^()\n]*)(?<!\\)\)/g, wrapInline);
    return text;
  }
  function renderBot(el, raw) {
    var processed = preProcessMath(raw);
    var html = (window.marked && window.marked.parse) ? window.marked.parse(processed) : processed;
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    el.innerHTML = html;
    if (window.renderMathInElement) {
      try { window.renderMathInElement(el, { delimiters: KATEX_DELIMITERS, throwOnError: false }); } catch (e) {}
    }
  }

  // ─── Streaming request ──────────────────────────────────────────────────
  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    var q = textareaEl.value.trim();
    if (!q) return;
    textareaEl.value = '';
    autosize();
    appendMsg('user', q);
    history.push({ role: 'user', content: q });
    var botEl = appendMsg('bot', '');
    busy = true;
    sendBtn.disabled = true;
    streamAnswer(q, botEl)
      .catch(function (err) {
        botEl.classList.add('error');
        botEl.textContent = STR.errPrefix + ': ' + (err && err.message ? err.message : err);
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
        textareaEl.focus();
      });
  }

  function streamAnswer(question, botEl) {
    var payload = {
      question: question,
      preset: getPreset(),
      page_context: getPageContext(),
      history: history.slice(-10),
    };
    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).error || t; } catch (e) {}
          throw new Error('HTTP ' + resp.status + ': ' + msg);
        });
      }
      var reader = resp.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var acc = '';
      botEl.innerHTML = '';

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (buf.trim()) processLine(buf.trim());
            history.push({ role: 'assistant', content: acc });
            return;
          }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) processLine(lines[i].trim());
          return pump();
        });
      }

      function processLine(line) {
        if (!line) return;
        var obj;
        try { obj = JSON.parse(line); } catch (e) { return; }
        if (obj.t) {
          acc += obj.t;
          renderBot(botEl, acc);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (obj.e) {
          throw new Error(obj.e);
        }
      }

      return pump();
    });
  }

  function boot() {
    injectStyle();
    buildUI();
    loadCss(KATEX_CSS_HREF, KATEX_CSS_INTEGRITY);
    loadScript(MARKED_SRC, MARKED_INTEGRITY)
      .then(function () { return loadScript(DOMPURIFY_SRC, DOMPURIFY_INTEGRITY); })
      .then(function () { return loadScript(KATEX_JS_SRC, KATEX_JS_INTEGRITY); })
      .then(function () { return loadScript(KATEX_AR_SRC, KATEX_AR_INTEGRITY); })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
