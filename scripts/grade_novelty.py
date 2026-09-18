#!/usr/bin/env python3
"""Grade a proposed use case for novelty via TypeSafe Jev System One."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


API_URL = "https://api.typesafe.ai/v1/systemone"
NOVEL_THRESHOLD = 0.55
PILLARS = ("workflow", "bulk", "realtime", "verify", "harness", "voice")
MAX_EXISTING = 80
MAX_URL_CHARS = 6000


def fetch_url_text(url: str, timeout: float = 12.0) -> str | None:
    if not url or not re.match(r"^https?://", url, re.I):
        return None
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "jev-use-cases-novelty-grader/1.0",
            "Accept": "text/html,text/plain,*/*",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(MAX_URL_CHARS * 4)
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "html" in ctype or url.rstrip("/").endswith((".html", ".htm")) or b"<" in raw[:200]:
                text = raw.decode("utf-8", errors="replace")
                # crude strip tags
                text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
                text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
                text = re.sub(r"(?s)<[^>]+>", " ", text)
                text = re.sub(r"\s+", " ", text).strip()
            else:
                text = raw.decode("utf-8", errors="replace")
                text = re.sub(r"\s+", " ", text).strip()
            return text[:MAX_URL_CHARS] if text else None
    except Exception as exc:  # noqa: BLE001 — best-effort fetch
        print(f"warn: could not fetch URL ({exc})", file=sys.stderr)
        return None


def load_existing(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = data.get("use_cases") or data
    if not isinstance(cases, list):
        raise ValueError("use_cases.json missing use_cases list")
    slim: list[dict] = []
    for c in cases[:MAX_EXISTING]:
        slim.append(
            {
                "pillar": c.get("pillar"),
                "text": c.get("text"),
                "links": [l.get("href") for l in (c.get("links") or []) if l.get("href")],
            }
        )
    return slim


def call_jev(api_key: str, proposal: str, existing: list[dict], source_url: str | None) -> dict:
    # Build overlap choices from existing leaves (truncate labels for criteria keys)
    overlap_criteria: dict[str, str | None] = {"none": "No meaningful overlap with any listed leaf"}
    for i, leaf in enumerate(existing[:24]):
        key = f"leaf_{i:02d}"
        label = f"[{leaf.get('pillar')}] {leaf.get('text', '')}"[:220]
        overlap_criteria[key] = label

    state = {
        "proposal": proposal,
        "source_url": source_url or "",
        "existing_use_cases": existing,
        "pillar_definitions": {
            "workflow": "Smart if-statements: classify/route/score/branch inside ordinary software",
            "bulk": "Cheap map-reduce judgment over large corpora",
            "realtime": "Action selection at game/UI/market clock rates",
            "verify": "Score/judge/gate prompts, traces, drafts, claims",
            "harness": "Agent loop load-balancer: tool/model/human routing",
            "voice": "Sub-second decisions on the audio path: turn-taking, speak-up, voice→action",
        },
        "instructions": (
            "Decide whether the proposal is a meaningfully new Jev use-case leaf "
            "not already covered by existing_use_cases. Near-duplicates or minor "
            "rephrasings of an existing leaf are NOT novel."
        ),
    }

    body = {
        "model": "jev-latest",
        "state": state,
        "questions": {
            "is_novel": {
                "type": "noul",
                "instructions": (
                    "Is this proposal a meaningfully new use case not already covered "
                    "by existing_use_cases? Yes only if it adds a distinct leaf."
                ),
                "criteria": {
                    "true": "Distinct new leaf; not a rephrase or subset of an existing one",
                    "false": "Already covered, overlapping, or only a wording variant",
                },
            },
            "pillar": {
                "type": "choice",
                "instructions": "Which MECE pillar should this use case live under?",
                "criteria": {
                    "workflow": "Smart workflow decisions / classify-route-score",
                    "bulk": "Bulk map-reduce over data",
                    "realtime": "Realtime control loops",
                    "verify": "Verify & guardrails",
                    "harness": "Agent harness engineering",
                    "voice": "Voice / audio-path judgment",
                },
            },
            "overlap": {
                "type": "choice",
                "instructions": (
                    "Which existing leaf is most similar? Choose none if no meaningful overlap."
                ),
                "criteria": overlap_criteria,
            },
            "novelty_score": {
                "type": "score",
                "instructions": "How novel is this proposal relative to the existing map?",
                "criteria": [
                    "0 Duplicate / already listed",
                    "1 Minor variant of an existing leaf",
                    "2 Related but adds a useful angle",
                    "3 Clearly new leaf under an existing pillar",
                    "4 Highly novel / unexpected application",
                ],
            },
        },
    }

    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        print(f"error: Jev API HTTP {exc.code}: {err_body[:800]}", file=sys.stderr)
        raise SystemExit(1) from exc
    except urllib.error.URLError as exc:
        print(f"error: Jev API request failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--proposal", required=True, help="Proposed use-case text")
    ap.add_argument("--source-url", default="", help="Optional source URL")
    ap.add_argument(
        "--inventory",
        type=Path,
        default=Path("use_cases.json"),
        help="JSON from extract_use_cases.py",
    )
    ap.add_argument("--out", type=Path, default=Path("novelty.json"))
    args = ap.parse_args()

    api_key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not api_key:
        print("error: TYPESAFE_API_KEY is not set", file=sys.stderr)
        return 1

    proposal = args.proposal.strip()
    if not proposal:
        print("error: empty proposal", file=sys.stderr)
        return 1

    if not args.inventory.is_file():
        print(f"error: missing inventory {args.inventory}", file=sys.stderr)
        return 1

    existing = load_existing(args.inventory)
    source_url = (args.source_url or "").strip() or None
    url_text = fetch_url_text(source_url) if source_url else None
    if url_text:
        proposal_for_jev = (
            f"{proposal}\n\n--- fetched source_url content (truncated) ---\n{url_text}"
        )
    else:
        proposal_for_jev = proposal

    result = call_jev(api_key, proposal_for_jev, existing, source_url)
    answers = result.get("answers") or {}
    is_novel_ans = answers.get("is_novel") or {}
    pillar_ans = answers.get("pillar") or {}
    overlap_ans = answers.get("overlap") or {}
    novelty_ans = answers.get("novelty_score") or {}

    noul = float(is_novel_ans.get("noul") if is_novel_ans.get("noul") is not None else 0.0)
    pillar = pillar_ans.get("choice") if pillar_ans.get("choice") in PILLARS else "workflow"
    novel = noul >= NOVEL_THRESHOLD

    # Resolve overlap leaf text if leaf_XX
    overlap_choice = overlap_ans.get("choice") or "none"
    overlap_text = None
    if overlap_choice.startswith("leaf_"):
        try:
            idx = int(overlap_choice.split("_", 1)[1])
            if 0 <= idx < len(existing):
                overlap_text = existing[idx].get("text")
        except ValueError:
            pass

    verdict = "novel" if novel else "duplicate"

    out = {
        "verdict": verdict,
        "novel": novel,
        "threshold": NOVEL_THRESHOLD,
        "proposal": proposal,
        "source_url": source_url,
        "fetched_url": bool(url_text),
        "answers": {
            "is_novel": {
                "noul": noul,
                "type": "noul",
            },
            "pillar": {
                "choice": pillar,
                "confidence": pillar_ans.get("confidence"),
                "probabilities": pillar_ans.get("probabilities"),
                "type": "choice",
            },
            "overlap": {
                "choice": overlap_choice,
                "leaf_text": overlap_text,
                "confidence": overlap_ans.get("confidence"),
                "type": "choice",
            },
            "novelty_score": {
                "score": novelty_ans.get("score"),
                "confidence": novelty_ans.get("confidence"),
                "legend": novelty_ans.get("legend"),
                "type": "score",
            },
        },
        "model": result.get("model"),
        "usage": result.get("usage"),
        "confidence": {
            "pillar": pillar_ans.get("confidence"),
            "overlap": overlap_ans.get("confidence"),
            "novelty_score": novelty_ans.get("confidence"),
        },
    }

    args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"wrote {args.out}: verdict={verdict} pillar={pillar} "
        f"is_novel.noul={noul:.3f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
