"""Generate generated/flashcards/<section_id>_flashcards.json for each section.

Prefers the already-generated generated/sections/<section_id>.json as input;
falls back to raw source text from resources/<section_id>/ when no section
JSON exists yet.

Usage:
    python scripts/generate_flashcards.py
    python scripts/generate_flashcards.py --section section_01
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from config_loader import (
    REPO_ROOT,
    call_llm_json,
    gather_source_text,
    load_config,
    load_prompt,
    render,
    write_json_atomic,
)

CARD_KEYS = {"front", "back", "difficulty"}
VALID_DIFFICULTY = {"easy", "medium", "hard"}


def get_section_content(sid: str) -> str:
    """Use the generated section JSON if it exists (richer), else raw source."""
    section_json = REPO_ROOT / "generated" / "sections" / f"{sid}.json"
    if section_json.exists():
        data = json.loads(section_json.read_text(encoding="utf-8"))
        parts = [
            f"Title: {data.get('title', '')}",
            f"Summary: {data.get('summary', '')}",
        ]
        for kc in data.get("key_concepts") or []:
            if isinstance(kc, dict):
                parts.append(f"- {kc.get('concept', '')}: {kc.get('explanation', '')}")
        if data.get("detailed_notes"):
            parts.append("\nNotes:\n" + str(data["detailed_notes"]))
        return "\n".join(parts)
    return gather_source_text(sid)


def generate_one(section: dict, cfg: dict, template: str) -> None:
    sid = section["id"]
    content = get_section_content(sid)
    if not content.strip():
        print(f"  SKIP {sid}: no input content (run generate_sections.py first, or add resources).", file=sys.stderr)
        return

    prompt = render(
        template,
        {
            "course_name":     cfg["course_name"],
            "section_title":   section["title"],
            "section_content": content,
        },
    )

    # Flashcards are short, well-bounded JSON — always use OpenRouter (free
    # tier) regardless of the global provider setting, to keep Anthropic
    # spend reserved for the heavy section + exam generators.
    llm_cfg  = cfg.get("llm", {})
    fc_model = llm_cfg.get("flashcards_model") or llm_cfg.get("openrouter_model")

    print(f"  calling LLM for {sid} (openrouter:{fc_model})…")
    data = call_llm_json(
        prompt,
        max_tokens=4000,
        provider="openrouter",
        model=fc_model,
    )

    if not isinstance(data, list):
        print(f"  ERROR: LLM returned non-array for {sid}", file=sys.stderr)
        return

    cleaned = []
    for i, card in enumerate(data):
        if not isinstance(card, dict):
            print(f"  WARN: card {i} is not an object, skipping", file=sys.stderr)
            continue
        missing = CARD_KEYS - set(card.keys())
        if missing:
            print(f"  WARN: card {i} missing {sorted(missing)}, skipping", file=sys.stderr)
            continue
        if card["difficulty"] not in VALID_DIFFICULTY:
            card["difficulty"] = "medium"
        cleaned.append(card)

    out = REPO_ROOT / "generated" / "flashcards" / f"{sid}_flashcards.json"
    write_json_atomic(out, cleaned)
    print(f"  wrote {out.relative_to(REPO_ROOT)} ({len(cleaned)} cards)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--section", help="generate only this section id")
    args = ap.parse_args()

    cfg = load_config()
    template = load_prompt("flashcard.prompt.md")
    sections = cfg.get("sections", [])
    if args.section:
        sections = [s for s in sections if s["id"] == args.section]
        if not sections:
            sys.exit(f"ERROR: section '{args.section}' not in course_config.json")

    for section in sections:
        print(f"▶ {section['id']} — {section['title']}")
        generate_one(section, cfg, template)


if __name__ == "__main__":
    main()
