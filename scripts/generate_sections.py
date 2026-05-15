"""Generate generated/sections/<section_id>.json for each section in
course_config.json. Reads source text from resources/<section_id>/ and the
section_content prompt template.

Usage:
    python scripts/generate_sections.py
    python scripts/generate_sections.py --section section_01
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from config_loader import (
    REPO_ROOT,
    call_llm_json,
    gather_source_text,
    load_config,
    load_context,
    load_prompt,
    render,
    write_json_atomic,
)

REQUIRED_KEYS = {"title", "summary", "key_concepts", "detailed_notes", "common_mistakes"}


def generate_one(section: dict, cfg: dict, ctx: dict, template: str) -> None:
    sid = section["id"]
    source_text = gather_source_text(sid)
    if not source_text.strip():
        print(
            f"  SKIP {sid}: no source material found in resources/{sid}/. "
            "Drop PDFs/PPTX/parsed.json there and rerun.",
            file=sys.stderr,
        )
        return

    prompt = render(
        template,
        {
            "course_name":         cfg["course_name"],
            "course_code":         cfg["course_code"],
            "course_description":  ctx["course_description"],
            "mal":                 ctx["mal"],
            "section_title":       section["title"],
            "section_description": section.get("description", ""),
            "source_text":         source_text,
        },
    )

    print(f"  calling LLM for {sid}…")
    data = call_llm_json(prompt, max_tokens=8000)

    if not isinstance(data, dict):
        print(f"  ERROR: LLM returned non-object for {sid}", file=sys.stderr)
        return
    missing = REQUIRED_KEYS - set(data.keys())
    if missing:
        print(f"  WARN: {sid} missing keys: {sorted(missing)}", file=sys.stderr)

    out = REPO_ROOT / "generated" / "sections" / f"{sid}.json"
    write_json_atomic(out, data)
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--section", help="generate only this section id")
    args = ap.parse_args()

    cfg = load_config()
    ctx = load_context()
    template = load_prompt("section_content.prompt.md")

    sections = cfg.get("sections", [])
    if args.section:
        sections = [s for s in sections if s["id"] == args.section]
        if not sections:
            sys.exit(f"ERROR: section '{args.section}' not in course_config.json")

    if not sections:
        sys.exit("ERROR: no sections configured in course_config.json")

    for section in sections:
        print(f"▶ {section['id']} — {section['title']}")
        generate_one(section, cfg, ctx, template)


if __name__ == "__main__":
    main()
