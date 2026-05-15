"""Shared utilities for the course-study skeleton.

Reads course_config.json, context files, prompt templates, and exposes a
provider-agnostic call_llm() that dispatches to OpenRouter (default) or
Anthropic based on the configured provider.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Load .env from the repo root if python-dotenv is available, so API keys
# (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, REDUCTO_API_KEY, …) don't need to
# be exported manually in every shell.
try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass


def load_config() -> dict:
    p = REPO_ROOT / "course_config.json"
    if not p.exists():
        sys.exit(f"ERROR: missing {p}. Create it from the template in README.md.")
    return json.loads(p.read_text(encoding="utf-8"))


def load_context() -> dict:
    """Returns {course_description, exam_info, mal} as strings, blank if missing."""
    ctx_dir = REPO_ROOT / "context"

    def read(name: str) -> str:
        p = ctx_dir / name
        return p.read_text(encoding="utf-8") if p.exists() else ""

    return {
        "course_description": read("course_description.md"),
        "exam_info":          read("exam_info.txt"),
        "mal":                read("MAL.md"),
    }


def load_prompt(name: str) -> str:
    p = REPO_ROOT / "prompts" / name
    if not p.exists():
        sys.exit(f"ERROR: missing prompt template {p}")
    return p.read_text(encoding="utf-8")


def render(template: str, vars: dict) -> str:
    out = template
    for k, v in vars.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out


def write_json_atomic(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        nl = t.find("\n")
        t = t[nl + 1:] if nl != -1 else t[3:]
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


def call_llm(prompt: str, *, max_tokens: int = 8000) -> str:
    """Dispatch to the provider configured in course_config.json.

    Returns the model's text response with markdown fences stripped.
    """
    cfg = load_config().get("llm", {})
    provider = cfg.get("provider", "openrouter")
    model_override = os.environ.get("MODEL")

    if provider == "openrouter":
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            sys.exit("ERROR: OPENROUTER_API_KEY env var not set (provider=openrouter).")
        model = model_override or cfg.get(
            "openrouter_model", "google/gemma-4-26b-a4b-it:free"
        )
        import requests  # local import: only needed for this path
        r = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
            },
            timeout=180,
        )
        if not r.ok:
            sys.exit(f"ERROR: OpenRouter returned {r.status_code}: {r.text[:500]}")
        try:
            content = r.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as e:
            sys.exit(f"ERROR: unexpected OpenRouter response shape: {e}\n{r.text[:500]}")
        return _strip_fences(content)

    if provider == "anthropic":
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            sys.exit("ERROR: ANTHROPIC_API_KEY env var not set (provider=anthropic).")
        try:
            import anthropic
        except ImportError:
            sys.exit("ERROR: anthropic package not installed. Run: pip install anthropic")
        model = model_override or cfg.get("anthropic_model", "claude-sonnet-4-6")
        resp = anthropic.Anthropic(api_key=key).messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return _strip_fences(resp.content[0].text)

    sys.exit(f"ERROR: unknown llm.provider '{provider}' in course_config.json")


def call_llm_json(prompt: str, *, max_tokens: int = 8000):
    """call_llm + JSON parse with one retry on parse failure."""
    raw = call_llm(prompt, max_tokens=max_tokens)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        retry_prompt = (
            prompt
            + "\n\nYour previous response was not valid JSON (parse error: "
            + str(e)
            + "). Return ONLY the JSON object or array, no preamble, no markdown fences."
        )
        retry_raw = call_llm(retry_prompt, max_tokens=max_tokens)
        return json.loads(retry_raw)


def gather_source_text(section_id: str, *, max_chars: int | None = None) -> str:
    """Concatenate text from all parsed.json / *.parsed.json files in a section's
    resource folder. Returns empty string if nothing usable is found.

    Truncation cap resolution (first hit wins):
        1. `max_chars` argument passed by the caller
        2. SOURCE_MAX_CHARS env var
        3. `generation.source_max_chars` in course_config.json
        4. 80_000 fallback (safe for 8K-context free models)
    """
    if max_chars is None:
        env_val = os.environ.get("SOURCE_MAX_CHARS")
        if env_val:
            max_chars = int(env_val)
        else:
            gen = load_config().get("generation") or {}
            max_chars = int(gen.get("source_max_chars", 80_000))

    folder = REPO_ROOT / "resources" / section_id
    if not folder.exists():
        return ""

    parts: list[str] = []
    # Prefer user-provided parsed.json (e.g. Reducto output), then any *.parsed.json
    candidates = sorted(folder.glob("parsed.json")) + sorted(folder.glob("*.parsed.json"))
    seen = set()
    for path in candidates:
        if path.name in seen:
            continue
        seen.add(path.name)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  WARN: could not read {path}: {e}", file=sys.stderr)
            continue
        parts.append(_extract_text(data, source=path.name))

    full = "\n\n".join(p for p in parts if p)
    if len(full) > max_chars:
        print(
            f"  WARN: source text for {section_id} is {len(full)} chars; truncating to {max_chars}",
            file=sys.stderr,
        )
        full = full[:max_chars] + "\n\n[...truncated]"
    return full


def _extract_text(data, *, source: str) -> str:
    """Pull text out of a parsed.json. Handles several common shapes:
    - Reducto:    {"chunks": [{"embed": "...", "blocks": [...]}, ...]}
    - pdfplumber: {"pages":  [{"page": N, "text": "..."}, ...]}
    - generic:    {"text": "..."} or {"content": "..."}
    - bare list of strings, or bare string
    """
    header = f"\n\n=== {source} ===\n"
    if isinstance(data, str):
        return header + data
    if isinstance(data, list):
        return header + "\n\n".join(str(x) for x in data)
    if isinstance(data, dict):
        # Reducto: top-level "chunks" list. Each chunk has an "embed" field
        # (the embedding-optimised text) and/or a "blocks" list with raw content.
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
                    parts.append(str(txt).strip())
            if parts:
                return header + "\n\n".join(parts)
        if "pages" in data and isinstance(data["pages"], list):
            page_chunks = []
            for p in data["pages"]:
                if not isinstance(p, dict):
                    continue
                page_num = p.get("page", "?")
                txt = p.get("text") or p.get("content") or ""
                if txt:
                    page_chunks.append(f"--- page {page_num} ---\n{txt}")
            return header + "\n\n".join(page_chunks)
        for key in ("text", "content", "body"):
            if key in data and isinstance(data[key], str):
                return header + data[key]
    return ""
