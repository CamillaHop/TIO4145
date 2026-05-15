"""Parse PDFs via Reducto (https://reducto.ai).

Per PDF, writes two files NEXT TO the source:
    <basename>.reducto.json  — Reducto's response/metafile (small; URL + status)
    <basename>.parsed.json   — the parsed content (what the rest of the
                               pipeline reads via gather_source_text)

The two-step caching means a re-run can re-fetch the parsed content from
Reducto's URL without paying for another parse if the metafile is fresh.

Usage
-----
    python scripts/parse_with_reducto.py                 # uses reducto.documents in config
    python scripts/parse_with_reducto.py --doc PATH      # one file
    python scripts/parse_with_reducto.py --all           # walk every PDF under resources/
    python scripts/parse_with_reducto.py --force         # ignore caches and re-parse

Requires
--------
    pip install reducto python-dotenv requests
    REDUCTO_API_KEY in env (or .env)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# ════════════════════════════════════════════════════════════════════════════
#  CONFIG — edit these to taste. See https://docs.reducto.ai/api-reference/
#  for the full set of knobs each section accepts.
#
#  The defaults below are tuned for the user's case: a math-heavy textbook
#  where information preservation matters more than chunk economy. Tradeoffs:
#    - Larger chunks keep proofs / derivations / theorem-statement-+-proof
#      pairs intact at the cost of less precise retrieval.
#    - "hybrid" extraction uses the embedded PDF text alongside OCR — for
#      math, this is the single most important setting: glyphs that the
#      PDF already encodes as text (e.g. LaTeX-rendered equations) survive
#      verbatim instead of being re-recognised from pixels.
# ════════════════════════════════════════════════════════════════════════════

# Chunking (retrieval.chunking) ---------------------------------------------

# Available modes (per Reducto docs):
#   "variable"      → layout-aware breakpoints around ~chunk_size chars (RECOMMENDED for RAG)
#   "section"       → align to section headers (best for chapter PDFs with clear structure)
#   "page_sections" → page-then-section (finer; good when sections span pages)
#   "page"          → one chunk per page
#   "block"         → one chunk per layout block (finest granularity)
#   "disabled"      → no chunking, full doc as one chunk
REDUCTO_CHUNK_MODE = "variable"

# Approximate **characters** per chunk (not words). Default range 250–1500.
# 1500 = generous; keeps most proofs in a single chunk. Lower to ~800 if
# you want more precise retrieval at the cost of occasional mid-proof splits.
REDUCTO_CHUNK_SIZE = 1500

# Characters of overlap between adjacent chunks. ~10–15% of chunk_size is
# the usual sweet spot — preserves context across chunk boundaries.
REDUCTO_CHUNK_OVERLAP = 200

# Optimise chunks for downstream embedding/retrieval (combines block content
# with a clean "embed" field per chunk). Recommended on.
REDUCTO_EMBEDDING_OPTIMIZED = True

# Extraction / OCR (settings.*) ----------------------------------------------

# "hybrid" merges OCR with the PDF's already-embedded text — strongly
# preferred for math/equations. Use "ocr" only for scans without text layers.
REDUCTO_EXTRACTION_MODE = "hybrid"

# "standard" handles multilingual; "legacy" is tuned for Germanic languages.
REDUCTO_OCR_SYSTEM = "standard"

# Enhancements (enhance.*) ---------------------------------------------------

# Generate text descriptions of figures so the chunk text contains the
# figure's content (otherwise figures are just bbox refs). Big quality win
# for textbooks where diagrams carry information.
REDUCTO_SUMMARIZE_FIGURES = True

# Timeouts -------------------------------------------------------------------

# Seconds to wait for a single parse. Textbooks legitimately need minutes.
REDUCTO_TIMEOUT_S = 60000

# Catch-all overrides --------------------------------------------------------
# Anything you want to pass through that isn't surfaced as a named knob
# above. Merged INTO the respective dict at call time, so e.g. you can add:
#   REDUCTO_RETRIEVAL_EXTRA = {"filter_blocks": ["Page Number", "Footer"]}
REDUCTO_RETRIEVAL_EXTRA: dict[str, Any] = {}
REDUCTO_SETTINGS_EXTRA:  dict[str, Any] = {}
REDUCTO_ENHANCE_EXTRA:   dict[str, Any] = {}

# ════════════════════════════════════════════════════════════════════════════

from config_loader import REPO_ROOT, load_config, write_json_atomic  # noqa: E402


# ─────────────────────── Param builders ────────────────────────────────────

def _retrieval_param() -> dict:
    return {
        "chunking": {
            "chunk_mode":    REDUCTO_CHUNK_MODE,
            "chunk_size":    REDUCTO_CHUNK_SIZE,
            "chunk_overlap": REDUCTO_CHUNK_OVERLAP,
        },
        "embedding_optimized": REDUCTO_EMBEDDING_OPTIMIZED,
        **REDUCTO_RETRIEVAL_EXTRA,
    }


def _settings_param() -> dict:
    return {
        "extraction_mode": REDUCTO_EXTRACTION_MODE,
        "ocr_system":      REDUCTO_OCR_SYSTEM,
        **REDUCTO_SETTINGS_EXTRA,
    }


def _enhance_param() -> dict:
    return {
        "summarize_figures": REDUCTO_SUMMARIZE_FIGURES,
        **REDUCTO_ENHANCE_EXTRA,
    }


# ─────────────────────── Client + serialisation ────────────────────────────

def _get_client():
    try:
        from reducto import Reducto
    except ImportError:
        sys.exit("ERROR: reducto SDK not installed. Run: pip install reducto python-dotenv")
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass  # .env loading is optional
    if not os.environ.get("REDUCTO_API_KEY"):
        sys.exit("ERROR: REDUCTO_API_KEY not set in env (or .env).")
    return Reducto()


def _to_serializable(obj: Any) -> Any:
    """Convert SDK response objects to plain JSON-serialisable dicts."""
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):       # pydantic v2
        return obj.model_dump()
    if hasattr(obj, "dict"):             # pydantic v1
        return obj.dict()
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    if hasattr(obj, "json"):
        return json.loads(obj.json())
    return obj


# ─────────────────────── Reducto calls ─────────────────────────────────────

def parse_to_meta(pdf_path: Path, meta_path: Path, client) -> dict:
    """Upload + parse via Reducto. Writes the metafile and returns it."""
    print(f"    → uploading {pdf_path.name}")
    upload = client.upload(file=pdf_path)

    print(f"    → parsing  (chunk_mode={REDUCTO_CHUNK_MODE}, "
          f"chunk_size={REDUCTO_CHUNK_SIZE}, extraction={REDUCTO_EXTRACTION_MODE})")
    result = client.with_options(timeout=REDUCTO_TIMEOUT_S).parse.run(  # type: ignore[call-arg]
        input=upload,
        retrieval=_retrieval_param(),
        settings=_settings_param(),
        enhance=_enhance_param(),
    )
    meta = _to_serializable(result)
    write_json_atomic(meta_path, meta)
    return meta


def meta_to_parsed(meta: dict, parsed_path: Path) -> dict:
    """Resolve Reducto's metafile (URL or inline) to the parsed content.

    Reducto returns either an inline result (small docs) or a URL pointing
    at the hosted JSON (large docs). We handle both."""
    result = meta.get("result") if isinstance(meta, dict) else None

    if isinstance(result, dict) and result.get("chunks"):
        parsed = result  # inline
    else:
        url = None
        if isinstance(result, dict):
            url = result.get("url")
        url = url or (meta.get("result_url") if isinstance(meta, dict) else None)
        if not url:
            raise RuntimeError(
                "Reducto metafile has neither inline chunks nor a result URL. "
                "Inspect the metafile JSON; the API may have changed."
            )
        try:
            import requests
        except ImportError:
            sys.exit("ERROR: requests not installed. Run: pip install requests")
        print(f"    → fetching parsed content")
        resp = requests.get(url, timeout=300)
        resp.raise_for_status()
        parsed = resp.json()

    write_json_atomic(parsed_path, parsed)
    return parsed


# ─────────────────────── Orchestration ─────────────────────────────────────

def _needs_redo(pdf_path: Path, parsed_path: Path, force: bool) -> bool:
    if force or not parsed_path.exists():
        return True
    return parsed_path.stat().st_mtime < pdf_path.stat().st_mtime


def process_one(pdf_path: Path, *, force: bool, client) -> bool:
    """Returns True if a parse or fetch actually happened, False if skipped."""
    if not pdf_path.exists():
        print(f"  WARN: {pdf_path} does not exist, skipping", file=sys.stderr)
        return False

    meta_path   = pdf_path.parent / f"{pdf_path.stem}.reducto.json"
    parsed_path = pdf_path.parent / f"{pdf_path.stem}.parsed.json"
    rel         = pdf_path.relative_to(REPO_ROOT) if pdf_path.is_relative_to(REPO_ROOT) else pdf_path

    if not _needs_redo(pdf_path, parsed_path, force):
        print(f"  skip {rel} (up to date)")
        return False

    print(f"  parse {rel}")

    # Re-use the metafile if it's already there and the PDF hasn't changed.
    # This lets you re-run after a fetch failure without paying for another parse.
    if not force and meta_path.exists() and meta_path.stat().st_mtime >= pdf_path.stat().st_mtime:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        print(f"    → reusing metafile (parse already done)")
    else:
        meta = parse_to_meta(pdf_path, meta_path, client)

    parsed = meta_to_parsed(meta, parsed_path)

    n_chunks = len(parsed.get("chunks", [])) if isinstance(parsed.get("chunks"), list) else "?"
    out_rel  = parsed_path.relative_to(REPO_ROOT) if parsed_path.is_relative_to(REPO_ROOT) else parsed_path
    print(f"  wrote {out_rel}  ({n_chunks} chunks)")
    return True


def discover_pdfs(cfg: dict, args: argparse.Namespace) -> list[Path]:
    if args.doc:
        p = Path(args.doc)
        return [p if p.is_absolute() else REPO_ROOT / p]
    if args.all:
        return sorted((REPO_ROOT / "resources").rglob("*.pdf"))
    configured = (cfg.get("reducto") or {}).get("documents") or []
    if configured:
        return [Path(d) if Path(d).is_absolute() else REPO_ROOT / d for d in configured]
    return sorted((REPO_ROOT / "resources").rglob("*.pdf"))


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse PDFs via Reducto; output sits next to each source PDF.")
    ap.add_argument("--doc",   help="parse a single PDF (path relative to repo root or absolute)")
    ap.add_argument("--all",   action="store_true", help="walk every PDF under resources/ (ignores config list)")
    ap.add_argument("--force", action="store_true", help="re-parse even if .parsed.json is up to date")
    args = ap.parse_args()

    cfg  = load_config()
    pdfs = discover_pdfs(cfg, args)
    if not pdfs:
        sys.exit(
            "ERROR: no PDFs to parse. Either:\n"
            "  - list paths in course_config.json under reducto.documents\n"
            "  - pass --doc <path>\n"
            "  - pass --all to walk every PDF under resources/"
        )

    print(f"▶ {len(pdfs)} PDF(s) to consider")
    client = _get_client()

    parsed = 0
    failed: list[str] = []
    for p in pdfs:
        try:
            if process_one(p, force=args.force, client=client):
                parsed += 1
        except Exception as e:
            print(f"  ERROR on {p.name}: {e}", file=sys.stderr)
            failed.append(p.name)

    print(f"\nDone. Parsed {parsed}/{len(pdfs)}.")
    if failed:
        print(f"Failed: {len(failed)}")
        for n in failed:
            print(f"  - {n}")


if __name__ == "__main__":
    main()
