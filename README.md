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

7. **Open the site.**
   ```bash
   # Open the file directly:
   open web/index.html

   # Or serve it locally:
   python -m http.server 8000
   # then visit http://localhost:8000/web/
   ```
   Deploy `/` to Vercel (or any static host) for a public version. The
   included `vercel.json` is preconfigured.

## Regenerating individual pieces

```bash
python scripts/parse_resources.py --section section_03
python scripts/generate_sections.py --section section_03
python scripts/generate_flashcards.py --section section_03
python scripts/generate_exam.py
```

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
