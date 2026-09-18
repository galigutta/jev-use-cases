(() => {
  const rail = document.getElementById("pillar-rail");
  const buttons = [...document.querySelectorAll(".rail-btn")];
  const pillars = [...document.querySelectorAll(".pillar")];
  const cables = [...document.querySelectorAll(".cable")];
  const known = ["workflow", "bulk", "realtime", "verify", "harness", "voice"];

  const setActive = (id) => {
    buttons.forEach((btn) => {
      const on = btn.dataset.pillar === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // is-open = highlighted / scrolled-to only — content always remains visible
    pillars.forEach((p) => {
      p.classList.toggle("is-open", p.dataset.pillar === id);
    });
  };

  const scrollToPillar = (id) => {
    const el = document.getElementById(`pillar-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openPillar = (id, { scroll = true } = {}) => {
    if (!known.includes(id)) return;
    setActive(id);
    if (scroll) scrollToPillar(id);
  };

  rail?.addEventListener("click", (e) => {
    const btn = e.target.closest(".rail-btn");
    if (!btn) return;
    openPillar(btn.dataset.pillar);
  });

  cables.forEach((c) => {
    c.addEventListener("click", () => {
      const id = c.dataset.pillar;
      requestAnimationFrame(() => openPillar(id));
    });
  });

  // Deep link
  const hash = location.hash.replace("#pillar-", "").replace("#", "");
  if (known.includes(hash)) openPillar(hash, { scroll: true });

  // Intersection: highlight in-view pillar; never hide / dim others
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((en) => en.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        setActive(visible.target.dataset.pillar);
      },
      { rootMargin: "-28% 0px -48% 0px", threshold: [0.15, 0.35, 0.55, 0.75] }
    );
    pillars.forEach((p) => io.observe(p));
  }

  // Tap-to-toggle blurbs (one open at a time); close on outside tap / Escape
  const blurbs = [...document.querySelectorAll(".blurb")];

  const closeAllBlurbs = (exceptBtn = null) => {
    blurbs.forEach((btn) => {
      if (exceptBtn && btn === exceptBtn) return;
      const panelId = btn.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      btn.setAttribute("aria-expanded", "false");
      if (panel) panel.hidden = true;
    });
  };

  blurbs.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panelId = btn.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;
      const willOpen = btn.getAttribute("aria-expanded") !== "true";
      closeAllBlurbs(willOpen ? btn : null);
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      panel.hidden = !willOpen;
    });
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".blurb") || e.target.closest(".blurb-panel")) return;
    closeAllBlurbs();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllBlurbs();
  });

  // Propose stays on-page: POST to API → create issue → poll for Jev verdict
  const proposeForm = document.getElementById("propose-form");
  const proposeStatus = document.getElementById("propose-status");
  const API_ISSUES =
    "https://api.github.com/repos/galigutta/jev-use-cases/issues";
  const PROPOSE_API =
    window.JEV_PROPOSE_API || "https://jev-propose.vamsir.workers.dev";

  const looksLikeUrl = (s) => {
    try {
      const u = new URL(s);
      return /^https?:$/i.test(u.protocol);
    } catch {
      return false;
    }
  };

  const ensureLive = () => {
    if (!proposeStatus) return null;
    proposeStatus.classList.add("is-ready");
    let live = proposeStatus.querySelector(".propose__live");
    if (!live) {
      live = document.createElement("div");
      live.className = "propose__live";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      proposeStatus.prepend(live);
    }
    return live;
  };

  const setLive = (state, html) => {
    const live = ensureLive();
    if (!live) return;
    live.dataset.state = state || "info";
    live.innerHTML = html;
  };

  let pollTimer = null;
  const stopPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const parseVerdict = (body) => {
    if (!body) return null;
    const lower = body.toLowerCase();
    if (!lower.includes("jev novelty grade") && !lower.includes("**verdict:**")) {
      return null;
    }
    const novel =
      lower.includes("`novel`") ||
      lower.includes("verdict:** `novel`") ||
      (lower.includes("auto-merge") && lower.includes("clears"));
    const dup =
      lower.includes("`duplicate`") ||
      lower.includes("does **not** clear") ||
      lower.includes("already covered") ||
      lower.includes("stopping — no pr");
    let overlap = "";
    const om = body.match(/\*\*Closest overlap:\*\*\s*`([^`]+)`(?:\s*—\s*(.+))?/i);
    if (om) overlap = (om[2] || om[1] || "").trim();
    let pillar = "";
    const pm = body.match(/\*\*Pillar:\*\*\s*`([^`]+)`/i);
    if (pm) pillar = pm[1];
    if (dup && !novel) return { kind: "duplicate", overlap, pillar, body };
    if (novel) return { kind: "novel", overlap, pillar, body };
    return { kind: "unknown", overlap, pillar, body };
  };

  const fetchComments = async (issueNumber) => {
    const res = await fetch(
      `${API_ISSUES}/${issueNumber}/comments?per_page=30`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) throw new Error(`GitHub comments HTTP ${res.status}`);
    return res.json();
  };

  const startWatching = (issue) => {
    stopPoll();
    const started = Date.now();
    let ticks = 0;

    setLive(
      "waiting",
      `Submitted as <a href="${issue.html_url}" rel="noopener">#${issue.number}</a>. Waiting for the novelty check…`,
    );

    const tick = async () => {
      ticks += 1;
      const elapsed = Date.now() - started;
      try {
        const comments = await fetchComments(issue.number);
        for (const c of comments) {
          const v = parseVerdict(c.body || "");
          if (!v) continue;
          stopPoll();
          if (v.kind === "novel") {
            setLive(
              "ok",
              `<strong>Accepted</strong> — it’s new` +
                (v.pillar ? ` (→ <em>${v.pillar}</em>)` : "") +
                `. A leaf is being written and <strong>auto-merged</strong> onto the map. ` +
                `<a href="${issue.html_url}" rel="noopener">See details</a>`,
            );
          } else if (v.kind === "duplicate") {
            setLive(
              "dup",
              `<strong>Already on the map</strong> (or too close to an existing leaf)` +
                (v.overlap && v.overlap !== "none"
                  ? `: <em>${v.overlap.replace(/</g, "&lt;")}</em>`
                  : "") +
                `. Nothing was merged. ` +
                `<a href="${issue.html_url}" rel="noopener">See the grade</a>`,
            );
          } else {
            setLive(
              "info",
              `Got an update on <a href="${issue.html_url}" rel="noopener">#${issue.number}</a> — open it for the full grade.`,
            );
          }
          return;
        }
        if (elapsed > 45_000 && ticks % 3 === 0) {
          setLive(
            "waiting",
            `Still grading <a href="${issue.html_url}" rel="noopener">#${issue.number}</a>… usually under a couple of minutes.`,
          );
        }
        if (elapsed > 8 * 60_000) {
          stopPoll();
          setLive(
            "info",
            `Taking longer than usual — check <a href="${issue.html_url}" rel="noopener">#${issue.number}</a> for the result.`,
          );
        }
      } catch (err) {
        if (ticks === 1 || ticks % 5 === 0) {
          setLive(
            "info",
            `Couldn’t reach GitHub just now (${String(err.message || err).slice(0, 80)}). Grading still runs — refresh in a minute.`,
          );
        }
      }
    };

    tick();
    pollTimer = setInterval(tick, 5000);
  };

  proposeForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const textEl = document.getElementById("propose-text");
    const urlEl = document.getElementById("propose-url");
    const submitBtn = proposeForm.querySelector('button[type="submit"]');
    let description = (textEl?.value || "").trim();
    let url = (urlEl?.value || "").trim();

    if (!url && looksLikeUrl(description)) {
      url = description;
      description = "";
    }

    if (!url && !description) {
      urlEl?.focus();
      setLive("info", "Paste a link (or a short note).");
      return;
    }
    if (url && !looksLikeUrl(url)) {
      urlEl?.focus();
      setLive("info", "Link must be a valid http(s) URL.");
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    setLive("waiting", "Checking with Jev…");

    try {
      const res = await fetch(PROPOSE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url, note: description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Submit failed (HTTP ${res.status})`);
      }

      // Worker grades with Jev in-request. Duplicates never create a GitHub issue.
      if (data.verdict === "novel" || data.novel === true) {
        const detail = data.html_url
          ? ` <a href="${data.html_url}" rel="noopener">Details</a>`
          : ` <a href="https://github.com/galigutta/jev-use-cases/pulls" rel="noopener">Watch the PR</a>`;
        setLive(
          "ok",
          `<strong>Accepted</strong> — it’s new` +
            (data.pillar ? ` (→ <em>${data.pillar}</em>)` : "") +
            `. A leaf is being written and <strong>auto-merged</strong> onto the map.` +
            detail,
        );
      } else if (data.verdict === "duplicate" || data.novel === false) {
        const overlap = data.overlap_text || data.overlap || "";
        setLive(
          "dup",
          `<strong>Already on the map</strong> (or too close to an existing leaf)` +
            (overlap && overlap !== "none"
              ? `: <em>${String(overlap).replace(/</g, "&lt;")}</em>`
              : "") +
            `. Nothing was filed or merged.`,
        );
      } else if (data.number && data.html_url) {
        startWatching({ number: data.number, html_url: data.html_url });
      } else {
        throw new Error("No verdict came back from Jev.");
      }
    } catch (err) {
      setLive(
        "info",
        `Couldn’t submit from the page: ${String(err.message || err).slice(0, 140)}. Try again in a moment.`,
      );
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

})();
