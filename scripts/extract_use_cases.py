#!/usr/bin/env python3
"""Parse docs/index.html leaves into a JSON inventory."""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


PILLARS = ("workflow", "bulk", "realtime", "verify", "harness", "voice")


class LeafExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.leaves: list[dict] = []
        self._pillar: str | None = None
        self._in_leaves = False
        self._in_li = False
        self._in_primary = False
        self._in_meta = False
        self._in_blurb_panel = False
        self._capture_text = False
        self._primary_parts: list[str] = []
        self._blurb_parts: list[str] = []
        self._links: list[dict[str, str]] = []
        self._skip_depth = 0  # inside button.blurb etc.

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {k: (v or "") for k, v in attrs}
        classes = set(attr.get("class", "").split())

        if tag == "article" and "pillar" in classes:
            self._pillar = attr.get("data-pillar") or None
            return

        if tag == "ul" and "leaves" in classes:
            self._in_leaves = True
            return

        if not self._in_leaves or self._pillar not in PILLARS:
            return

        if tag == "li":
            self._in_li = True
            self._primary_parts = []
            self._blurb_parts = []
            self._links = []
            self._in_primary = False
            self._in_meta = False
            self._in_blurb_panel = False
            self._skip_depth = 0
            return

        if not self._in_li:
            return

        if tag == "button" and "blurb" in classes:
            self._skip_depth += 1
            return

        if self._skip_depth:
            self._skip_depth += 1
            return

        if tag == "span" and "leaf-primary" in classes:
            self._in_primary = True
            self._capture_text = True
            return

        if tag == "span" and "leaf-meta" in classes:
            self._in_meta = True
            return

        if tag == "div" and "blurb-panel" in classes:
            self._in_blurb_panel = True
            self._capture_text = True
            return

        if tag == "a" and (self._in_meta or self._in_primary):
            href = attr.get("href", "").strip()
            # Start capturing link text
            self._link_href = href
            self._link_text_parts: list[str] = []
            self._in_link = True
            return

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth:
            self._skip_depth -= 1
            return

        if tag == "ul" and self._in_leaves:
            self._in_leaves = False
            return

        if tag == "article":
            self._pillar = None
            return

        if not self._in_li:
            return

        if tag == "span" and self._in_primary:
            self._in_primary = False
            self._capture_text = False
            return

        if tag == "span" and self._in_meta:
            self._in_meta = False
            return

        if tag == "div" and self._in_blurb_panel:
            self._in_blurb_panel = False
            self._capture_text = False
            return

        if tag == "a" and getattr(self, "_in_link", False):
            text = re.sub(r"\s+", " ", "".join(self._link_text_parts)).strip()
            href = getattr(self, "_link_href", "")
            if href:
                self._links.append({"text": text, "href": href})
            self._in_link = False
            return

        if tag == "li" and self._in_li:
            text = re.sub(r"\s+", " ", "".join(self._primary_parts)).strip()
            # Strip trailing "why" button residue if any
            text = re.sub(r"\s+why\s*$", "", text, flags=re.I).strip()
            blurb = re.sub(r"\s+", " ", "".join(self._blurb_parts)).strip()
            if text and self._pillar:
                entry: dict = {
                    "pillar": self._pillar,
                    "text": text,
                    "links": self._links,
                }
                if blurb:
                    entry["blurb"] = blurb
                self.leaves.append(entry)
            self._in_li = False
            return

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if getattr(self, "_in_link", False):
            self._link_text_parts.append(data)
            return
        if self._in_primary and self._capture_text:
            self._primary_parts.append(data)
        elif self._in_blurb_panel and self._capture_text:
            self._blurb_parts.append(data)


def extract(html_path: Path) -> list[dict]:
    parser = LeafExtractor()
    parser.feed(html_path.read_text(encoding="utf-8"))
    return parser.leaves


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--html",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "docs" / "index.html",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("use_cases.json"),
    )
    args = ap.parse_args()

    if not args.html.is_file():
        print(f"error: missing {args.html}", file=sys.stderr)
        return 1

    leaves = extract(args.html)
    payload = {
        "count": len(leaves),
        "pillars": list(PILLARS),
        "use_cases": leaves,
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(leaves)} leaves)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
