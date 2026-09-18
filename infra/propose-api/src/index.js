/**
 * On-page propose API — grades with Jev in-request (instant), then opens the GitHub issue.
 * POST { url?, note? } → { number, html_url, title, novel, verdict, pillar, overlap, noul, ... }
 */
const REPO = "galigutta/jev-use-cases";
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const INVENTORY_URL =
  "https://raw.githubusercontent.com/galigutta/jev-use-cases/main/docs/use_cases.json";
const SITE = "https://galigutta.github.io/jev-use-cases/";

const PILLARS = ["workflow", "bulk", "realtime", "verify", "harness", "voice"];
const PILLAR_DEFINITIONS = {
  workflow: "Smart if-statements: classify/route/score/branch inside ordinary software",
  bulk: "Cheap map-reduce judgment over large corpora",
  realtime: "Action selection at game/UI/market clock rates",
  verify: "Score/judge/gate prompts, traces, drafts, claims",
  harness: "Agent loop load-balancer: tool/model/human routing",
  voice: "Sub-second decisions on the audio path: turn-taking, speak-up, voice→action",
};
const PILLAR_CRITERIA = {
  workflow: "Smart workflow decisions / classify-route-score",
  bulk: "Bulk map-reduce over data",
  realtime: "Realtime control loops",
  verify: "Verify & guardrails",
  harness: "Agent harness engineering",
  voice: "Voice / audio-path judgment",
};

const BASE_NOUL = 0.78;
const BASE_SCORE = 2.7;
const NOUL_SAT = 0.14;
const SCORE_SAT = 0.8;
const SAT_START = 40;
const SAT_RANGE = 160;
const OVERLAP_FORCE_DUP = 0.55;
const MAX_URL_SNIPPET = 1500;
const MAX_PEER = 160;
const MAX_OTHER = 100;
const OTHER_N = 3;
const MAX_OVERLAP = 40;
const STATE_BUDGET = 24000;
const MAX_FETCH = 12000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function looksLikeUrl(s) {
  try {
    const u = new URL(String(s || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function shortTitle(text) {
  const one = String(text || "").replace(/\s+/g, " ").trim() || "use case";
  return one.length > 72 ? one.slice(0, 69).replace(/\s+\S*$/, "") + "…" : one;
}

function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)).replace(/\s+\S*$/, "") + "…";
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function thresholdsFor(n) {
  const sat = clamp((n - SAT_START) / SAT_RANGE, 0, 1);
  return {
    sat,
    noulThr: BASE_NOUL + NOUL_SAT * sat,
    scoreThr: BASE_SCORE + SCORE_SAT * sat,
  };
}

function stateChars(state) {
  return JSON.stringify(state).length;
}

async function callJev(apiKey, state, questions) {
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text);
}

function stripHtml(html) {
  const metas = [];
  for (const prop of ["og:title", "og:description", "twitter:title", "twitter:description", "description"]) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      "i",
    );
    const m = html.match(re);
    if (m) metas.push((m[1] || m[2] || "").trim());
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) metas.unshift(title[1].replace(/\s+/g, " ").trim());
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = [];
  const seen = new Set();
  for (const p of [...metas, body]) {
    if (p && !seen.has(p)) {
      seen.add(p);
      parts.push(p);
    }
  }
  return parts.join(" — ");
}

