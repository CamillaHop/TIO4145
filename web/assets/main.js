// Shared helpers for the static study site. Loads marked + DOMPurify lazily
// from jsDelivr for markdown rendering and exposes a window.StudySite namespace
// used by index/section/flashcards/exam pages.
(function () {
  'use strict';

  var MARKED_SRC          = 'https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.umd.min.js';
  var MARKED_INTEGRITY    = 'sha384-EjL6IeH3KCXB9dkBQaYqnb/m6V3TOBP++kooL0bl43Vt6eCFJ2Pxck/B/dU4PB8d';
  var DOMPURIFY_SRC       = 'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js';
  var DOMPURIFY_INTEGRITY = 'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu';
  var KATEX_CSS           = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  var KATEX_JS            = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  var KATEX_AUTORENDER    = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      if ([].some.call(document.scripts, function (s) { return s.src === src; })) {
        resolve(); return;
      }
      var s = document.createElement('script');
      s.src = src;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
      }
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  var mdReady = null;
  function ensureMarkdown() {
    if (mdReady) return mdReady;
    mdReady = loadScript(MARKED_SRC, MARKED_INTEGRITY)
      .then(function () { return loadScript(DOMPURIFY_SRC, DOMPURIFY_INTEGRITY); })
      .catch(function (e) { console.warn('markdown libs failed to load', e); });
    return mdReady;
  }

  function loadStylesheet(href) {
    if ([].some.call(document.styleSheets, function (s) { return s.href === href; })) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  var katexReady = null;
  function ensureKatex() {
    if (katexReady) return katexReady;
    loadStylesheet(KATEX_CSS);
    katexReady = loadScript(KATEX_JS)
      .then(function () { return loadScript(KATEX_AUTORENDER); })
      .catch(function (e) { console.warn('KaTeX failed to load', e); });
    return katexReady;
  }

  // Walk an element tree and render any $...$ / $$...$$ / \(..\) / \[..\] math.
  // Safe to call multiple times — KaTeX skips already-rendered nodes.
  function renderMath(root) {
    if (!root || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '\\[', right: '\\]', display: true  },
          { left: '\\(', right: '\\)', display: false },
          { left: '$',  right: '$',  display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {
      console.warn('KaTeX render failed', e);
    }
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Pull $$…$$ and $…$ math out of the source BEFORE markdown parsing so
  // marked doesn't mangle LaTeX (e.g. stripping backslashes from \%, \_),
  // then restore the math blocks before sanitisation. KaTeX auto-render
  // picks them up on the live DOM.
  //
  // Subtlety: the LLM writes \$ for currency BOTH inside and outside math:
  //   outside math:  "price = \$36.00"  → display as literal $
  //   inside math:   "$P_0 = ... = \$43.73$"  → KaTeX renders \$ as literal $
  // So inside math we preserve \$; outside math we wrap the $ in a <span>
  // so KaTeX auto-render (which works on text nodes) can't see it as a
  // delimiter and accidentally bridge two unrelated $…$ blocks.
  function protectMath(src) {
    var math = [];
    var s = String(src);

    // 1. $$…$$ display math first.
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (whole) {
      math.push(whole);
      return '@@MATH' + (math.length - 1) + '@@';
    });

    // 2. $…$ inline math. The opening $ must NOT be preceded by '\' (that's
    //    a literal currency $). The content may contain '\$' (literal $
    //    inside a formula) — the regex permits any \X escape or non-$ char.
    s = s.replace(
      /(^|[^\\])\$((?:\\.|[^$\n])+?)\$/g,
      function (_w, pre, content) {
        math.push('$' + content + '$');
        return pre + '@@MATH' + (math.length - 1) + '@@';
      }
    );

    // 3. Whatever \$ remains is outside any math block — currency in prose.
    //    Stash under a placeholder so we can wrap it in a <span> at restore
    //    time, isolating it from KaTeX's delimiter scanner.
    s = s.replace(/\\\$/g, '@@LITDOLLAR@@');

    return { text: s, math: math };
  }
  function restoreMath(html, math) {
    return html
      .replace(/@@MATH(\d+)@@/g, function (_, i) { return math[+i]; })
      .replace(/@@LITDOLLAR@@/g, '<span class="lit-dollar">$</span>');
  }

  // Textbook-style callouts. The LLM (and most finance/math writing)
  // conventionally opens a "callout" paragraph with **Label:** (bold +
  // colon). We promote those to <aside class="callout callout-{kind}">
  // blocks so CSS can box them like a textbook would.
  var CALLOUT_KINDS = {
    'worked example':  'example',
    'example':         'example',
    'definition':      'definition',
    'theorem':         'theorem',
    'proposition':     'theorem',
    'lemma':           'theorem',
    'corollary':       'theorem',
    'proof':           'proof',
    'rule':            'rule',
    'key insight':     'insight',
    'insight':         'insight',
    'intuition':       'insight',
    'key idea':        'insight',
    'key lesson':      'insight',
    'key fact':        'insight',
    'note':            'note',
    'recall':          'note',
    'remark':          'note',
    'caveat':          'warning',
    'caveats':         'warning',
    'real-world caveats': 'warning',
    'limitations':     'warning',
    'limitation':      'warning',
    'warning':         'warning',
    'caution':         'warning'
  };
  function styleCallouts(html) {
    return html.replace(
      /<p><strong>([^<:]+?)(\s*\([^)]*\))?:<\/strong>([\s\S]*?)<\/p>/g,
      function (whole, label, suffix, body) {
        var key = label.toLowerCase().trim();
        var kind = CALLOUT_KINDS[key];
        if (!kind) return whole;
        var fullLabel = label + (suffix || '');
        return (
          '<aside class="callout callout-' + kind + '">' +
            '<div class="callout-label">' + fullLabel + '</div>' +
            '<div class="callout-body">' + body.trim() + '</div>' +
          '</aside>'
        );
      }
    );
  }

  function renderMarkdown(md) {
    if (!md) return '';
    if (!(window.marked && window.marked.parse)) {
      return '<pre>' + escapeHtml(md) + '</pre>';
    }
    var p = protectMath(md);
    var html = window.marked.parse(p.text);
    html = restoreMath(html, p.math);
    html = styleCallouts(html);
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    return html;
  }

  // Inline variant: parse short snippets (e.g. a concept name, a list item)
  // without wrapping them in a <p>. Falls back to escapeHtml if marked isn't
  // ready yet.
  function renderInline(md) {
    if (md == null) return '';
    if (!(window.marked && window.marked.parseInline)) {
      return escapeHtml(md);
    }
    var p = protectMath(md);
    var html = window.marked.parseInline(p.text);
    html = restoreMath(html, p.math);
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    return html;
  }

  function getParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function applyCourseChrome(cfg) {
    document.querySelectorAll('[data-course-name]').forEach(function (el) {
      el.textContent = cfg.course_name || '';
    });
    document.querySelectorAll('[data-course-code]').forEach(function (el) {
      el.textContent = cfg.course_code || '';
    });
    document.querySelectorAll('[data-university]').forEach(function (el) {
      el.textContent = cfg.university || '';
    });
    if (cfg.course_name) document.title = (document.title || '') + ' — ' + cfg.course_name;
  }

  function maybeLoadChat(cfg) {
    var chat = cfg.features && cfg.features.chat;
    if (!chat || !chat.enabled) return;
    var meta = document.createElement('meta');
    meta.name = 'course-name';
    meta.content = cfg.course_name || '';
    document.head.appendChild(meta);
    var meta2 = document.createElement('meta');
    meta2.name = 'course-code';
    meta2.content = cfg.course_code || '';
    document.head.appendChild(meta2);
    var script = document.createElement('script');
    script.src = 'assets/chat-widget.js';
    script.defer = true;
    document.body.appendChild(script);
  }

  window.StudySite = {
    loadConfig:     function () { return fetchJson('../course_config.json'); },
    loadSection:    function (id) { return fetchJson('../generated/sections/' + id + '.json'); },
    loadFlashcards: function (id) { return fetchJson('../generated/flashcards/' + id + '_flashcards.json'); },
    loadExam:       function () { return fetchJson('../generated/exam/exam_prep.json'); },
    ensureMarkdown: ensureMarkdown,
    ensureKatex:    ensureKatex,
    renderMarkdown: renderMarkdown,
    renderInline:   renderInline,
    renderMath:     renderMath,
    escapeHtml:     escapeHtml,
    getParam:       getParam,
    applyCourseChrome: applyCourseChrome,
    maybeLoadChat:  maybeLoadChat,
  };

  // Kick off markdown + KaTeX loading early so pages don't have to wait.
  ensureMarkdown();
  ensureKatex();
})();
