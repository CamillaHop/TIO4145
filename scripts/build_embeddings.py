"""Build generated/chat/chunks.json from parsed.json files in resources/.

Only runs when features.chat.enabled is true in course_config.json. Reads
every parsed.json / *.parsed.json across all section folders, slices the text
into 500-word windows tagged with section_id, embeds each chunk via OpenRouter,
and writes generated/chat/chunks.json — the retrieval index used by
api/chat.js at request time.

Env vars
--------
    OPENROUTER_API_KEY    required (unless NOE_DRY_RUN=1)
    CHUNK_SIZE            default 500 words
    NOE_DRY_RUN=1         skip embeddings; write empty embedding arrays
    NOE_MAX_CHUNKS        cap total chunks for smoke tests
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from config_loader import REPO_ROOT, load_config, write_json_atomic

CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "500"))


def collect_chunks(cfg: dict) -> list[dict]:
    """Walk every section folder, pull out text from parsed.json files, slice
    into 500-word windows tagged with section_id + source filename."""
    chunks: list[dict] = []
    for section in cfg.get("sections", []):
        sid = section["id"]
        folder = REPO_ROOT / "resources" / sid
        if not folder.exists():
            continue
        # User-provided parsed.json gets precedence; then auto-parsed files
        for path in sorted(folder.glob("parsed.json")) + sorted(folder.glob("*.parsed.json")):
            text = _read_text(path)
            if not text:
                continue
            label = f"{sid} — {path.name}"
            words = text.split()
            for i in range(0, len(words), CHUNK_SIZE):
                window = words[i : i + CHUNK_SIZE]
                if not window:
                    continue
                chunks.append({
                    "id":         f"{sid}-{path.stem}-{len(chunks)}",
                    "text":       " ".join(window),
                    "section_id": sid,
                    "source":     path.name,
                    "chapter":    label,  # kept under "chapter" for compatibility with api/chat.js
                })
    return chunks


def _read_text(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  WARN: could not read {path}: {e}", file=sys.stderr)
        return ""
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        return "\n\n".join(str(x) for x in data)
    if isinstance(data, dict):
        # Reducto chunks
        if "chunks" in data and isinstance(data["chunks"], list):
            parts: list[str] = []
            for c in data["chunks"]:
                if not isinstance(c, dict):
                    continue
                txt = c.get("embed") or c.get("content") or c.get("text") or ""
                if not txt and isinstance(c.get("blocks"), list):
                    block_parts: list[str] = []
                    for b in c["blocks"]:
                        if isinstance(b, dict):
                            bt = b.get("content") or b.get("text") or b.get("markdown") or ""
                            if bt:
                                block_parts.append(str(bt))
                    txt = "\n".join(block_parts)
                if txt:
                    parts.append(str(txt))
            if parts:
                return "\n\n".join(parts)
        # pdfplumber pages
        if "pages" in data and isinstance(data["pages"], list):
            parts = []
            for p in data["pages"]:
                if isinstance(p, dict):
                    txt = p.get("text") or p.get("content") or ""
                    if txt:
                        parts.append(txt)
            return "\n\n".join(parts)
        for key in ("text", "content", "body"):
            if key in data and isinstance(data[key], str):
                return data[key]
    return ""


def embed_with_retry(client, text: str, model: str, *, attempts: int = 4) -> list[float]:
    """Linear-backoff retry around the embeddings endpoint. Free-tier models on
    OpenRouter rate-limit aggressively, so retries are non-optional."""
    last_err = None
    for attempt in range(attempts):
        try:
            resp = client.embeddings.create(
                model=model,
                input=[text],
                encoding_format="float",
            )
            return resp.data[0].embedding
        except Exception as e:  # network/HTTP errors vary by SDK version
            last_err = e
            wait = 2 ** attempt  # 1, 2, 4, 8 s
            print(
                f"      embed retry {attempt + 1}/{attempts} "
                f"({type(e).__name__}: {e}); waiting {wait}s",
                file=sys.stderr,
            )
            time.sleep(wait)
    raise RuntimeError(f"embedding failed after {attempts} attempts: {last_err}")


def progress(i: int, total: int, label: str, every: int = 25) -> None:
    if (i + 1) % every == 0 or i + 1 == total:
        pct = 100.0 * (i + 1) / total
        print(f"  [{i + 1:>5}/{total}] {pct:5.1f}%  {label[:60]}")


def main() -> None:
    cfg = load_config()
    chat_cfg = cfg.get("features", {}).get("chat", {})
    if not chat_cfg.get("enabled"):
        print("Chat is not enabled (features.chat.enabled = false). Nothing to do.")
        return

    embed_model = chat_cfg.get("embed_model", "nvidia/llama-nemotron-embed-vl-1b-v2:free")
    dry_run = os.environ.get("NOE_DRY_RUN") == "1"
    api_key = os.environ.get("OPENROUTER_API_KEY")

    if not api_key and not dry_run:
        sys.exit(
            "ERROR: OPENROUTER_API_KEY not set. Either export it, or run with "
            "NOE_DRY_RUN=1 to build chunks.json without embeddings."
        )

    print("Collecting chunks from resources/…")
    chunks = collect_chunks(cfg)
    if not chunks:
        sys.exit(
            "ERROR: no chunks built. Add parsed.json files to resources/<section_id>/ "
            "first (run scripts/parse_resources.py)."
        )
    print(f"  {len(chunks)} chunks total")

    cap = os.environ.get("NOE_MAX_CHUNKS")
    if cap:
        chunks = chunks[: int(cap)]
        print(f"  NOE_MAX_CHUNKS={cap} — capped to {len(chunks)} chunks")

    if dry_run:
        print("\nNOE_DRY_RUN=1 — skipping embeddings")
        for c in chunks:
            c["embedding"] = []
    else:
        try:
            import openai
        except ImportError:
            sys.exit("ERROR: openai package not installed. Run: pip install openai")
        client = openai.OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        print(f"\nEmbedding {len(chunks)} chunks with {embed_model}…")
        for i, c in enumerate(chunks):
            c["embedding"] = embed_with_retry(client, c["text"], embed_model)
            progress(i, len(chunks), c["chapter"])

    out = REPO_ROOT / "generated" / "chat" / "chunks.json"
    write_json_atomic(out, chunks)
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"\n✅ wrote {out.relative_to(REPO_ROOT)} — {len(chunks)} chunks, {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
