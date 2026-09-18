(() => {
  const rail = document.getElementById("pillar-rail");
  const buttons = [...document.querySelectorAll(".rail-btn")];
  const pillars = [...document.querySelectorAll(".pillar")];
  const cables = [...document.querySelectorAll(".cable")];

  const openPillar = (id, { scroll = true } = {}) => {
    buttons.forEach((btn) => {
      const on = btn.dataset.pillar === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    pillars.forEach((p) => {
      p.classList.toggle("is-open", p.dataset.pillar === id);
    });
    if (scroll) {
      const el = document.getElementById(`pillar-${id}`);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }
  };

  rail?.addEventListener("click", (e) => {
    const btn = e.target.closest(".rail-btn");
    if (!btn) return;
    openPillar(btn.dataset.pillar);
  });

  cables.forEach((c) => {
    c.addEventListener("click", (e) => {
      // let hash update, then open
      const id = c.dataset.pillar;
      requestAnimationFrame(() => openPillar(id));
    });
  });

  // Deep link
  const hash = location.hash.replace("#pillar-", "").replace("#", "");
  const known = ["workflow", "bulk", "realtime", "verify", "harness"];
  if (known.includes(hash)) openPillar(hash, { scroll: true });

  // Intersection: update rail as user scrolls open pillars
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((en) => en.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = visible.target.dataset.pillar;
        buttons.forEach((btn) => {
          const on = btn.dataset.pillar === id;
          btn.classList.toggle("is-active", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        });
        pillars.forEach((p) => p.classList.toggle("is-open", p.dataset.pillar === id));
      },
      { rootMargin: "-30% 0px -45% 0px", threshold: [0.2, 0.5, 0.8] }
    );
    pillars.forEach((p) => io.observe(p));
  }
})();
