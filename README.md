# Course Study Site — Skeleton

A reusable static-site skeleton for building exam-study websites for
university courses. Edit `course_config.json`, drop your course materials
into `resources/`, run one shell script, open `web/index.html`.

What you get: per-section study notes, flashcards with active-recall
flipping, and an exam-prep page with priority topics, practice questions,
key definitions, and a suggested study schedule. Optionally a floating
chat widget that grounds answers in your course materials.

## Quick start

1. **Install Python deps.**
   ```bash
   pip install requests pdfplumber python-pptx
   # If you set llm.provider = "anthropic" later, also install:
   # pip install anthropic
   # If you enable the optional chat widget, also install:
   # pip install openai
   ```

2. **Set your API key.** Default provider is OpenRouter (free tier):
   ```bash
   export OPENROUTER_API_KEY=sk-or-...
   ```
   To use Anthropic instead, set `llm.provider` to `"anthropic"` in
   `course_config.json` and export `ANTHROPIC_API_KEY=sk-ant-...`. The
   optional chat widget always uses `OPENROUTER_API_KEY`.

3. **Edit `course_config.json`.** Set `course_code`, `course_name`,
   `university`, and the `sections` array. Each section needs an
   `id` (e.g. `section_01`), a `title`, and a short `description`.

4. **Fill in the three `context/` files.**
   - `context/course_description.md` — goals, scope, prior knowledge.
   - `context/exam_info.txt` — format, duration, aids, question types.
   - `context/MAL.md` — learning outcomes.

5. **Add course materials.** For each section, drop PDFs / PPTX into
   `resources/section_NN/`. If you have a Reducto-parsed JSON, drop it
   as `resources/section_NN/parsed.json` and the pipeline will prefer it
   over re-extracting.

6. **Run the generator.**
   ```bash
   bash scripts/generate_all.sh
   ```
   This runs four stages: parse → sections → flashcards → exam. Each
   stage is idempotent — re-running overwrites outputs cleanly.

7. **View the site locally.** See [Running locally](#running-locally) below.
   Deploy `/` to Vercel (or any static host) for a public version — the
   included `vercel.json` is preconfigured.

## Running locally

**You need an HTTP server.** Opening `web/index.html` via `file://`
will *not* work — the pages use `fetch()` to load JSON, which browsers
block on the `file://` protocol for security reasons.

**Serve from the REPO ROOT, not from `web/`.** The pages reference
`../course_config.json` and `../generated/…`, so the server's root has
to be the directory that contains both `web/` and `course_config.json`
as siblings.

### One-line server (recommended)

```bash
# from the repository root:
python -m http.server 8000
```

Then open:

| Page | URL |
|------|-----|
| Course landing page | <http://localhost:8000/web/> |
| A section | <http://localhost:8000/web/section.html?id=section_01> |
| Flashcards | <http://localhost:8000/web/flashcards.html?id=section_01> |
| Exam prep | <http://localhost:8000/web/exam.html> |

Stop the server with `Ctrl+C`.

### Alternatives

```bash
# Any of these also work, from the repo root:
npx serve .                 # Node — auto-picks a port
php -S localhost:8000       # if PHP is installed
ruby -run -e httpd . -p 8000
```

If you use **VS Code Live Server**, set the project root to this
repository (not `web/`), then right-click `web/index.html` → *Open with
Live Server*.

### Dev workflow tips

- **Hard-refresh** after generating new content: `Cmd-Shift-R` (macOS)
  or `Ctrl-Shift-R` (Linux / Windows). The pages cache JSON aggressively.
- **Keep DevTools open with "Disable cache" checked** while iterating on
  HTML/CSS/JS — otherwise stale `main.js` will silently break things.
- Sanity-check that JSON is reachable from the server:
  ```bash
  curl -I http://localhost:8000/course_config.json
  curl -I http://localhost:8000/generated/sections/section_01.json
  ```
  Both should return `HTTP/1.0 200 OK`. If they don't, your server is
  rooted in the wrong directory.

## Regenerating individual pieces

```bash
python scripts/parse_resources.py --section section_03
python scripts/generate_sections.py --section section_03
python scripts/generate_flashcards.py --section section_03
python scripts/generate_exam.py
```

## High-quality parsing via Reducto (optional)

`parse_resources.py` uses `pdfplumber`, which is free but loses tables and
equations. For textbooks and exam PDFs, [Reducto](https://reducto.ai)
produces much better structured output. Costs money per page; opt-in.

```bash
pip install reducto python-dotenv requests
export REDUCTO_API_KEY=…

# Parse the docs you listed in course_config.json -> reducto.documents
python scripts/parse_with_reducto.py

# One-off: parse a specific PDF
python scripts/parse_with_reducto.py --doc resources/_course/book.pdf

# Walk every PDF under resources/ (ignores the config list)
python scripts/parse_with_reducto.py --all
```

Per source PDF, two files are written next to it:
`<basename>.reducto.json` (Reducto's metafile — small, holds the parse
URL) and `<basename>.parsed.json` (the actual parsed content that the
rest of the pipeline reads). Two-step caching means a re-run after a
network blip can fetch the parsed content without paying for another
parse. Idempotent: skips up-to-date sources; `--force` to re-parse.

**Tuning for math-heavy textbooks** — open `scripts/parse_with_reducto.py`
and look at the `CONFIG` block at the top. The defaults are tuned for
information preservation:
- `REDUCTO_CHUNK_MODE = "variable"` — layout-aware chunk boundaries
- `REDUCTO_CHUNK_SIZE = 1500`, `REDUCTO_CHUNK_OVERLAP = 200` — generous,
  keeps proofs in one chunk
- `REDUCTO_EXTRACTION_MODE = "hybrid"` — combines OCR with the PDF's
  embedded text. **The key knob for equations**: LaTeX-rendered formulas
  survive verbatim instead of being re-OCR'd from glyphs.
- `REDUCTO_SUMMARIZE_FIGURES = True` — text descriptions of diagrams so
  visual content lands in the chunk text.

## Optional chat widget

Set `features.chat.enabled` to `true` in `course_config.json`. Then run
`bash scripts/generate_all.sh` again — it will additionally embed your
parsed resources into `generated/chat/chunks.json`. Deploy to Vercel and
the floating "?" button appears on every page, calling `/api/chat` to
stream answers grounded in the page and your course materials.

The chat widget needs `OPENROUTER_API_KEY` set in Vercel's environment.

## What's in each generated file

| Path | Shape |
|------|-------|
| `generated/sections/<id>.json` | `{ title, summary, key_concepts[], detailed_notes, common_mistakes[] }` |
| `generated/flashcards/<id>_flashcards.json` | `[ { front, back, difficulty: easy\|medium\|hard }, … ]` |
| `generated/exam/exam_prep.json` | `{ priority_topics[], practice_questions[], key_definitions[], study_schedule[] }` |
| `generated/chat/chunks.json` (optional) | Embedding index for the chat widget |

## Project layout

```
course_config.json     # the single source of truth — edit this first
context/               # 3 short text files you fill in
resources/             # your PDFs/PPTX go here, organized by section
prompts/               # LLM prompt templates ({{var}} substitution)
scripts/               # generation pipeline (Python)
generated/             # script output (not committed)
web/                   # the static site
api/chat.js            # optional Vercel function for the chat widget
```

See `CLAUDE.md` for more detail on architecture and conventions.
