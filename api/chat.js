// Vercel serverless function — generic study assistant.
//
// Reads course metadata from /course_config.json, retrieves top-K passages
// from /generated/chat/chunks.json by cosine similarity over an embedding of
// the user question, builds a system prompt with the visible page text plus
// retrieved passages, and streams the answer from OpenRouter as NDJSON
// (one {t: chunk} object per line; {d: true} on done; {e: msg} on error).
//
// Auth: requires OPENROUTER_API_KEY in the environment. Course-specific
// knobs (models, embedding model) come from course_config.features.chat.

// NOTE: When deploying from a separate outputDirectory (like dist/), the
// serverless function bundle should not assume the static assets exist on the
// runtime filesystem. We therefore load JSON via fetch() from the deployment
// origin.

const DEFAULT_PRESET = "balanced";
const TOP_K = 3;
const MAX_BOOK_CONTEXT_CHARS = 12000;
const SECTION_HINT_BOOST = 0.03;

const NDJSON_HEADERS = {
  "Content-Type":      "application/x-ndjson; charset=utf-8",
  "Cache-Control":     "no-store",
  "X-Accel-Buffering": "no",
};

// ─────────────────────── Config (cached) ───────────────────────

let _configCache = null;
async function loadConfig(origin) {
  if (_configCache) return _configCache;
  const url = new URL("/course_config.json", origin).toString();
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Could not load course_config.json (${resp.status}): ${body}`);
  }
  _configCache = await resp.json();
  return _configCache;
}

function chatConfig(cfg) {
  return (cfg.features && cfg.features.chat) || {};
}

function presetModels(preset, cfg) {
  const cc = chatConfig(cfg);
  const models = cc.chat_models || {};
  const primary = models[preset];
  if (!primary) return [];
  // Fall back to other presets if the chosen one fails.
  const fallbacks = [models.quality, models.balanced, models.fast].filter(
    (m) => m && m !== primary
  );
  return [primary, ...fallbacks];
}

// ─────────────────────── Chunks loader (cached) ───────────────────────

let _chunksCache = null;
async function loadChunks(origin) {
  if (_chunksCache) return _chunksCache;
  const url = new URL("/generated/chat/chunks.json", origin).toString();
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Could not load generated/chat/chunks.json (${resp.status}): ${body}`);
  }
  _chunksCache = await resp.json();
  return _chunksCache;
}

// ─────────────────────── Embedding ───────────────────────

async function getEmbedding(text, apiKey, model) {
  const resp = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: [text], encoding_format: "float" }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Embedding call failed (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  return data.data[0].embedding;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function topKChunks(queryVec, chunks, sectionHint, k) {
  const hint = (sectionHint || "").toLowerCase();
  const scored = chunks.map((c) => {
    let score = cosineSim(queryVec, c.embedding || []);
    const tag = (c.section_id || c.chapter || "").toLowerCase();
    if (hint && tag.includes(hint)) score += SECTION_HINT_BOOST;
    return { score, chunk: c };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.chunk);
}

// ─────────────────────── System prompt (course-agnostic) ───────────────────────

function buildSystemPrompt({ pageContext, bookContext, cfg }) {
  const courseName = cfg.course_name || "this course";
  const courseCode = cfg.course_code || "";
  const university = cfg.university || "";

  const ctx = pageContext || {};
  const visibleText = (ctx.visible_text || "").trim() || "(none)";
  let locationInfo = "";
  if (ctx.section && ctx.section.title) {
    locationInfo = `\nThe student is currently viewing section: "${ctx.section.title}".`;
  } else if (ctx.section_id) {
    locationInfo = `\nThe student is currently viewing section: ${ctx.section_id}.`;
  }

  const header =
    `You are a helpful study assistant for ${courseName}` +
    (courseCode ? ` (${courseCode})` : "") +
    (university ? ` at ${university}` : "") + ".";

  const rules = [
    "Answer in the same language the student writes in.",
    "Ground your answer in the context below first: prefer the visible page text when the student asks about what they're looking at, then the course-material excerpts.",
    "If the context doesn't contain the answer, say so plainly instead of inventing one.",
    "Don't end with word counts or labels like '(99 words)'. Don't preface with 'let me think' — just answer.",
    "Math: this chat renders KaTeX inside delimiters. Use \\( ... \\) or $ ... $ for inline, and \\[ ... \\] or $$ ... $$ for display math. Raw LaTeX outside delimiters won't render.",
  ].join("\n");

  return [
    header,
    rules,
    locationInfo,
    "",
    "## Visible page text the student is reading:",
    visibleText,
    "",
    "## Excerpts from course materials:",
    bookContext || "(none available)",
  ].join("\n");
}

// ─────────────────────── SSE → NDJSON converter ───────────────────────

function openRouterSseToNdjsonStream(upstreamBody) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      let buf = "";
      const write = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      const processBlock = (block) => {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trimStart();
          if (raw === "[DONE]") continue;
          let json;
          try { json = JSON.parse(raw); } catch { continue; }
          if (json.error) {
            const msg = (json.error && (json.error.message || JSON.stringify(json.error))) || "unknown model error";
            write({ e: msg });
            controller.close();
            return false;
          }
          const piece = json.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece.length) write({ t: piece });
        }
        return true;
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          buf += dec.decode(value ?? new Uint8Array(), { stream: !done });
          if (done) {
            buf += dec.decode();
            buf = buf.replace(/\r\n/g, "\n");
            while (true) {
              const sep = buf.indexOf("\n\n");
              if (sep === -1) break;
              const block = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              if (!processBlock(block)) return;
            }
            if (buf.trim() && !processBlock(buf)) return;
            break;
          }
          buf = buf.replace(/\r\n/g, "\n");
          while (true) {
            const sep = buf.indexOf("\n\n");
            if (sep === -1) break;
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            if (!processBlock(block)) return;
          }
        }
        write({ d: true });
        controller.close();
      } catch (err) {
        try { write({ e: err.message || String(err) }); } catch {}
        controller.close();
      }
    },
  });
}

