#!/usr/bin/env python3
"""Ensure every leaf <li> in docs/index.html has a stable leaf-* id."""
from __future__ import annotations

import argparse
import re
from pathlib import Path


def slugify(text: str) -> str:
    s = re.sub(r"<[^>]+>", "", text).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s[:48].rstrip("-") or "leaf")


def ensure(html: str) -> str:
    pattern = re.compile(
        r'(<article\b[^>]*\bclass="[^"]*\bpillar\b[^"]*"[^>]*data-pillar="([^"]+)"[^>]*>)([\s\S]*?)(</article>)',
        re.I,
    )
    out: list[str] = []
    last = 0
    for m in pattern.finditer(html):
        out.append(html[last : m.start()])
        open_tag, pillar, body, close = m.group(1), m.group(2), m.group(3), m.group(4)
        used = set(re.findall(r'id="(leaf-[^"]+)"', body))

        def repl(mm, pillar=pillar, used=used):
            rest = mm.group(1)
            pm = re.match(r'\s*<span class="leaf-primary">([\s\S]*?)</span>', rest)
            primary = pm.group(1) if pm else pillar
            base = slugify(primary)
            leaf_id = f"leaf-{pillar}-{base}"
            i = 2
            while leaf_id in used:
                leaf_id = f"leaf-{pillar}-{base}-{i}"
                i += 1
            used.add(leaf_id)
            return '<li id="%s">%s' % (leaf_id, rest)

        body2 = re.sub(r'<li>(\s*<span class="leaf-primary"[\s\S]*?</li>)', repl, body)
        out.append(open_tag + body2 + close)
        last = m.end()
    out.append(html[last:])
    return "".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--html", type=Path, default=Path("docs/index.html"))
    args = ap.parse_args()
    before = args.html.read_text(encoding="utf-8")
    after = ensure(before)
    if after != before:
        args.html.write_text(after, encoding="utf-8")
        print(f"updated {args.html}")
    else:
        print(f"no bare leaves in {args.html}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
