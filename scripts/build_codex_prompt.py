#!/usr/bin/env python3
"""Build a Codex prompt from novelty.json + proposal text."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def slugify(text: str) -> str:
    s = re.sub(r"<[^>]+>", "", text).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s[:48].rstrip("-") or "leaf")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--novelty", type=Path, default=Path("novelty.json"))
    ap.add_argument("--out", type=Path, default=Path("codex-prompt.md"))
    ap.add_argument("--issue-number", default="")
    ap.add_argument("--issue-url", default="")
    args = ap.parse_args()

    if not args.novelty.is_file():
        print(f"error: missing {args.novelty}", file=sys.stderr)
        return 1

    data = json.loads(args.novelty.read_text(encoding="utf-8"))
    if not data.get("novel"):
        print("error: novelty.json verdict is not novel; refusing to build prompt", file=sys.stderr)
        return 1

    proposal = (data.get("proposal") or "").strip()
    source_url = (data.get("source_url") or "").strip()
    note = (data.get("note") or "").strip()
    answers = data.get("answers") or {}
    pillar = ((answers.get("pillar") or {}).get("choice")) or data.get("pillar") or "workflow"
    if pillar not in ("workflow", "bulk", "realtime", "verify", "harness", "voice"):
        pillar = "workflow"
    noul = (answers.get("is_novel") or {}).get("noul")
    novelty_score = (answers.get("novelty_score") or {}).get("score")
    overlap = answers.get("overlap") or {}
    accepted_via = data.get("accepted_via") or ""

    # Prefer human title text for the suggested leaf id (not the boilerplate URL line).
    lines = [ln.strip() for ln in proposal.splitlines() if ln.strip()]
    seed = note
    if not seed:
        for ln in lines:
            if ln.lower().startswith("use case proposed via link"):
                continue
            if ln.startswith("http://") or ln.startswith("https://"):
                continue
            seed = ln
            break
    if not seed and source_url:
        # last path segment of URL as weak fallback
        seed = source_url.rstrip("/").rsplit("/", 1)[-1]
    seed = seed or "new-use-case"
    suggested_id = f"leaf-{pillar}-{slugify(seed)}"

    issue_line = ""
    if args.issue_number:
        issue_line = f"- GitHub issue: #{args.issue_number}"
        if args.issue_url:
            issue_line += f" ({args.issue_url})"
        issue_line += "\n"

    link_hint = source_url or "(none — use a conceptual blurb pattern, do not invent URLs)"

    prompt = f"""# Task: add one novel Jev use-case leaf to the MECE map

You are editing the community Jev use-case map. Make a **minimal, commit-ready** HTML edit.

## Hard constraints
- Edit **`docs/index.html` only**. Do not touch README, workflows, scripts, CSS, or JS.
- **Never add a new pillar.** Pillars are fixed: workflow, bulk, realtime, verify, harness, voice.
- Add the leaf under **`article#pillar-{pillar}` → `ul.leaves`**.
- **Do not invent sources.** Only link URLs/handles present in the proposal or Source URL. If there is a Source URL, prefer a simple linked leaf (no fake “why” blurbs).
- Preserve indentation (2 spaces), existing classes, and design. Do not reformat the file.
- CI regenerates `docs/use_cases.json` after you finish — you must still set a correct **`id`** on the `<li>` so the inventory can deep-link.

## Required HTML shape (copy this pattern)

When there is a public link (preferred):

```html
            <li id="{suggested_id}">
              <span class="leaf-primary">Short title — optional clause</span>
              <span class="leaf-meta">
                <a href="SOURCE_URL" rel="noopener">label</a>
              </span>
            </li>
```

Rules for that pattern:
- `id` must be unique, start with `leaf-{pillar}-`, kebab-case, no spaces.
- `leaf-primary` is **plain text only** (you may wrap a short lead phrase in `<strong>…</strong>` like Voice siblings). Do **not** put buttons, panels, or links inside `leaf-primary`.
- Put every `<a>` inside `leaf-meta`, each with `rel="noopener"`.
- Insert before `</ul>` of that pillar (or next to the closest related leaf). Do not nest inside another `<li>`.

Only if there is **no** usable URL, use the conceptual Voice-style blurb (unique blurb ids):

```html
            <li id="{suggested_id}">
              <span class="leaf-primary">
                <strong>Short title</strong> — clause
                <button type="button" class="blurb" aria-expanded="false" aria-controls="blurb-YOUR_SLUG" id="blurb-btn-YOUR_SLUG">why</button>
              </span>
              <div class="blurb-panel" id="blurb-YOUR_SLUG" hidden>
                One or two sentences grounded in the proposal. No invented facts.
              </div>
            </li>
```

## Jev grading context
- Chosen pillar: **{pillar}** (do not change this)
- accepted_via: {accepted_via or "n/a"}
- Novelty noul (is_novel): {noul}
- Novelty score: {novelty_score}
- Closest overlap: {overlap.get("choice")} — {overlap.get("leaf_text") or "n/a"}
{issue_line}
## Proposal
```
{proposal}
```

## Source URL
{link_hint}

## Deliverable checklist
1. Exactly **one** new `<li>` under `#pillar-{pillar} ul.leaves`.
2. Valid `id` on that `<li>` (suggested: `{suggested_id}` — change the slug if needed for uniqueness/clarity).
3. Concise title in the same voice as sibling leaves.
4. Links only from the proposal/source; labels short (`@handle`, repo name, `live demo`, etc.).
5. No other edits. Leave the working tree ready to commit.
"""

    args.out.write_text(prompt, encoding="utf-8")
    print(f"wrote {args.out} pillar={pillar} suggested_id={suggested_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