function xStatusId(url) {
  const m = String(url).match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

async function fetchX(url) {
  const sid = xStatusId(url);
  if (!sid) return null;
  for (const ep of [
    `https://api.fxtwitter.com/status/${sid}`,
    `https://api.vxtwitter.com/Twitter/status/${sid}`,
  ]) {
    try {
      const res = await fetch(ep, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      const tweet = data.tweet || data.status || data;
      if (!tweet || typeof tweet !== "object") continue;
      const author =
        (tweet.author && tweet.author.screen_name) ||
        tweet.user_screen_name ||
        tweet.author_screen_name ||
        "";
      let text =
        tweet.text ||
        tweet.full_text ||
        (tweet.body && tweet.body.text) ||
        data.text ||
        "";
      text = String(text).replace(/\s+/g, " ").trim();
      if (!text) continue;
      return `${author ? "@" + author + " " : ""}${text}`.slice(0, MAX_FETCH);
    } catch {
      /* try next */
    }
  }
  try {
    const oembed =
      "https://publish.twitter.com/oembed?omit_script=true&url=" + encodeURIComponent(url);
    const res = await fetch(oembed);
    if (!res.ok) return null;
    const data = await res.json();
    const plain = stripHtml(data.html || "");
    if (!plain) return null;
    return (data.author_name ? `${data.author_name}: ${plain}` : plain).slice(0, MAX_FETCH);
  } catch {
    return null;
  }
}

async function fetchGithub(url, token) {
  const m = String(url)
    .trim()
    .match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/(tree|blob)\/([^/]+)\/?(.*))?\/?$/i,
    );
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");
  const kind = m[3];
  const ref = m[4];
  const path = (m[5] || "").trim();
  try {
    if (kind === "blob" && ref && path) {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
      );
      if (res.ok) return (await res.text()).replace(/\s+/g, " ").trim().slice(0, MAX_FETCH);
    }
    const api =
      `https://api.github.com/repos/${owner}/${repo}/readme` +
      (ref ? `?ref=${encodeURIComponent(ref)}` : "");
    const headers = {
      Accept: "application/vnd.github.raw",
      "User-Agent": "jev-propose-api",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(api, { headers });
    if (res.ok) return (await res.text()).replace(/\s+/g, " ").trim().slice(0, MAX_FETCH);
  } catch {
    /* fall through */
  }
  for (const branch of ["main", "master"]) {
    for (const readme of ["README.md", "Readme.md", "readme.md"]) {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${readme}`,
        );
        if (!res.ok) continue;
        const text = (await res.text()).replace(/\s+/g, " ").trim();
        if (text.length > 80) return text.slice(0, MAX_FETCH);
      } catch {
        /* next */
      }
    }
  }
  return null;
}

async function fetchUrlText(url, token) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (/(?:twitter|x)\.com\//i.test(url)) {
    const got = await fetchX(url);
    if (got) return got;
  }
  if (/github\.com\//i.test(url)) {
    const got = await fetchGithub(url, token);
    if (got) return got;
  }
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; jev-use-cases-novelty-grader/1.2; +https://galigutta.github.io/jev-use-cases/)",
        Accept: "*/*",
      },
    });
    if (!res.ok) return null;
    const ctype = (res.headers.get("Content-Type") || "").toLowerCase();
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, MAX_FETCH * 2));
    if (ctype.includes("json")) {
      try {
        return JSON.stringify(JSON.parse(text)).slice(0, MAX_FETCH);
      } catch {
        /* fall through */
      }
    }
    if (ctype.includes("html") || /<html/i.test(text.slice(0, 500))) {
      return stripHtml(text).slice(0, MAX_FETCH) || null;
    }
    return text.replace(/\s+/g, " ").trim().slice(0, MAX_FETCH) || null;
  } catch {
    return null;
  }
}

async function loadInventory() {
  const res = await fetch(INVENTORY_URL, {
    headers: { Accept: "application/json", "User-Agent": "jev-propose-api" },
  });
  if (!res.ok) throw new Error(`Inventory HTTP ${res.status}`);
  const data = await res.json();
  const cases = data.use_cases || data;
  if (!Array.isArray(cases)) throw new Error("Bad inventory shape");
  return cases
    .map((c, i) => ({
      pillar: c.pillar,
      text: String(c.text || "").trim(),
      _idx: i,
    }))
    .filter((c) => c.text);
}

async function grade(apiKey, note, sourceUrl, urlText, existing) {
  const { sat, noulThr, scoreThr } = thresholdsFor(existing.length);
  const urlSnippet = urlText ? urlText.slice(0, MAX_URL_SNIPPET) : null;
  let proposal;
  if (note && urlText) proposal = `${note}\n\n--- resolved from ${sourceUrl} ---\n${urlText}`;
  else if (urlText) proposal = `Use case proposed via link ${sourceUrl}:\n\n${urlText}`;
  else proposal = note;

  // Stage 1 — pillar
  const pillarState = {
    proposal,
    source_url: sourceUrl || "",
    pillar_definitions: PILLAR_DEFINITIONS,
    instructions: "Route this proposal to the single best MECE pillar. Do not assess novelty here.",
  };
  if (urlSnippet) pillarState.source_url_snippet = urlSnippet;
  const pillarChars = stateChars(pillarState);
  const pillarResult = await callJev(apiKey, pillarState, {
    pillar: {
      type: "choice",
      instructions: "Which MECE pillar should this use case live under?",
      criteria: { ...PILLAR_CRITERIA },
    },
  });
  const pillarAns = pillarResult?.answers?.pillar || {};
  const pillarChoice = pillarAns.choice;
  const pillar = PILLARS.includes(pillarChoice) ? pillarChoice : "workflow";
  const pillarConfidence = pillarAns.confidence != null ? Number(pillarAns.confidence) : null;

  // Stage 2 — pack + novelty
  let peers = existing
    .filter((e) => e.pillar === pillar)
    .map((p, i) => ({
      id: `leaf_${String(i).padStart(2, "0")}`,
      pillar: p.pillar,
      text: truncate(p.text, MAX_PEER),
      _orig_idx: p._idx,
      _full_len: (p.text || "").length,
    }));

  const otherSamples = {};
  for (const p of PILLARS) {
    if (p === pillar) continue;
    const titles = existing
      .filter((e) => e.pillar === p)
      .map((e) => e.text)
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    otherSamples[p] = titles.slice(0, OTHER_N).map((t) => truncate(t, MAX_OTHER)).filter(Boolean);
  }

  const build = (peerList, others) => ({
    proposal,
    source_url: sourceUrl || "",
    chosen_pillar: pillar,
    existing_in_pillar: peerList.map((p) => ({ id: p.id, text: p.text })),
    other_pillar_samples: others,
    instructions:
      "The use-case map saturates as it grows: prefer rejecting rephrases, subsets, and 'same decision shape under a new noun.' Mark is_novel yes only for a distinct decision job not already present.",
  });

  let state = build(peers, otherSamples);
  let chars = stateChars(state);
  if (chars > STATE_BUDGET) {
    for (let k = 0; k < OTHER_N && chars > STATE_BUDGET; k++) {
      let changed = false;
      for (const p of Object.keys(otherSamples)) {
        if (otherSamples[p].length) {
          otherSamples[p].pop();
          changed = true;
        }
      }
      if (!changed) break;
      state = build(peers, otherSamples);
      chars = stateChars(state);
    }
  }
  if (chars > STATE_BUDGET && peers.length) {
    const dropOrder = [...peers.keys()].sort(
      (a, b) => peers[b]._full_len - peers[a]._full_len || a - b,
    );
    const keep = new Set(peers.keys());
    while (chars > STATE_BUDGET && dropOrder.length) {
      keep.delete(dropOrder.shift());
      peers = peers.filter((_, i) => keep.has(i));
      peers.forEach((p, j) => {
        p.id = `leaf_${String(j).padStart(2, "0")}`;
      });
      // rebuild keep indices after filter — restart simpler
      state = build(peers, otherSamples);
      chars = stateChars(state);
      break; // one aggressive trim pass; enough for Workers
    }
    // If still over, hard-slice peers
    while (chars > STATE_BUDGET && peers.length > 5) {
      peers.pop();
      peers.forEach((p, j) => {
        p.id = `leaf_${String(j).padStart(2, "0")}`;
      });
      state = build(peers, otherSamples);
      chars = stateChars(state);
    }
  }
  if (peers.length > MAX_OVERLAP) {
    peers = peers.slice(0, MAX_OVERLAP);
    peers.forEach((p, j) => {
      p.id = `leaf_${String(j).padStart(2, "0")}`;
    });
    state = build(peers, otherSamples);
    chars = stateChars(state);
  }

  const overlapCriteria = {
    none: "No meaningful overlap with any listed leaf in this pillar",
  };
  for (const p of peers.slice(0, MAX_OVERLAP)) {
    overlapCriteria[p.id] = `[${pillar}] ${p.text}`.slice(0, 220);
  }

  const noveltyResult = await callJev(apiKey, state, {
    is_novel: {
      type: "noul",
      instructions:
        "Is this proposal a distinct decision job not already present? Yes only for a new leaf — reject rephrases, subsets, and the same decision shape under a new noun. The map saturates; prefer rejecting.",
      criteria: {
        true: "Distinct new decision job; not a rephrase/subset/same-shape variant",
        false: "Already covered, overlapping, subset, or only a wording/noun variant",
      },
    },
    overlap: {
      type: "choice",
      instructions:
        "Which existing leaf in this packed state is most similar? Choose none if no meaningful overlap.",
      criteria: overlapCriteria,
    },
    novelty_score: {
      type: "score",
      instructions:
        "How novel is this proposal relative to the existing map? Be strict: same decision shape under a new noun scores low.",
      criteria: [
        "0 Duplicate / already listed",
        "1 Minor variant / rephrase / same decision shape new noun",
        "2 Related but thin angle; likely reject under saturation",
        "3 Clearly new decision job under an existing pillar",
        "4 Highly novel / unexpected distinct decision job",
      ],
    },
  });

  const answers = noveltyResult.answers || {};
  const noul = Number(answers.is_novel?.noul ?? 0);
  const noveltyScore = Number(answers.novelty_score?.score ?? 0);
  const overlapChoice = answers.overlap?.choice || "none";
  const overlapConf = Number(answers.overlap?.confidence ?? 0);
  let overlapText = null;
  if (String(overlapChoice).startsWith("leaf_")) {
    const idx = Number(String(overlapChoice).split("_")[1]);
    if (!Number.isNaN(idx) && peers[idx]) {
      const orig = peers[idx]._orig_idx;
      overlapText =
        typeof orig === "number" && existing[orig]
          ? existing[orig].text
          : peers[idx].text;
    }
  }

  const overlapForcesDup =
    overlapChoice !== "none" &&
    String(overlapChoice).startsWith("leaf_") &&
    overlapConf >= OVERLAP_FORCE_DUP;
  const overlapOk = overlapChoice === "none" || overlapConf < OVERLAP_FORCE_DUP;
  const novel = noul >= noulThr && noveltyScore >= scoreThr && overlapOk && !overlapForcesDup;

  const gates = {
    noul_pass: noul >= noulThr,
    score_pass: noveltyScore >= scoreThr,
    overlap_ok: overlapOk && !overlapForcesDup,
  };
  const why = [];
  if (!gates.noul_pass) why.push("noul_below_threshold");
  if (!gates.score_pass) why.push("score_below_threshold");
  if (!gates.overlap_ok) why.push("overlap_force_duplicate");

  return {
    novel,
    verdict: novel ? "novel" : "duplicate",
    pillar,
    pillar_confidence: pillarConfidence,
    noul,
    novelty_score: noveltyScore,
    noul_threshold: noulThr,
    score_threshold: scoreThr,
    sat,
    n_leaves: existing.length,
    overlap: overlapChoice,
    overlap_text: overlapText,
    overlap_confidence: overlapConf,
    gates,
    why: novel ? [] : why,
    pillar_chars: pillarChars,
    novelty_chars: chars,
    proposal,
    fetched_url: Boolean(urlText),
  };
}

function verdictComment(g) {
  const lines = [
    "<!-- graded-by:propose-api -->",
    "## Jev novelty grade",
    "",
    `- **Verdict:** \`${g.verdict}\``,
    `- **is_novel (noul):** \`${g.noul}\` (saturated threshold ≥ \`${g.noul_threshold}\`)`,
    `- **novelty_score:** \`${g.novelty_score}\` (threshold ≥ \`${g.score_threshold}\`)`,
    `- **Pillar:** \`${g.pillar}\``,
    `- **Closest overlap:** \`${g.overlap}\`${g.overlap_text ? ` — ${g.overlap_text}` : ""}`,
    `- **Catalog:** ${g.n_leaves} leaves · saturation \`${Number(g.sat).toFixed(2)}\``,
    `- **Two-stage packing:** state_chars pillar=\`${g.pillar_chars}\` novelty=\`${g.novelty_chars}\``,
    `- **Graded:** in-request by propose API (instant path)`,
    "",
  ];
  if (g.novel) {
    lines.push(
      "Proposal clears the **stricter saturated novelty bar**. A Codex leaf will auto-merge onto the map.",
    );
  } else {
    lines.push(
      "Proposal does **not** clear the stricter saturated novelty bar — already covered / not novel enough. Stopping — no PR.",
    );
  }
  return lines.join("\n");
}

async function gh(token, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "jev-propose-api",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    if (!env.GITHUB_TOKEN || !env.TYPESAFE_API_KEY) {
      return json({ error: "Server misconfigured" }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    let note = String(body.note || body.description || "").trim();
    let url = String(body.url || body.source_url || "").trim();
    if (!url && looksLikeUrl(note)) {
      url = note;
      note = "";
    }
    if (!url && !note) return json({ error: "Paste a link or a short note." }, 400);
    if (url && !looksLikeUrl(url)) return json({ error: "Link must be a valid http(s) URL." }, 400);

    let urlText = null;
    if (url) {
      urlText = await fetchUrlText(url, env.GITHUB_TOKEN);
      if (!urlText) {
        return json({ error: `Could not resolve content from URL: ${url}` }, 422);
      }
    }

    let existing;
    try {
      existing = await loadInventory();
    } catch (err) {
      return json({ error: `Could not load map inventory: ${String(err.message || err)}` }, 502);
    }

    let gradeResult;
    try {
      gradeResult = await grade(env.TYPESAFE_API_KEY, note, url, urlText, existing);
    } catch (err) {
      return json({ error: `Jev grade failed: ${String(err.message || err).slice(0, 200)}` }, 502);
    }

    const publicGrade = {
      novel: gradeResult.novel,
      verdict: gradeResult.verdict,
      pillar: gradeResult.pillar,
      pillar_confidence: gradeResult.pillar_confidence,
      noul: gradeResult.noul,
      novelty_score: gradeResult.novelty_score,
      noul_threshold: gradeResult.noul_threshold,
      score_threshold: gradeResult.score_threshold,
      sat: gradeResult.sat,
      n_leaves: gradeResult.n_leaves,
      overlap: gradeResult.overlap,
      overlap_text: gradeResult.overlap_text,
      overlap_confidence: gradeResult.overlap_confidence,
      gates: gradeResult.gates,
      why: gradeResult.why,
    };

    // Duplicates: verdict only — no GitHub issue, no Actions.
    if (!gradeResult.novel) {
      return json({ ...publicGrade, issue: null, dispatched: false });
    }

    // Novel: pass Worker verdict downstream via repository_dispatch (skip re-grade in Actions).
    const dispatchPayload = {
      ...publicGrade,
      proposal: gradeResult.proposal,
      source_url: url || "",
      note: note || "",
      graded_by: "propose-api",
    };

    const { res: dres, data: ddata } = await gh(
      env.GITHUB_TOKEN,
      `/repos/${REPO}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({
          event_type: "propose_use_case",
          client_payload: dispatchPayload,
        }),
      },
    );
    // repository_dispatch returns 204 empty on success
    if (!dres.ok && dres.status !== 204) {
      return json(
        {
          error: ddata.message || `Dispatch HTTP ${dres.status}`,
          novel: true,
          verdict: "novel",
          pillar: gradeResult.pillar,
        },
        dres.status || 502,
      );
    }

    return json({
      ...publicGrade,
      dispatched: true,
      issue: null,
    });
  },
};
