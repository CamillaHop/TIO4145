# CLAUDE.md

This repository is a **course-agnostic skeleton** for building exam-study
websites for university courses. A student or instructor adopts the
repository by editing `course_config.json`, dropping raw course materials
into `resources/`, filling three short context files, and running one
script. The result is a static site that can be deployed anywhere.

## How content flows

```
resources/section_NN/  (raw PDFs/PPTX/parsed.json)
        │
        ▼
scripts/parse_resources.py   →  writes *.parsed.json next to each source
        │
        ▼
scripts/generate_sections.py   →  generated/sections/<id>.json
scripts/generate_flashcards.py →  generated/flashcards/<id>_flashcards.json
scripts/generate_exam.py       →  generated/exam/exam_prep.json
        │
        ▼
web/{index,section,flashcards,exam}.html  (fetch JSON at runtime)
```

`course_config.json` is the **single source of truth** for sections and
course metadata. Every script and every web page reads from it.

## Directory roles

| Path | Role |
|------|------|
| `course_config.json` | Course metadata + section list. Edit this first. |
| `context/` | Three user-filled text files (course description, exam info, learning outcomes) consumed by the LLM scripts. |
| `resources/section_NN/` | User-supplied raw materials. **Never modified by scripts**, with one exception: `parse_resources.py` writes `<basename>.parsed.json` next to each PDF/PPTX. Those `*.parsed.json` files are regeneratable. |
| `prompts/*.prompt.md` | LLM prompt templates with `{{var}}` placeholders. Edit to improve content quality — do not hardcode prompts in Python. |
| `scripts/` | Generation pipeline. Keep it course-agnostic. |
| `generated/` | Script output. **Always safe to delete and regenerate.** Not committed to git. |
| `web/` | Static site. Loads JSON from `generated/` via `fetch()`. Works from `file://`. |
| `api/chat.js` | Optional Vercel serverless function for the chat widget. |

## Key commands

```bash
# Full pipeline (parse + sections + flashcards + exam, plus embeddings if chat is enabled)
bash scripts/generate_all.sh

# Just pre-parse PDFs/PPTX
python scripts/parse_resources.py
python scripts/parse_resources.py --section section_03
python scripts/parse_resources.py --force

# Regenerate one section
python scripts/generate_sections.py --section section_03
python scripts/generate_flashcards.py --section section_03
```

## Adding a new section

1. Append an entry to `course_config.json` under `sections`:
   ```json
   { "id": "section_09", "title": "…", "description": "…", "resource_folder": "resources/section_09" }
   ```
2. Create `resources/section_09/` and drop in the relevant PDFs, PPTX files,
   or pre-parsed `parsed.json`.
3. Run `bash scripts/generate_all.sh` (or just the per-section commands above).
4. The new section appears automatically on `web/index.html`.

## LLM providers and API keys

`course_config.json` → `llm.provider` controls which provider the generation
scripts call:

| Provider | Required env var | When to choose it |
|----------|------------------|--------------------|
| `openrouter` (default) | `OPENROUTER_API_KEY` | Free-tier models, one key shared with the chat widget. Default. |
| `anthropic` | `ANTHROPIC_API_KEY` | Higher structured-output quality (Sonnet 4.6). Costs money. |

The optional chat widget (when `features.chat.enabled` is true) always uses
`OPENROUTER_API_KEY`, regardless of generation provider.

`MODEL` env var overrides the configured model on a single run.

## What NOT to do

- Don't write course-specific content directly into HTML or Python — the
  point of this skeleton is that the same code works for any course.
- Don't hardcode LLM prompts in Python. They live in `prompts/*.prompt.md`.
- Don't commit `generated/` or `resources/**/*.parsed.json` — they're
  reproducible from sources + scripts.
- Don't write to `resources/` from scripts other than `parse_resources.py`.
- Don't reach for new generation passes when the answer is "rerun an
  existing script" — the pipeline is intentionally small.
