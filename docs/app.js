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

  // Deep link — pillar or leaf
  const rawHash = location.hash.replace(/^#/, "");
  if (rawHash.startsWith("leaf-")) {
    const leafEl = document.getElementById(rawHash);
    const pillar = rawHash.split("-")[1];
    if (known.includes(pillar)) openPillar(pillar, { scroll: false });
    if (leafEl) {
      requestAnimationFrame(() => {
        leafEl.classList.add("is-flash");
        leafEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => leafEl.classList.remove("is-flash"), 2200);
      });
    }
  } else {
    const hash = rawHash.replace(/^pillar-/, "");
    if (known.includes(hash)) openPillar(hash, { scroll: true });
  }

  // In-page leaf links from the propose verdict
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.propose__leaf-link");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("#leaf-")) return;
    e.preventDefault();
    const id = href.slice(1);
    history.pushState(null, "", href);
    const leafEl = document.getElementById(id);
    const pillar = id.split("-")[1];
    if (known.includes(pillar)) openPillar(pillar, { scroll: false });
    if (leafEl) {
      leafEl.classList.add("is-flash");
      leafEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => leafEl.classList.remove("is-flash"), 2200);
    }
  });

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

  // Propose stays on-page: POST to Worker (Jev in-request). Duplicate → verdict only; novel → dispatch. Legacy poll kept for issue-shaped responses.
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
      live.setAttribute("tabindex", "-1");
      proposeStatus.prepend(live);
    }
    return live;
  };

  const escapeText = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const fmtNum = (n, digits = 2) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toFixed(digits);
  };

  const passFail = (ok) =>
    ok ? `<span class="propose__gate propose__gate--pass">pass</span>` : `<span class="propose__gate propose__gate--fail">fail</span>`;

  const renderGradeMetrics = (data) => {
    const noul = data.noul;
    const noulThr = data.noul_threshold;
    const score = data.novelty_score;
    const scoreThr = data.score_threshold;
    const gates = data.gates || {};
    const rows = [];
    if (data.pillar) {
      rows.push(
        `<div class="propose__metric"><span class="propose__metric-k">Pillar</span><span class="propose__metric-v"><em>${escapeText(data.pillar)}</em>` +
          (data.pillar_confidence != null
            ? ` <code>${fmtNum(data.pillar_confidence)}</code>`
            : "") +
          `</span></div>`,
      );
    }
    if (noul != null || noulThr != null) {
      rows.push(
        `<div class="propose__metric"><span class="propose__metric-k">is_novel <span class="propose__metric-sub">noul</span></span><span class="propose__metric-v"><code>${fmtNum(noul)}</code> <span class="propose__metric-sub">≥ ${fmtNum(noulThr)}</span> ${passFail(gates.noul_pass ?? noul >= noulThr)}</span></div>`,
      );
    }
    if (score != null || scoreThr != null) {
      rows.push(
        `<div class="propose__metric"><span class="propose__metric-k">novelty_score</span><span class="propose__metric-v"><code>${fmtNum(score, 1)}</code> <span class="propose__metric-sub">≥ ${fmtNum(scoreThr, 1)}</span> ${passFail(gates.score_pass ?? score >= scoreThr)}</span></div>`,
      );
    }
    const overlapLabel = data.overlap_text || data.overlap || "";
    if (overlapLabel && overlapLabel !== "none") {
      const href = data.overlap_href || (data.overlap_id ? `#${data.overlap_id}` : "");
      const labelHtml = href
        ? `<a class="propose__leaf-link" href="${escapeText(href)}"><em>${escapeText(overlapLabel)}</em></a>`
        : `<em>${escapeText(overlapLabel)}</em>`;
      rows.push(
        `<div class="propose__metric propose__metric--wide"><span class="propose__metric-k">Closest overlap</span><span class="propose__metric-v">${labelHtml}` +
          (data.overlap_confidence != null
            ? ` <code>${fmtNum(data.overlap_confidence)}</code>`
            : "") +
          ` ${passFail(gates.overlap_ok !== false)}</span></div>`,
      );
    } else if (data.overlap === "none") {
      rows.push(
        `<div class="propose__metric propose__metric--wide"><span class="propose__metric-k">Closest overlap</span><span class="propose__metric-v"><em>none</em> ${passFail(true)}</span></div>`,
      );
    }
    if (data.n_leaves != null || data.sat != null) {
      rows.push(
        `<div class="propose__metric propose__metric--wide"><span class="propose__metric-k">Catalog</span><span class="propose__metric-v"><code>${escapeText(String(data.n_leaves ?? "—"))}</code> leaves · sat <code>${fmtNum(data.sat)}</code></span></div>`,
      );
    }
    if (!rows.length) return "";
    return `<div class="propose__metrics" role="group" aria-label="Jev grade">${rows.join("")}</div>`;
  };

  const whyLine = (data) => {
    const why = Array.isArray(data.why) ? data.why : [];
    if (!why.length) return "";
    const labels = {
      noul_below_threshold: "noul below bar",
      score_below_threshold: "novelty score below bar",
      overlap_force_duplicate: "overlap forced duplicate",
    };
    return `<p class="propose__why">Held back by: ${why.map((w) => labels[w] || escapeText(w)).join(" · ")}</p>`;
  };


  const setLive = (state, html) => {
    const live = ensureLive();
    if (!live) return;
    live.dataset.state = state || "info";
    live.innerHTML = html;
    const hasVerdict = state === "ok" || state === "dup" || state === "info";
    proposeStatus.toggleAttribute("data-has-verdict", hasVerdict);
    // Focus the banner for network outcomes only — keep field focus on validation.
    if (state === "ok" || state === "dup") {
      try {
        live.focus({ preventScroll: false });
      } catch {
        /* ignore */
      }
    }
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
              `<strong>Accepted</strong> — new` +
                (v.pillar ? ` under <em>${escapeText(v.pillar)}</em>` : "") +
                `. A leaf is writing now and will <strong>auto-merge</strong> in a couple of minutes. Refresh the map after merge. ` +
                `<a href="${issue.html_url}" rel="noopener">See details</a>`,
            );
          } else if (v.kind === "duplicate") {
            setLive(
              "dup",
              `<strong>Already on the map</strong>` +
                (v.overlap && v.overlap !== "none"
                  ? `. Closest leaf: <em>${escapeText(v.overlap)}</em>`
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
      setLive("info", "Add a link or a short note to propose.");
      return;
    }
    if (url && !looksLikeUrl(url)) {
      urlEl?.focus();
      setLive("info", "Link must be a valid http(s) URL.");
      return;
    }

    const idleLabel = submitBtn?.textContent || "Submit proposal";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute("aria-busy", "true");
      submitBtn.textContent = "Checking…";
    }
    proposeStatus?.removeAttribute("data-has-verdict");
    setLive("waiting", "Checking with Jev — usually a few seconds…");

    try {
      const res = await fetch(PROPOSE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url, note: description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const raw = data.error || `Submit failed (HTTP ${res.status})`;
        const friendly = /could not resolve content/i.test(String(raw))
          ? `We couldn’t read that link — ${String(raw).replace(/^Could not resolve content from URL:\s*/i, "")}`
          : raw;
        throw new Error(friendly);
      }

      // Worker grades with Jev in-request. Duplicates never create a GitHub issue.
      if (data.verdict === "novel" || data.novel === true) {
        const detail = data.html_url
          ? `<a href="${data.html_url}" rel="noopener">See details</a>`
          : `<a href="https://github.com/galigutta/jev-use-cases/pulls" rel="noopener">Watch PRs</a>`;
        const viaNone = data.accepted_via === "no_closest_overlap";
        const head = viaNone
          ? `<p class="propose__headline"><strong>Accepted</strong> — no closest leaf on the map, so we’re adding it. A leaf will <strong>auto-merge</strong> in a couple of minutes. Refresh after merge. ${detail}</p>`
          : `<p class="propose__headline"><strong>Accepted</strong> — new under the map. A leaf is writing now and will <strong>auto-merge</strong> in a couple of minutes. Refresh after merge. ${detail}</p>`;
        setLive("ok", head + renderGradeMetrics(data));
      } else if (data.verdict === "duplicate" || data.novel === false) {
        const hasOverlap =
          data.overlap_text || (data.overlap && data.overlap !== "none");
        const head = hasOverlap
          ? `<p class="propose__headline"><strong>Already on the map</strong> — nothing was filed.</p>`
          : `<p class="propose__headline"><strong>Not added</strong> — didn’t clear the novelty bar. Nothing was filed.</p>`;
        setLive("dup", head + renderGradeMetrics(data) + whyLine(data));
      } else if (data.number && data.html_url) {
        startWatching({ number: data.number, html_url: data.html_url });
      } else {
        throw new Error("No verdict came back from Jev.");
      }
    } catch (err) {
      setLive(
        "info",
        `Couldn’t submit from the page: ${escapeText(String(err.message || err).slice(0, 140))}. Try again in a moment.`,
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute("aria-busy");
        submitBtn.textContent = idleLabel;
      }
    }
  });

})();
