# Fable UX / IA review — Propose a use case

**Scope:** `#propose` on https://galigutta.github.io/jev-use-cases/#propose  
**Surfaces reviewed:** `docs/index.html` (propose section), `docs/app.js` (propose), `docs/styles.css` (propose*), Worker response shapes in `infra/propose-api/src/index.js`, pregrade path in `.github/workflows/propose-use-case.yml`, README propose section.  
**Reviewer stance:** sharp product design critic (“fable”) for a mobile-first public map.  
**Note on tooling:** Claude Code CLI (`/home/box/.local/bin/claude -p`) was attempted; auth/session hit **weekly limit** (`You've hit your weekly limit · resets 12am (UTC)`). This document is a rigorous fallback audit in the same format the CLI was asked to produce.

---

## (a) Verdict

**Ship it, then polish the microcopy and status chrome.** The architectural leap (in-request Jev grade → duplicate stays on-page with no GitHub noise; novel → `repository_dispatch` with `graded_by:propose-api`) is the right product move: fast, honest, and respectful of the map. The UI already stays on-page with Accepted / Already-on-the-map states, colored live banners, and a three-step explainer.

What’s holding it back is **language lag**: the how-it-works list, footer links, loading copy, and button idle/busy states still smell like the older “open an issue and poll GitHub” path. A mobile visitor who pastes a link, waits three seconds, and lands on “Already on the map” will get it — if the chrome around that moment matches the new reality. Right now the chrome is ~80% there; the last 20% is copy, a11y, and dead CSS.

**Overall grade:** B+ product / B UX. Confidence in the flow is high; confidence in first-time comprehension on a phone is medium until the fixes below land.

---

## (b) Ranked issues (severity)

### P0 — High (fix before more traffic)

1. **“See proposals” points at Issues, but the happy/sad paths no longer create issues.**  
   Worker duplicate → JSON only, `issue: null`. Novel → `repository_dispatch`, `issue: null`. The link under the status panel teaches the wrong mental model (“my proposal is an issue somewhere”). On mobile this is a dead-end after a successful or duplicate submit.

2. **Loading / Accepted copy under-sells timing and next action.**  
   “Checking with Jev…” is fine for 1–2s; for colder Workers / slow URL fetch it feels stuck. Accepted says a leaf is “being written and auto-merged” but never says *when to look* or that the map won’t update live. Users bounce or re-submit.

3. **Submit button has no busy affordance beyond `disabled`.**  
   No `aria-busy`, no label change, no `:disabled` style. On a dark card, a disabled pill can look identical to idle. Double-tap risk on mobile is real even with `disabled` if styles don’t communicate.

### P1 — Medium (comprehension / trust)

4. **How-it-works step 3 is accurate but dense; step 2 says “instantly” while the Worker may fetch + two-stage grade.**  
   Mobile readers skim. “Instantly” + a long compound sentence about auto-merge vs already-on-map fights the live banner that appears above it. After a verdict, the static list still competes visually with the result.

5. **Duplicate message hedges twice:** “Already on the map **(or too close to an existing leaf)**”.  
   Honest for the saturated novelty bar, but reads like the product is unsure. Prefer a primary line + optional overlap leaf as evidence.

6. **Accepted path never gets `html_url` from the Worker** (by design). Frontend correctly falls back to `/pulls`, but the word “Details” in the novel branch is dead code for the primary path — only the fallback “Watch the PR” runs. Fine functionally; copy should commit to “Watch the PR” / Actions, not pretend there is a per-proposal detail page.

7. **Stale mental model in code comments / README diagram.**  
   `app.js` still says `POST → create issue → poll`. README ASCII diagram is still issue-first. Not user-facing, but it will re-poison the next copy edit.

8. **Error messaging for URL fetch failure (HTTP 422)** surfaces raw Worker text (“Could not resolve content from URL: …”) inside a generic wrapper. Recoverable, but not teachable (private repo? bad X URL? paywall?).

### P2 — Low (polish / a11y / debt)

9. **Double `aria-live`:** `#propose-status` and `.propose__live` both polite-live. Screen readers may double-announce.

10. **Dead CSS:** `.propose__status.is-ready .propose__ready` — no `.propose__ready` node exists. `is-ready` only gates nothing useful.

11. **No focus move to the live region** after submit — keyboard / SR users must hunt for the result below the fold of the form actions.

12. **Hint vs lede redundancy:** lede already says paste a link; hint repeats “Link alone is enough.” Mobile height is precious under the taxonomy.

13. **Empty state** is only validation-on-submit; no idle empty illustration or example chips. Acceptable for v1; optional later.

14. **Overlap text** only escapes `<`; fine for current Worker strings, brittle if overlap ever includes `&` or quotes in HTML context.

