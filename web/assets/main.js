// Shared helpers for the static study site. Loads marked + DOMPurify lazily
// from jsDelivr for markdown rendering and exposes a window.StudySite namespace
// used by index/section/flashcards/exam pages.
(function () {
  'use strict';

  var MARKED_SRC          = 'https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.umd.min.js';
  var MARKED_INTEGRITY    = 'sha384-EjL6IeH3KCXB9dkBQaYqnb/m6V3TOBP++kooL0bl43Vt6eCFJ2Pxck/B/dU4PB8d';
  var DOMPURIFY_SRC       = 'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js';
  var DOMPURIFY_INTEGRITY = 'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu';

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

  function renderMarkdown(md) {
    if (!md) return '';
    if (window.marked && window.marked.parse) {
      var html = window.marked.parse(String(md));
      if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
      return html;
    }
    // Fallback: escaped pre block while libs load
    return '<pre>' + escapeHtml(md) + '</pre>';
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
    renderMarkdown: renderMarkdown,
    escapeHtml:     escapeHtml,
    getParam:       getParam,
    applyCourseChrome: applyCourseChrome,
    maybeLoadChat:  maybeLoadChat,
  };

  // Kick off markdown loading early so pages don't have to wait.
  ensureMarkdown();
})();
