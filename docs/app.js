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
})();
