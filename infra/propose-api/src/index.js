/**
 * On-page propose API for galigutta/jev-use-cases
 * POST JSON { url?: string, note?: string } → creates labeled GitHub issue, returns { number, html_url, title }
 */
const REPO = "galigutta/jev-use-cases";
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }
    if (!env.GITHUB_TOKEN) {
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
    if (!url && !note) {
      return json({ error: "Paste a link or a short note." }, 400);
    }
    if (url && !looksLikeUrl(url)) {
      return json({ error: "Link must be a valid http(s) URL." }, 400);
    }

    const titleSeed = note || url || "use case";
    const title = `[propose] ${shortTitle(titleSeed)}`;
    const parts = [];
    if (note) parts.push("### Description", "", note, "");
    else parts.push("### Description", "", "_Link-only proposal — resolve content from Source URL._", "");
    if (url) parts.push("### Source URL", "", url, "");
    parts.push(
      "---",
      "",
      "_Submitted from the [Jev use-case map](https://galigutta.github.io/jev-use-cases/#propose) (on-page API)._",
      "",
      "Please leave the `propose` label so this can be graded against the live map.",
    );

    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "jev-propose-api",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title,
        body: parts.join("\n"),
        labels: ["propose"],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(
        { error: data.message || `GitHub HTTP ${res.status}`, details: data.errors || null },
        res.status,
      );
    }
    return json({
      number: data.number,
      html_url: data.html_url,
      title: data.title,
    });
  },
};
