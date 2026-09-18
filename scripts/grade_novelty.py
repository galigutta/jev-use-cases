#!/usr/bin/env python3
"""Grade a proposed use case for novelty via TypeSafe Jev System One.

Two-stage (context-safe) grading:
  1) Pillar route — proposal + short URL snippet + pillar_definitions only.
  2) Novelty vs peers — packed pillar peers + short samples from other pillars.

Novelty bar is high and saturates with catalog size.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


API_URL = "https://api.typesafe.ai/v1/systemone"
PILLARS = ("workflow", "bulk", "realtime", "verify", "harness", "voice")

# High base thresholds; rise with catalog saturation.
BASE_NOUL_THRESHOLD = 0.78
BASE_SCORE_THRESHOLD = 2.7
NOUL_SAT_SPAN = 0.14  # → ~0.92 at 200 leaves
SCORE_SAT_SPAN = 0.8  # → ~3.5 at 200 leaves
SAT_START = 40
SAT_RANGE = 160  # full sat at n=200

OVERLAP_FORCE_DUP_CONF = 0.55
MAX_URL_SNIPPET = 1500
MAX_PEER_TEXT = 160
MAX_OTHER_TITLE = 100
OTHER_SAMPLES_PER_PILLAR = 3
MAX_OVERLAP_OPTIONS = 40
STATE_CHAR_BUDGET = 24_000  # ~6k tokens with headroom

PILLAR_DEFINITIONS = {
    "workflow": "Smart if-statements: classify/route/score/branch inside ordinary software",
    "bulk": "Cheap map-reduce judgment over large corpora",
    "realtime": "Action selection at game/UI/market clock rates",
    "verify": "Score/judge/gate prompts, traces, drafts, claims",
    "harness": "Agent loop load-balancer: tool/model/human routing",
    "voice": "Sub-second decisions on the audio path: turn-taking, speak-up, voice→action",
}

PILLAR_CRITERIA = {
    "workflow": "Smart workflow decisions / classify-route-score",
    "bulk": "Bulk map-reduce over data",
    "realtime": "Realtime control loops",
    "verify": "Verify & guardrails",
    "harness": "Agent harness engineering",
    "voice": "Voice / audio-path judgment",
}

STRICT_INSTRUCTIONS = (
    "The use-case map saturates as it grows: prefer rejecting rephrases, "
    "subsets, and 'same decision shape under a new noun.' "
    "Mark is_novel yes only for a distinct decision job not already present."
)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def saturation(n_leaves: int) -> float:
    return clamp((n_leaves - SAT_START) / SAT_RANGE, 0.0, 1.0)


def thresholds_for(n_leaves: int) -> tuple[float, float, float]:
    sat = saturation(n_leaves)
    noul_thr = BASE_NOUL_THRESHOLD + NOUL_SAT_SPAN * sat
    score_thr = BASE_SCORE_THRESHOLD + SCORE_SAT_SPAN * sat
    return sat, noul_thr, score_thr


MAX_URL_FETCH = 12_000  # fetch budget before Jev packing truncates


def _http_get(url: str, timeout: float = 15.0, accept: str = "*/*") -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; jev-use-cases-novelty-grader/1.1; +https://galigutta.github.io/jev-use-cases/)"
            ),
            "Accept": accept,
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(MAX_URL_FETCH * 2), (resp.headers.get("Content-Type") or "").lower()


def _strip_html(html: str) -> str:
    # Prefer OG / twitter meta when present
    metas: list[str] = []
    for prop in (
        r'property=["\']og:title["\']',
        r'property=["\']og:description["\']',
        r'name=["\']twitter:title["\']',
        r'name=["\']twitter:description["\']',
        r'name=["\']description["\']',
    ):
        m = re.search(
            rf"<meta[^>]+{prop}[^>]+content=[\"\']([^\"\']+)[\"\']|<meta[^>]+content=[\"\']([^\"\']+)[\"\'][^>]+{prop}",
            html,
            re.I,
        )
        if m:
            val = (m.group(1) or m.group(2) or "").strip()
            if val:
                metas.append(val)
    title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    if title_m:
        metas.insert(0, re.sub(r"\s+", " ", title_m.group(1)).strip())
    body = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    body = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", body)
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    body = re.sub(r"\s+", " ", body).strip()
    parts = []
    seen = set()
    for p in metas + ([body] if body else []):
        if p and p not in seen:
            seen.add(p)
            parts.append(p)
    return " — ".join(parts) if parts else body


def _x_status_id(url: str) -> str | None:
    m = re.search(
        r"(?:twitter|x)\.com/[^/]+/status(?:es)?/(\d+)",
        url,
        re.I,
    )
    return m.group(1) if m else None


def fetch_x_status(url: str) -> str | None:
    """Resolve X/Twitter posts via FxTwitter JSON (works when x.com HTML is blocked)."""
    sid = _x_status_id(url)
    if not sid:
        return None
    endpoints = [
        f"https://api.fxtwitter.com/status/{sid}",
        f"https://api.vxtwitter.com/Twitter/status/{sid}",
    ]
    for ep in endpoints:
        try:
            raw, ctype = _http_get(ep, accept="application/json")
            data = json.loads(raw.decode("utf-8", errors="replace"))
            # FxTwitter shapes vary: {tweet: {...}} or flat
            tweet = data.get("tweet") or data.get("status") or data
            if not isinstance(tweet, dict):
                continue
            author = (
                (tweet.get("author") or {}).get("screen_name")
                or tweet.get("user_screen_name")
                or tweet.get("author_screen_name")
                or ""
            )
            text = (
                tweet.get("text")
                or tweet.get("full_text")
                or (tweet.get("body") or {}).get("text")
                or ""
            )
            if not text and isinstance(data.get("text"), str):
                text = data["text"]
            text = re.sub(r"\s+", " ", str(text)).strip()
            if not text:
                continue
            handle = f"@{author} " if author else ""
            return f"{handle}{text}"[:MAX_URL_FETCH]
        except Exception as exc:  # noqa: BLE001
            print(f"warn: X fetch via {ep} failed ({exc})", file=sys.stderr)
    # oEmbed fallback
    try:
        oembed = (
            "https://publish.twitter.com/oembed?omit_script=true&url="
            + urllib.parse.quote(url, safe="")
        )
        raw, _ = _http_get(oembed, accept="application/json")
        data = json.loads(raw.decode("utf-8", errors="replace"))
        html = data.get("html") or ""
        author = data.get("author_name") or ""
        plain = _strip_html(html)
        if plain:
            return (f"{author}: {plain}" if author else plain)[:MAX_URL_FETCH]
    except Exception as exc:  # noqa: BLE001
        print(f"warn: X oEmbed failed ({exc})", file=sys.stderr)
    return None


def fetch_github_text(url: str) -> str | None:
    """Repo README or file blob via GitHub API / raw.githubusercontent.com."""
    m = re.match(
        r"https?://github\.com/([^/]+)/([^/#?]+)(?:/(tree|blob)/([^/]+)/?(.*))?/?$",
        url.strip(),
        re.I,
    )
    if not m:
        return None
    owner, repo, kind, ref, path = m.group(1), m.group(2).removesuffix(".git"), m.group(3), m.group(4), (m.group(5) or "").strip()
    try:
        if kind == "blob" and ref and path:
            raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}"
            raw, _ = _http_get(raw_url, accept="text/plain,*/*")
            text = raw.decode("utf-8", errors="replace")
            return re.sub(r"\s+", " ", text).strip()[:MAX_URL_FETCH]
        # default: README via API
        api = f"https://api.github.com/repos/{owner}/{repo}/readme"
        if ref:
            api += f"?ref={urllib.parse.quote(ref)}"
        headers = {
            "User-Agent": "jev-use-cases-novelty-grader/1.1",
            "Accept": "application/vnd.github.raw",
        }
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(api, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read(MAX_URL_FETCH * 2).decode("utf-8", errors="replace")
        return re.sub(r"\s+", " ", text).strip()[:MAX_URL_FETCH]
    except Exception as exc:  # noqa: BLE001
        print(f"warn: GitHub API/raw failed ({exc})", file=sys.stderr)
    # Last try: common README paths on raw.githubusercontent.com
    for branch in ("main", "master"):
        for readme in ("README.md", "Readme.md", "readme.md"):
            try:
                raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{readme}"
                raw, _ = _http_get(raw_url, accept="text/plain,*/*")
                text = raw.decode("utf-8", errors="replace")
                text = re.sub(r"\s+", " ", text).strip()
                if len(text) > 80:
                    return text[:MAX_URL_FETCH]
            except Exception:
                continue
    return None


def fetch_url_text(url: str, timeout: float = 15.0) -> str | None:
    """Resolve proposal links: X/Twitter, GitHub, then generic web HTML/text."""
    if not url or not re.match(r"^https?://", url, re.I):
        return None
    url = url.strip()

    if re.search(r"(?:twitter|x)\.com/", url, re.I):
        got = fetch_x_status(url)
        if got:
            return got
        # fall through to HTML attempt

    if re.search(r"github\.com/", url, re.I):
        got = fetch_github_text(url)
        if got:
            return got

    try:
        raw, ctype = _http_get(url, timeout=timeout)
        if "json" in ctype:
            try:
                data = json.loads(raw.decode("utf-8", errors="replace"))
                return json.dumps(data, ensure_ascii=False)[:MAX_URL_FETCH]
            except json.JSONDecodeError:
                pass
        text = raw.decode("utf-8", errors="replace")
        if "html" in ctype or "<html" in text[:500].lower() or b"<" in raw[:200]:
            text = _strip_html(text)
        else:
            text = re.sub(r"\s+", " ", text).strip()
        return text[:MAX_URL_FETCH] if text else None
    except Exception as exc:  # noqa: BLE001 — best-effort fetch
        print(f"warn: could not fetch URL ({exc})", file=sys.stderr)
        return None


def load_existing(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = data.get("use_cases") or data
    if not isinstance(cases, list):
        raise ValueError("use_cases.json missing use_cases list")
    out: list[dict] = []
    for c in cases:
        text = (c.get("text") or "").strip()
        if not text:
            continue
        out.append(
            {
                "pillar": c.get("pillar"),
                "text": text,
                # Keep index for stable leaf_XX mapping in packed state
                "_idx": len(out),
            }
        )
    return out


def truncate(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip())
    if len(s) <= n:
        return s
    return s[: max(0, n - 1)].rstrip() + "…"


def state_chars(state: dict) -> int:
    return len(json.dumps(state, ensure_ascii=False, separators=(",", ":")))


def call_jev(api_key: str, state: dict, questions: dict) -> dict:
    body = {
        "model": "jev-latest",
        "state": state,
        "questions": questions,
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
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        print(f"error: Jev API HTTP {exc.code}: {err_body[:800]}", file=sys.stderr)
        raise SystemExit(1) from exc
    except urllib.error.URLError as exc:
        print(f"error: Jev API request failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


def stage_pillar_route(
    api_key: str,
    proposal: str,
    source_url: str | None,
    url_snippet: str | None,
) -> tuple[dict, dict, int]:
    state: dict[str, Any] = {
        "proposal": proposal,
        "source_url": source_url or "",
        "pillar_definitions": PILLAR_DEFINITIONS,
        "instructions": (
            "Route this proposal to the single best MECE pillar. "
            "Do not assess novelty here."
        ),
    }
    if url_snippet:
        state["source_url_snippet"] = url_snippet[:MAX_URL_SNIPPET]

    chars = state_chars(state)
    print(f"stage1_pillar_route state_chars={chars}", file=sys.stderr)

    questions = {
        "pillar": {
            "type": "choice",
            "instructions": "Which MECE pillar should this use case live under?",
            "criteria": dict(PILLAR_CRITERIA),
        },
    }
    result = call_jev(api_key, state, questions)
    return result, state, chars


def pack_novelty_state(
    proposal: str,
    source_url: str | None,
    chosen_pillar: str,
    existing: list[dict],
) -> tuple[dict, list[dict], int]:
    """Build packed state for novelty grading; returns (state, peers_in_state, chars)."""
    peers = [e for e in existing if e.get("pillar") == chosen_pillar]
    # Prefer shorter / denser peers last when trimming — oldest-looking long leaves first out
    # (inventory order ≈ page order; longer texts are heavier)
    peers_packed = [
        {
            "id": f"leaf_{i:02d}",
            "pillar": p.get("pillar"),
            "text": truncate(p.get("text") or "", MAX_PEER_TEXT),
            "_orig_idx": p["_idx"],
            "_full_len": len(p.get("text") or ""),
        }
        for i, p in enumerate(peers)
    ]

    other_samples: dict[str, list[str]] = {}
    for pillar in PILLARS:
        if pillar == chosen_pillar:
            continue
        titles = sorted(
            (e.get("text") or "" for e in existing if e.get("pillar") == pillar),
            key=lambda t: (len(t), t),
        )
        other_samples[pillar] = [
            truncate(t, MAX_OTHER_TITLE) for t in titles[:OTHER_SAMPLES_PER_PILLAR] if t
        ]

    def build(peers_list: list[dict], others: dict[str, list[str]]) -> dict:
        return {
            "proposal": proposal,
            "source_url": source_url or "",
            "chosen_pillar": chosen_pillar,
            "existing_in_pillar": [
                {"id": p["id"], "text": p["text"]} for p in peers_list
            ],
            "other_pillar_samples": others,
            "instructions": STRICT_INSTRUCTIONS,
        }

    state = build(peers_packed, other_samples)
    chars = state_chars(state)

    # Cap: drop other samples first, then oldest-looking long leaves
    if chars > STATE_CHAR_BUDGET:
        # Trim other pillar samples gradually
        for _ in range(OTHER_SAMPLES_PER_PILLAR):
            if chars <= STATE_CHAR_BUDGET:
                break
            changed = False
            for pillar in list(other_samples.keys()):
                if other_samples[pillar]:
                    other_samples[pillar].pop()  # drop longest of the short list (last)
                    changed = True
            if not changed:
                break
            state = build(peers_packed, other_samples)
            chars = state_chars(state)

    if chars > STATE_CHAR_BUDGET and peers_packed:
        # Drop longest peers first (oldest-looking long leaves among heaviest)
        ordered = sorted(
            range(len(peers_packed)),
            key=lambda i: (-peers_packed[i]["_full_len"], i),
        )
        drop_order = list(ordered)
        keep = set(range(len(peers_packed)))
        while chars > STATE_CHAR_BUDGET and drop_order:
            idx = drop_order.pop(0)
            keep.discard(idx)
            trimmed = [peers_packed[i] for i in range(len(peers_packed)) if i in keep]
            # Re-id sequentially for overlap options
            for j, p in enumerate(trimmed):
                p["id"] = f"leaf_{j:02d}"
            state = build(trimmed, other_samples)
            chars = state_chars(state)
            peers_packed = trimmed

    # Cap overlap options at MAX_OVERLAP_OPTIONS
    if len(peers_packed) > MAX_OVERLAP_OPTIONS:
        peers_packed = peers_packed[:MAX_OVERLAP_OPTIONS]
        for j, p in enumerate(peers_packed):
            p["id"] = f"leaf_{j:02d}"
        state = build(peers_packed, other_samples)
        chars = state_chars(state)

    print(f"stage2_novelty state_chars={chars} peers={len(peers_packed)}", file=sys.stderr)
    return state, peers_packed, chars


def stage_novelty(
    api_key: str,
    state: dict,
    peers_packed: list[dict],
) -> dict:
    overlap_criteria: dict[str, str | None] = {
        "none": "No meaningful overlap with any listed leaf in this pillar"
    }
    for p in peers_packed[:MAX_OVERLAP_OPTIONS]:
        overlap_criteria[p["id"]] = f"[{state.get('chosen_pillar')}] {p['text']}"[:220]

    questions = {
        "is_novel": {
            "type": "noul",
            "instructions": (
                "Is this proposal a distinct decision job not already present? "
                "Yes only for a new leaf — reject rephrases, subsets, and the same "
                "decision shape under a new noun. The map saturates; prefer rejecting."
            ),
            "criteria": {
                "true": "Distinct new decision job; not a rephrase/subset/same-shape variant",
                "false": "Already covered, overlapping, subset, or only a wording/noun variant",
            },
        },
        "overlap": {
            "type": "choice",
            "instructions": (
                "Which existing leaf in this packed state is most similar? "
                "Choose none if no meaningful overlap."
            ),
            "criteria": overlap_criteria,
        },
        "novelty_score": {
            "type": "score",
            "instructions": (
                "How novel is this proposal relative to the existing map? "
                "Be strict: same decision shape under a new noun scores low."
            ),
            "criteria": [
                "0 Duplicate / already listed",
                "1 Minor variant / rephrase / same decision shape new noun",
                "2 Related but thin angle; likely reject under saturation",
                "3 Clearly new decision job under an existing pillar",
                "4 Highly novel / unexpected distinct decision job",
            ],
        },
    }
    return call_jev(api_key, state, questions)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--proposal",
        default="",
        help="Optional note (may be empty when --source-url is set)",
    )
    ap.add_argument(
        "--source-url",
        default="",
        help="Primary link to resolve (X, GitHub, web)",
    )
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

    note = (args.proposal or "").strip()
    source_url = (args.source_url or "").strip() or None

    # Bare URL pasted as the note → treat as source_url
    if not source_url and re.match(r"^https?://\S+$", note, re.I):
        source_url = note
        note = ""

    if not note and not source_url:
        print("error: provide a source URL and/or a short note", file=sys.stderr)
        return 1

    if not args.inventory.is_file():
        print(f"error: missing inventory {args.inventory}", file=sys.stderr)
        return 1

    existing = load_existing(args.inventory)
    n_leaves = len(existing)
    sat, noul_threshold, score_threshold = thresholds_for(n_leaves)

    url_text = fetch_url_text(source_url) if source_url else None
    if source_url and not url_text:
        print(f"error: could not resolve content from URL: {source_url}", file=sys.stderr)
        return 1

    url_snippet = url_text[:MAX_URL_SNIPPET] if url_text else None

    if note and url_text:
        proposal = f"{note}\n\n--- resolved from {source_url} ---\n{url_text}"
    elif url_text:
        proposal = f"Use case proposed via link {source_url}:\n\n{url_text}"
    else:
        proposal = note

    # --- Stage 1: pillar route ---
    pillar_result, pillar_state, pillar_chars = stage_pillar_route(
        api_key, proposal, source_url, url_snippet
    )
    pillar_answers = pillar_result.get("answers") or {}
    pillar_ans = pillar_answers.get("pillar") or {}
    pillar = pillar_ans.get("choice") if pillar_ans.get("choice") in PILLARS else "workflow"

    # --- Stage 2: novelty vs peers ---
    novelty_state, peers_packed, novelty_chars = pack_novelty_state(
        proposal, source_url, pillar, existing
    )
    novelty_result = stage_novelty(api_key, novelty_state, peers_packed)
    answers = novelty_result.get("answers") or {}
    is_novel_ans = answers.get("is_novel") or {}
    overlap_ans = answers.get("overlap") or {}
    novelty_ans = answers.get("novelty_score") or {}

    noul = float(is_novel_ans.get("noul") if is_novel_ans.get("noul") is not None else 0.0)
    raw_score = novelty_ans.get("score")
    try:
        novelty_score = float(raw_score) if raw_score is not None else 0.0
    except (TypeError, ValueError):
        novelty_score = 0.0

    overlap_choice = overlap_ans.get("choice") or "none"
    try:
        overlap_conf = float(overlap_ans.get("confidence")) if overlap_ans.get("confidence") is not None else 0.0
    except (TypeError, ValueError):
        overlap_conf = 0.0

    # Resolve overlap leaf text from packed peers
    overlap_text = None
    orig_idx = None
    if overlap_choice.startswith("leaf_"):
        try:
            idx = int(overlap_choice.split("_", 1)[1])
            if 0 <= idx < len(peers_packed):
                overlap_text = peers_packed[idx].get("text")
                orig_idx = peers_packed[idx].get("_orig_idx")
                # Prefer full text from inventory when available
                if isinstance(orig_idx, int) and 0 <= orig_idx < len(existing):
                    overlap_text = existing[orig_idx].get("text") or overlap_text
        except ValueError:
            pass

    # Novelty decision: dual threshold + overlap gate
    overlap_forces_dup = (
        overlap_choice != "none"
        and overlap_choice.startswith("leaf_")
        and overlap_conf >= OVERLAP_FORCE_DUP_CONF
    )
    overlap_ok = overlap_choice == "none" or overlap_conf < OVERLAP_FORCE_DUP_CONF
    # If Jev finds no closest leaf, it is not "already on the map" — add it.
    no_closest = overlap_choice == "none"
    clears_bar = (
        noul >= noul_threshold
        and novelty_score >= score_threshold
        and overlap_ok
        and not overlap_forces_dup
    )
    novel = no_closest or clears_bar
    accepted_via = (
        "no_closest_overlap"
        if no_closest and not clears_bar
        else ("clears_bar" if novel else None)
    )
    verdict = "novel" if novel else "duplicate"

    stages = {
        "pillar_route": {
            "state_chars": pillar_chars,
            "usage": pillar_result.get("usage"),
            "model": pillar_result.get("model"),
        },
        "novelty": {
            "state_chars": novelty_chars,
            "peers_in_state": len(peers_packed),
            "usage": novelty_result.get("usage"),
            "model": novelty_result.get("model"),
        },
    }

    out = {
        "verdict": verdict,
        "novel": novel,
        "accepted_via": accepted_via,
        "threshold": noul_threshold,
        "noul_threshold": noul_threshold,
        "score_threshold": score_threshold,
        "sat": sat,
        "n_leaves": n_leaves,
        "base_noul_threshold": BASE_NOUL_THRESHOLD,
        "base_score_threshold": BASE_SCORE_THRESHOLD,
        "overlap_force_dup_confidence": OVERLAP_FORCE_DUP_CONF,
        "proposal": proposal,
        "note": note,
        "source_url": source_url,
        "fetched_url": bool(url_text),
        "fetched_chars": len(url_text or ""),
        "state_chars": {
            "pillar_route": pillar_chars,
            "novelty": novelty_chars,
        },
        "stages": stages,
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
                "forced_duplicate": overlap_forces_dup,
                "type": "choice",
            },
            "novelty_score": {
                "score": novelty_score if raw_score is not None else novelty_ans.get("score"),
                "confidence": novelty_ans.get("confidence"),
                "legend": novelty_ans.get("legend"),
                "type": "score",
            },
        },
        "model": novelty_result.get("model") or pillar_result.get("model"),
        "usage": {
            "pillar_route": pillar_result.get("usage"),
            "novelty": novelty_result.get("usage"),
        },
        "confidence": {
            "pillar": pillar_ans.get("confidence"),
            "overlap": overlap_ans.get("confidence"),
            "novelty_score": novelty_ans.get("confidence"),
        },
        "decision": {
            "noul_pass": noul >= noul_threshold,
            "score_pass": novelty_score >= score_threshold,
            "overlap_ok": overlap_ok,
            "overlap_forces_dup": overlap_forces_dup,
        },
    }

    args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"wrote {args.out}: verdict={verdict} pillar={pillar} "
        f"is_novel.noul={noul:.3f} (thr={noul_threshold:.3f}) "
        f"score={novelty_score:.3f} (thr={score_threshold:.3f}) "
        f"sat={sat:.3f} n_leaves={n_leaves} "
        f"state_chars={{pillar:{pillar_chars},novelty:{novelty_chars}}}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
