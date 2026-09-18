# Jev · MECE Use-Case Map

Inspired, mobile-first showcase of TypeSafe **Jev** use cases from the first days on X — organized as a MECE taxonomy. Switchboard hero + sticky rail; all six pillars always expanded as a reference map.

**Live:** https://galigutta.github.io/jev-use-cases/

## Structure

Six mutually exclusive pillars (short names match the switchboard):

1. Workflow  
2. Bulk  
3. Realtime  
4. Verify  
5. Harness  
6. Voice (turn-taking, speak-up, voice→action)  

Independent community compilation — **not affiliated with TypeSafe AI**.

## Propose a use case

Anyone can suggest a new leaf. Static GitHub Pages **cannot** hold API keys — grading and PR drafting run in GitHub Actions.

### Flow

1. **Site or issue** — Use the **Propose a use case** panel on the live map (or open the [Propose use case](https://github.com/galigutta/jev-use-cases/issues/new?template=propose_use_case.yml) issue form). The browser only opens a GitHub **new issue** with title `[propose] …` and your text/URL (optional label `propose`).
2. **Jev grades** — Workflow `.github/workflows/propose-use-case.yml` extracts the current leaves from `docs/index.html`, then calls TypeSafe Jev (`POST https://api.typesafe.ai/v1/systemone`) to decide novelty, pillar, and overlap.
3. **If duplicate** — The Action comments the verdict on the issue and stops.
4. **If novel** — Codex (`openai/codex-action`) edits `docs/index.html` to add one leaf under the chosen pillar, pushes `propose/<issue>` (or `propose/run-<id>`), opens a PR, and comments the PR link on the issue.

```
You → GitHub issue [propose]
        ↓
   extract_use_cases.py
        ↓
   grade_novelty.py  (TYPESAFE_API_KEY → Jev)
        ↓
   novel? ──no──► comment + stop
        │ yes
        ↓
   build_codex_prompt.py
        ↓
   openai/codex-action  (OPENAI_API_KEY)
        ↓
   commit · push · gh pr create · comment
```

### Required repository secrets

Set these under **Settings → Secrets and variables → Actions** (never in `docs/`):

| Secret | Used by | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | `scripts/grade_novelty.py` | TypeSafe Jev System One API |
| `OPENAI_API_KEY` | `openai/codex-action@v1` | Codex leaf authoring |

`GITHUB_TOKEN` (automatic) is enough to push a branch and open a PR on this public repo.

### Manual / dispatch triggers

- **Issue** opened or labeled with `propose`, or title starting with `[propose]`
- **workflow_dispatch** inputs: `proposal`, optional `source_url`
- **repository_dispatch** type `propose_use_case` with `client_payload.proposal` / `.source_url`

## Scripts

```bash
python3 scripts/extract_use_cases.py --out use_cases.json
TYPESAFE_API_KEY=… python3 scripts/grade_novelty.py \
  --proposal "…" --source-url "…" --inventory use_cases.json --out novelty.json
python3 scripts/build_codex_prompt.py --novelty novelty.json --out codex-prompt.md
```

## Local

Open `docs/index.html` in a browser, or:

```bash
npx serve docs
```

## Pages

GitHub Pages serves from `/docs` on `main`.
