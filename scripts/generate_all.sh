#!/usr/bin/env bash
# Master pipeline: parse → sections → flashcards → exam → (optional embeddings).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Parsing resources…"
python scripts/parse_resources.py

echo
echo "▶ Generating sections…"
python scripts/generate_sections.py

echo
echo "▶ Generating flashcards…"
python scripts/generate_flashcards.py

echo
echo "▶ Generating exam prep…"
python scripts/generate_exam.py

# Optional embeddings build, only if chat is enabled in the config.
chat_enabled=$(python -c "import json; print(json.load(open('course_config.json'))['features']['chat']['enabled'])" 2>/dev/null || echo "False")
if [ "$chat_enabled" = "True" ]; then
  echo
  echo "▶ Building chat embeddings (chat is enabled)…"
  python scripts/build_embeddings.py
fi

echo
echo "✅ All content generated. Open web/index.html in a browser."