// ─────────────────────── POST handler ───────────────────────

export async function POST(request) {
  const origin = new URL(request.url).origin;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENROUTER_API_KEY not set in environment." }, { status: 500 });
  }

  let cfg;
  try {
    cfg = await loadConfig(origin);
  } catch (err) {
    return Response.json({ error: err.message || String(err) }, { status: 500 });
  }

  const cc = chatConfig(cfg);
  if (!cc.enabled) {
    return Response.json({ error: "Chat is disabled in course_config.json." }, { status: 503 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const question = (body && body.question) || "";
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "Missing question." }, { status: 400 });
  }

  let preset = body.preset || DEFAULT_PRESET;
  if (!cc.chat_models || !cc.chat_models[preset]) {
    return Response.json({ error: `Unknown preset: ${preset}` }, { status: 400 });
  }

  const pageContext = body.page_context || null;
  const history = Array.isArray(body.history) ? body.history : [];
  const sectionHint = pageContext?.section_id || pageContext?.section?.id || "";
  const sectionTitle = pageContext?.section?.title || "";

  let searchQuery = question.trim();
  if (sectionTitle) searchQuery = `[${sectionHint || ""} – ${sectionTitle}] ${searchQuery}`;
  else if (sectionHint) searchQuery = `[${sectionHint}] ${searchQuery}`;

  // Retrieval (best-effort — failing falls back to "no excerpts")
  let bookContext = "";
  try {
    const embedModel = cc.embed_model || "nvidia/llama-nemotron-embed-vl-1b-v2:free";
    const embedPromise = getEmbedding(searchQuery, apiKey, embedModel);
    let chunks = [];
    try { chunks = await loadChunks(origin); }
    catch (err) { console.warn("[chat] could not load chunks.json:", err.message); }
    const queryVec = await embedPromise;
    if (chunks.length > 0) {
      const top = topKChunks(queryVec, chunks, sectionHint, TOP_K);
      bookContext = top.map((c) => c.text).join("\n\n---\n\n");
      if (bookContext.length > MAX_BOOK_CONTEXT_CHARS) {
        bookContext = bookContext.slice(0, MAX_BOOK_CONTEXT_CHARS) + "\n\n[excerpt truncated]";
      }
    }
  } catch (err) {
    console.warn("[chat] retrieval failed:", err.message);
  }

  const systemPrompt = buildSystemPrompt({ pageContext, bookContext, cfg });
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: question },
  ];

  const candidates = presetModels(preset, cfg);
  if (!candidates.length) {
    return Response.json({ error: "No chat models configured." }, { status: 500 });
  }
  let lastErr = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    let resp;
    try {
      resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });
    } catch (err) {
      lastErr = err;
      console.warn(`[chat] network error against ${model}:`, err.message);
      continue;
    }
    if (resp.ok && resp.body) {
      const ndjson = openRouterSseToNdjsonStream(resp.body);
      return new Response(ndjson, { status: 200, headers: NDJSON_HEADERS });
    }
    let errBody = "";
    try { errBody = await resp.text(); } catch {}
    if (resp.status === 429 || resp.status === 503) {
      lastErr = new Error(`HTTP ${resp.status}: ${errBody || resp.statusText}`);
      continue;
    }
    const status = resp.status >= 500 ? 502 : resp.status;
    return Response.json(
      { error: `Model API failed (${resp.status}): ${errBody || resp.statusText}` },
      { status }
    );
  }

  return Response.json(
    {
      error:
        "All model candidates failed (rate-limit or unavailable). Try again in a moment. " +
        (lastErr ? `Last error: ${lastErr.message}` : ""),
    },
    { status: 502 }
  );
}

export async function GET(request) {
  try {
    const origin = new URL(request.url).origin;
    const cfg = await loadConfig(origin);
    const cc = chatConfig(cfg);
    const chunks = await loadChunks(origin);
    return Response.json({
      status: "ok",
      enabled: !!cc.enabled,
      chunks: chunks.length,
      embed_model: cc.embed_model || null,
      presets: Object.keys(cc.chat_models || {}),
    });
  } catch (err) {
    return Response.json({ status: "error", message: err.message }, { status: 500 });
  }
}