---

## (c) Concrete copy / layout / flow fixes

### Copy (implement now)

| Spot | Current | Proposed |
| --- | --- | --- |
| Lede | “…if it’s truly new it **auto-merges** as a leaf.” | Keep spine; add expectation: “…if it’s truly new it **auto-merges** as a leaf (usually within a couple of minutes).” |
| Flow 1 | “You paste a link (and maybe a short note)” | “Paste a link — optional note if the link needs context” |
| Flow 2 | “Jev grades it instantly — status shows up here” | “Jev grades it here in a few seconds (no page hop)” |
| Flow 3 | Long compound | “**New** → leaf auto-merges onto the map. **Already covered** → you see the overlap; nothing is filed.” |
| Links row | “See proposals · Source” | “Open PRs · Source” (issues are fallback-only; don’t lead with them) |
| Hint | “Link alone is enough…” | “No account needed. Duplicates stay on this page.” |
| Loading | “Checking with Jev…” | “Checking with Jev — usually a few seconds…” |
| Button busy | “Submit proposal” (disabled) | “Checking…” + `aria-busy="true"` |
| Accepted | “Accepted — it’s new (→ pillar). A leaf is being written and **auto-merged** onto the map. Watch the PR” | “**Accepted** — new under *pillar*. A leaf is writing now and will **auto-merge** in a couple of minutes. Refresh the map after merge. [Watch PRs]” |
| Duplicate | “Already on the map (or too close…)” | “**Already on the map**” + if overlap: “Closest leaf: *…*” + “Nothing was filed.” |
| Empty | “Paste a link (or a short note).” | “Add a link or a short note to propose.” |
| Bad URL | “Link must be a valid http(s) URL.” | Keep (clear). |
| Soft fail | “Couldn’t submit from the page: …” | Keep wrapper; prefer Worker’s short `error` when present (already does). For resolve failures, prepend “We couldn’t read that link — ” |

### Layout / interaction (implement now)

- Keep status **above** the how-it-works list (already `prepend`) — good.
- When `.propose__live` is present with a terminal state (`ok` / `dup` / `info`), add `data-has-verdict` on `.propose__status` and visually de-emphasize `.propose__flow` (lower opacity / smaller) so the verdict owns the moment.
- Add `.propose__submit:disabled` styles (opacity + `cursor: not-allowed`, no hover lift).
- On result, `live.focus({ preventScroll: false })` after setting `tabindex="-1"` on the live region.
- Single live region: keep `aria-live` on `.propose__live`; drop duplicate from the outer `#propose-status` *or* reverse — prefer live on the dynamic node only.
- Remove dead `.propose__ready` rule; keep `is-ready` only if it still toggles something meaningful (e.g. spacing), or rename to `has-live`.

### Flow / IA (do not churn)

- Do **not** move Propose above Taxonomy — the map teaches the ontology; propose without context produces worse leaves. Nav-first “Propose” is enough.
- Do **not** change novelty thresholds or Worker grading math. Error-message UX only.
- Keep legacy `startWatching` poll path for any residual issue-shaped responses — dormant is fine; don’t delete in this pass unless tests cover it.

### Out of scope this pass

- Example URL chips / empty illustration  
- Toast + confetti on Accepted  
- Live map refresh of the new leaf without reload  
- Rewriting README ASCII diagram (nice-to-have follow-up)

---

## (d) What to keep

- **On-page verdict, no navigate-away** — correct for a static map.
- **Duplicate = no GitHub issue** — huge trust and spam win; say it in the hint.
- **Colored `data-state` banners** (`waiting` / `ok` / `dup` / `info`) — clear without icons.
- **URL-in-note salvage** (`looksLikeUrl`) — mobile paste UX win.
- **Optional note** labeled as optional — good.
- **Pillar echo on Accepted** (`→ pillar`) — teaches the MECE frame at the moment of success.
- **Overlap echo on Duplicate** — evidence, not a black box.
- **Eyebrow “Grow the map” + serif italic title** — on-brand with the rest of the page.
- **Worker in-request grade + `graded_by:propose-api` skip** — the right systems story; UX should simply narrate it.

---

## Implementation plan for this pass

High-confidence, low-risk only:

1. Update propose copy in `docs/index.html` (lede, flow, links, hint).  
2. Update loading / accepted / duplicate / empty strings + button busy label + `aria-busy` + focus in `docs/app.js`.  
3. Disabled button styles, verdict de-emphasis, live-region a11y, remove dead `.propose__ready` in `docs/styles.css`.  
4. Touch the stale propose comment in `app.js`.  
5. **Do not** touch Worker thresholds / packing / workflow novelty math.

