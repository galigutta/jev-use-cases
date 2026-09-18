#!/usr/bin/env python3
"""Build a Codex prompt from novelty.json + proposal text."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


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
    answers = data.get("answers") or {}
    pillar = ((answers.get("pillar") or {}).get("choice")) or "workflow"
    noul = (answers.get("is_novel") or {}).get("noul")
    novelty_score = (answers.get("novelty_score") or {}).get("score")
    overlap = answers.get("overlap") or {}

    issue_line = ""
    if args.issue_number:
        issue_line = f"- GitHub issue: #{args.issue_number}"
        if args.issue_url:
            issue_line += f" ({args.issue_url})"
        issue_line += "\n"

    prompt = f"""# Task: add one novel Jev use-case leaf to the MECE map

You are editing the community Jev use-case map repo. Implement a **commit-ready** change.

## Hard constraints
- Edit **`docs/index.html` only** (and `docs/styles.css` / `docs/app.js` only if strictly required for an existing pattern — almost never needed).
- **Never add a new pillar.** The six pillars are fixed: workflow, bulk, realtime, verify, harness, voice.
- Keep the taxonomy **MECE**: one leaf under the chosen pillar; do not duplicate nearby leaves.
- Match existing leaf HTML patterns inside `#pillar-{pillar} > ul.leaves`:
  - Linked demos/repos/handles → `<li>` with `<span class="leaf-primary">…</span>` + `<span class="leaf-meta">` containing `<a href="…" rel="noopener">…</a>`.
  - Conceptual / no public demo → include a `why` blurb button + `.blurb-panel` like the Voice pillar examples (unique `id`s).
- **Do not invent sources.** Only link URLs or handles explicitly present in the proposal or source URL below. If none, use a conceptual blurb, not fake links.
- Preserve the dark design system, existing markup, and indentation style.
- Do not touch README, workflows, scripts, or unrelated sections.

## Jev grading context
- Chosen pillar: **{pillar}**
- Novelty noul (is_novel): {noul}
- Novelty score: {novelty_score}
- Closest overlap: {overlap.get("choice")} — {overlap.get("leaf_text") or "n/a"}
{issue_line}
## Proposal
```
{proposal}
```

## Source URL
{source_url or "(none)"}

## Deliverable
1. Add exactly **one** new `<li>` leaf under `article#pillar-{pillar}` / `ul.leaves`.
2. Wording: concise leaf title in the same voice as siblings; include handles/repos from the proposal when present.
3. Leave the rest of the page unchanged.
4. Ensure the HTML remains valid and the leaf sits in a sensible place in the list (often near related leaves, or at the end of the pillar).

When done, leave the working tree with your edits ready to commit (Codex may write files directly).
"""

    args.out.write_text(prompt, encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
