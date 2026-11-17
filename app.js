/* Dani Idemudia · Works
   One script for every page. Each page says which it is with <body data-page="home|work|files|about">,
   and everything is rendered from projects.json. Vanilla JS, no build step, relative URLs only.
   All data is written with textContent / attributes, never innerHTML. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const canAnimate = () => !reduceMotion.matches && "IntersectionObserver" in window;
  if (canAnimate()) document.documentElement.classList.add("js-motion");

  /* ---------- helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const bindAll = (name) => $$(`[data-bind="${name}"]`);
  const bind = (name) => bindAll(name)[0] || null;
  const setText = (name, text) => bindAll(name).forEach((n) => { n.textContent = text; });

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "style") node.style.cssText = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  function svg(viewBox, cls, paths) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    for (const [tag, attrs] of paths) {
      const p = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
      s.append(p);
    }
    return s;
  }

  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const pad = (n) => String(n).padStart(2, "0");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const workURL = (p) => `work.html?id=${encodeURIComponent(p.id)}`;
  const epLabel = (p) => `EP.${pad(p.episode)}`;

  function formatDate(d) {
    if (!d || typeof d !== "string") return "";
    const m = d.match(/^(\d{4})(?:-(\d{1,2}))?/);
    if (!m) return d;
    return m[2] ? `${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}`.trim() : m[1];
  }

  function fileExt(href) {
    const m = String(href || "").split(/[?#]/)[0].match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toUpperCase() : "";
  }

  // "1.2 MB" → bytes, for the library total. Unknown formats count as 0.
  function sizeBytes(s) {
    const m = String(s || "").match(/([\d.]+)\s*(KB|MB|GB|B)\b/i);
    if (!m) return 0;
    return parseFloat(m[1]) * { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[m[2].toUpperCase()];
  }
  function formatBytes(b) {
    if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
    if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
    if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
    return b ? `${b} B` : "";
  }

  /* An <img> that becomes a tone panel with a note if the file is missing. */
  function picture(src, alt, opts = {}) {
    const img = h("img", {
      src,
      alt: alt || "",
      loading: opts.eager ? "eager" : "lazy",
      decoding: "async",
      fetchpriority: opts.eager ? "high" : null,
    });
    img.addEventListener("error", () => {
      if (opts.fallback && img.dataset.fellBack !== "1") {   // a missing thumb tries the full image once
        img.dataset.fellBack = "1";
        img.src = opts.fallback;
        return;
      }
      const host = opts.host || img.parentElement;
      if (!host || host.classList.contains("is-missing")) return;
      host.classList.add("is-missing");
      host.append(h("span", { class: "missing-note", text: opts.note || "Photo coming soon" }));
    });
    return img;
  }

  // Cover for a card: first photo's thumb, else the first render.
  function coverFor(p) {
    if (p.cover && p.cover.src) return { src: p.cover.src, full: p.cover.src, alt: p.cover.alt || "", pos: p.cover.position };
    const ph = arr(p.photos)[0];
    if (ph) return { src: ph.thumb || ph.src, full: ph.src, alt: ph.alt };
    const r = arr(p.renders)[0];
    if (r) return { src: r.thumb || r.src, full: r.src, alt: r.alt };
    return null;
  }

  function splitName(name) {
    const m = String(name || "").trim().match(/^(\S+)\s+\(([^)]+)\)\s+(.+)$/);
    if (m) return { first: m[1], nick: m[2], last: m[3] };
    const parts = String(name || "").trim().split(/\s+/);
    if (parts.length < 2) return { first: parts[0] || "", nick: "", last: "" };
    return { first: parts.slice(0, -1).join(" "), nick: "", last: parts[parts.length - 1] };
  }

  /* ---------- lightbox (built once, on demand) ---------- */
  let lightbox = null;
  function getLightbox() {
    if (lightbox) return lightbox;
    const btn = (cls, label, d) => h("button", { type: "button", class: `lb-btn ${cls}`, "aria-label": label },
      svg("0 0 24 24", null, [["path", { d }]]));
    const close = btn("lb-close", "Close viewer", "M5 5l14 14M19 5L5 19");
    const prev = btn("lb-prev", "Previous image", "M15 4l-8 8 8 8");
    const next = btn("lb-next", "Next image", "M9 4l8 8-8 8");
    const count = h("p", { class: "lb-count", "aria-live": "polite" });
    const img = h("img", { class: "lb-img", alt: "" });
    const tag = h("span", { class: "lb-tag" });
    const text = h("span", { class: "lb-text" });
    const fig = h("figure", { class: "lb-figure" }, img, h("figcaption", { class: "lb-cap", id: "lb-cap" }, tag, text));
    const inner = h("div", { class: "lb-inner" },
      h("div", { class: "lb-top" }, count, close), fig, h("div", { class: "lb-nav" }, prev, next));
    const dlg = h("dialog", { class: "lb", "aria-label": "Image viewer", "aria-describedby": "lb-cap" }, inner);
    document.body.append(dlg);

    let items = [], index = 0, opener = null;

    function show(i, dir = 0) {
      index = (i + items.length) % items.length;
      const it = items[index];
      img.classList.remove("is-swapping");
      img.alt = it.alt || "";
      img.src = it.src;
      if (dir && canAnimate()) {
        img.style.setProperty("--dir", dir);
        void img.offsetWidth;
        img.classList.add("is-swapping");
      }
      tag.textContent = it.kind === "file" ? "The file" : it.kind === "print" ? "The real print" : "";
      tag.dataset.kind = it.kind || "";
      text.textContent = it.caption || it.alt || "";
      count.textContent = items.length > 1 ? `${pad(index + 1)} / ${pad(items.length)}` : "";
      const single = items.length < 2;
      prev.hidden = next.hidden = single;
      if (!single) [items[(index + 1) % items.length], items[(index - 1 + items.length) % items.length]]
        .forEach((n) => { const p = new Image(); p.src = n.src; });
    }

    function open(list, i, from) {
      if (!list.length) return;
      items = list;
      opener = from || document.activeElement;
      show(i);
      document.documentElement.classList.add("lb-open");
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
      close.focus();
    }
    function shut() {
      if (typeof dlg.close === "function") dlg.close();
      else { dlg.removeAttribute("open"); dlg.dispatchEvent(new Event("close")); }
    }

    dlg.addEventListener("close", () => {
      document.documentElement.classList.remove("lb-open");
      img.removeAttribute("src");
      if (opener && document.contains(opener)) opener.focus();
    });
    prev.addEventListener("click", () => show(index - 1, -1));
    next.addEventListener("click", () => show(index + 1, 1));
    close.addEventListener("click", shut);

    dlg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); show(index + 1, 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); show(index - 1, -1); }
      else if (e.key === "Home") { e.preventDefault(); show(0, -1); }
      else if (e.key === "End") { e.preventDefault(); show(items.length - 1, 1); }
      else if (e.key === "Escape") { e.preventDefault(); shut(); }
      else if (e.key === "Tab") {           // focus trap across the visible buttons
        const f = [close, prev, next].filter((b) => !b.hidden);
        const at = f.indexOf(document.activeElement);
        e.preventDefault();
        f[e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : (at + 1) % f.length].focus();
      }
    });

    // Swipe left / right on the picture; a click on the dark ground closes.
    let sx = null, sy = null;
    fig.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
    fig.addEventListener("pointerup", (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = sy = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2 && items.length > 1) show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });
    fig.addEventListener("pointercancel", () => { sx = sy = null; });
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target === inner) shut(); });

    lightbox = { open };
    return lightbox;
  }

  /* ---------- shared chrome: header name, footer ---------- */
  function renderChrome(person) {
    const n = splitName(person.name);
    const shortName = `${n.nick || n.first} ${n.last}`.trim() || "Portfolio";
    setText("short-name", shortName);
    setText("end-name", n.last || n.first);
    setText("copyright", `© ${new Date().getFullYear()} ${person.name || shortName}`);

    const links = arr(person.links).filter((l) => l && l.url);
    const linkItem = (l) => {
      const external = /^https?:/i.test(l.url);
      return h("li", null, h("a", { href: l.url, rel: external ? "noopener" : null, target: external ? "_blank" : null }, l.label || l.url));
    };
    bindAll("links").forEach((ul) => { ul.replaceChildren(...links.map(linkItem)); ul.hidden = !links.length; });

    const btn = bind("primary-contact");
    if (btn) {
      const mail = links.find((l) => /^mailto:/i.test(l.url));
      const first = mail || links[0];
      if (first) {
        btn.href = first.url;
        btn.textContent = mail ? "Say hello" : `Find me on ${first.label || "the web"}`;
        if (!mail && /^https?:/i.test(first.url)) { btn.target = "_blank"; btn.rel = "noopener"; }
      } else btn.textContent = "About me";
    }
    return { n, shortName, links, linkItem };
  }

  /* ---------- at a glance (home + about) ---------- */
  function renderGlance(projects) {
    const total = (f) => projects.reduce((s, p) => s + f(p), 0);
    const stats = [
      { label: "Projects", value: projects.length },
      { label: "Projects with print files", value: projects.filter((p) => arr(p.files).length).length },
      { label: "Photos of the real thing", value: total((p) => arr(p.photos).length) },
      { label: "Files to download", value: total((p) => arr(p.files).length) },
    ].filter((s) => s.value > 0);
    bindAll("glance").forEach((dl) => dl.replaceChildren(
      ...stats.map((s, i) =>
        h("div", { class: "glance-item", "data-reveal": "", style: `--i:${i}` },
          h("dt", null, s.label),
          h("dd", { text: String(s.value) })))));
  }

  /* ---------- cards ---------- */
  function card(p) {
    const c = coverFor(p);
    const frame = h("span", { class: "card-frame" },
      c ? picture(c.src, "", { fallback: c.full !== c.src ? c.full : null }) : null,
      h("span", { class: "card-ep", text: epLabel(p) }));
    if (!c) { frame.classList.add("is-missing"); frame.append(h("span", { class: "missing-note", text: "Pictures coming soon" })); }
    if (c && c.pos) frame.querySelectorAll("img").forEach((im) => { im.style.objectPosition = c.pos; });
    return h("a", { class: "card-link", href: workURL(p) },
      frame,
      h("span", { class: "card-body" },
        h("span", { class: "card-title", text: p.title }),
        h("span", { class: "card-meta", text: [p.category, formatDate(p.date)].filter(Boolean).join(" · ") }),
        p.summary ? h("span", { class: "card-sum", text: p.summary }) : null));
  }

  // Row patterns on a 6-column grid: a manga page of unequal panels, every row full.
  function rowSpans(count) {
    const rows = [[2, 2, 2], [4, 2], [3, 3], [2, 4]];
    const spans = [];
    let i = 0, r = 0;
    while (i < count) {
      const left = count - i;
      let row = rows[r % rows.length];
      if (left < row.length) row = { 1: [6], 2: [3, 3] }[left] || [2, 2, 2];
      spans.push(...row);
      i += row.length; r++;
    }
    return spans.slice(0, count);
  }
  function applyRowSpans(items) {
    rowSpans(items.length).forEach((c, k) => items[k].style.setProperty("--c", c));
  }

  /* ---------- gallery panels: [cols, rows] on 6 columns, and on 2 columns for phones ---------- */
  function panelSpans(count) {
    const desk = [];
    const groupA = [[4, 2], [2, 1], [2, 1], [3, 1], [3, 1]];
    const groupB = [[2, 1], [4, 2], [2, 1], [3, 1], [3, 1]];
    let i = 0, g = 0;
    while (count - i >= 5) { desk.push(...(g % 2 ? groupB : groupA)); i += 5; g++; }
    desk.push(...{ 0: [], 1: [[6, 2]], 2: [[3, 2], [3, 2]], 3: [[4, 2], [2, 1], [2, 1]], 4: [[4, 2], [2, 1], [2, 1], [6, 1]] }[count - i]);
    const phone = [];
    for (let j = 0; j < count; j++) phone.push(j % 3 === 0 ? [2, 1] : [1, 1]);
    if (count % 3 === 2) phone[count - 1] = [1, 1];
    return { desk, phone };
  }
  function applyPanelSpans(items) {
    const { desk, phone } = panelSpans(items.length);
    items.forEach((li, k) => {
      li.style.setProperty("--c", desk[k][0]);
      li.style.setProperty("--r", desk[k][1]);
      li.style.setProperty("--cm", phone[k][0]);
      li.style.setProperty("--rm", phone[k][1]);
    });
  }

  /* ---------- HOME ---------- */
  function renderHome(person, projects, chrome) {
    const { n } = chrome;
    const a = $(".hero-line--a");
    const b = $(".hero-line--b");
    a.replaceChildren(n.nick ? h("ruby", null, n.first, h("rp", { text: " (" }), h("rt", { text: n.nick }), h("rp", { text: ") " })) : n.first);
    b.textContent = n.last;
    b.hidden = !n.last;
    document.title = `${chrome.shortName} · Works`;
    setText("tagline", person.tagline || "");
    setText("intro", person.intro || "");

    // Hero cover: the first photograph of the first project that has one, linking to that project.
    const coverProject = projects.find((p) => arr(p.photos).length);
    const fig = $(".hero-cover");
    if (coverProject) {
      const ph = arr(coverProject.photos)[0];
      const frame = $(".hero-cover-frame", fig);
      frame.href = workURL(coverProject);
      frame.setAttribute("aria-label", `${epLabel(coverProject)}: ${coverProject.title}`);
      frame.append(picture(ph.src, ph.alt, { eager: true, host: frame, fallback: ph.thumb }));
      $(".hero-cover-cap", fig).textContent = ph.caption || coverProject.title;
      fig.hidden = false;
    }

    renderGlance(projects);

    // Featured: episodes 1–3
    bind("featured").replaceChildren(...projects.slice(0, 3).map((p, i) =>
      h("li", { class: `feature feature--${i + 1}`, "data-reveal": "", style: `--i:${i}` }, card(p))));

    // All episodes + filter chips
    const items = projects.map((p, i) => h("li", { class: "card", "data-category": p.category || "", "data-reveal": "", style: `--i:${i % 3}` }, card(p)));
    bind("cards").replaceChildren(...items);
    applyRowSpans(items);
    renderChips(projects, items);

    // Files teaser
    const all = projects.flatMap((p) => arr(p.files).map((f) => ({ f, p })));
    const bytes = all.reduce((s, { f }) => s + sizeBytes(f.size), 0);
    const withFiles = new Set(all.map(({ p }) => p.id)).size;
    setText("files-summary", all.length
      ? `${all.length} download${all.length === 1 ? "" : "s"} from ${withFiles} project${withFiles === 1 ? "" : "s"}${bytes ? `, ${formatBytes(bytes)} in all` : ""}. Free to print.`
      : "Print files will appear here as projects are published.");
    const sample = bind("files-sample");
    if (sample) sample.replaceChildren(...all.slice(0, 4).map(({ f, p }) =>
      h("li", null, h("a", { href: workURL(p) },
        h("span", { class: "fts-ep", text: epLabel(p) }),
        h("span", { class: "fts-label", text: f.label || f.href }),
        h("span", { class: "fts-meta", text: [fileExt(f.href), f.size].filter(Boolean).join(" · ") })))));

    fitName();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitName);
    let raf = 0;
    window.addEventListener("resize", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitName); });

    if (location.hash === "#works") requestAnimationFrame(() => $("#works").scrollIntoView());
  }

  function renderChips(projects, items) {
    const cats = [];
    for (const p of projects) if (p.category && !cats.includes(p.category)) cats.push(p.category);
    const wrap = bind("chips");
    const status = bind("filter-status");
    if (cats.length < 2) { wrap.hidden = true; return; }
    const make = (label, value, count) =>
      h("button", { type: "button", class: "chip", "aria-pressed": value === "" ? "true" : "false", "data-value": value },
        label, h("span", { class: "chip-count", text: String(count), "aria-hidden": "true" }));
    const chips = [make("All", "", projects.length), ...cats.map((c) => make(c, c, projects.filter((p) => p.category === c).length))];
    wrap.replaceChildren(...chips);
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const value = b.dataset.value;
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.value === value)));
      const shown = items.filter((li) => { const on = !value || li.dataset.category === value; li.hidden = !on; return on; });
      shown.forEach((li) => li.classList.add("is-in"));
      applyRowSpans(shown);
      status.textContent = value ? `Showing ${shown.length} of ${projects.length}: ${value}` : `Showing all ${projects.length}`;
    });
  }

  /* The name fills the width: size it so the longest line meets both margins. */
  function fitName() {
    const nameEl = $(".hero-name");
    if (!nameEl) return;
    const lines = $$(".hero-line", nameEl).filter((l) => !l.hidden);
    if (!lines.length) return;
    const hero = $(".hero");
    const cs = getComputedStyle(hero);
    const avail = hero.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    nameEl.style.fontSize = "100px";
    // offsetWidth ignores the entrance transform, so measuring mid-animation is safe.
    const widest = Math.max(...lines.map((l) => ($("ruby", l) || l).offsetWidth));
    if (!widest) return;
    // Fill the width, but on desktop keep both halves on the first screen.
    const capH = window.innerWidth >= 760 ? window.innerHeight * 0.155 : Infinity;
    nameEl.style.fontSize = `${Math.min(260, capH, Math.max(40, Math.floor((100 * avail) / widest) - 1))}px`;
  }

  /* ---------- WORK (one template for every project) ---------- */
  function shot(item, kind, media, idx, title) {
    const frame = h("button", { type: "button", class: "shot-frame", "aria-label": `View larger: ${item.alt || title}` });
    frame.append(picture(item.src, item.alt, { host: frame }));
    frame.addEventListener("click", () => getLightbox().open(media, idx, frame));
    return h("figure", { class: `shot shot--${kind}`, "data-reveal": "", style: `--i:${kind === "file" ? 0 : 2}` },
      h("p", { class: "shot-tag" },
        kind === "file" ? "The file" : "The real print"),
      frame,
      item.caption ? h("figcaption", { text: item.caption }) : null);
  }

  function gallery(list, kind, media, offset, p) {
    if (!list.length) return null;
    const isFile = kind === "file";
    const tiles = list.map((m, j) => {
      const src = m.thumb || m.src;
      const btn = h("button", { type: "button", class: "tile", "aria-label": `View larger: ${m.alt || p.title}` },
        picture(src, m.alt, { fallback: src !== m.src ? m.src : null }));
      btn.addEventListener("click", () => getLightbox().open(media, offset + j, btn));
      return h("li", { "data-reveal": "wipe", style: `--i:${j % 6}` }, btn);
    });
    const ol = h("ol", { class: "panels" }, tiles);
    applyPanelSpans(tiles);
    const id = `${kind}-gallery`;
    return h("section", { class: `gallery gallery--${kind}`, "aria-labelledby": id },
      h("div", { class: "gallery-head" },
        h("h2", { class: "gallery-title", id },
          isFile ? "The file" : "The real print"),
        h("p", { class: "gallery-note", text: isFile
          ? `${list.length} preview${list.length === 1 ? "" : "s"} of the 3D model, before printing.`
          : `${list.length} photo${list.length === 1 ? "" : "s"} of the real thing.` })),
      ol);
  }

  function fileList(files) {
    return h("ul", { class: "files" }, files.map((f) => h("li", null,
      h("a", { class: "file", href: f.href, download: "" },
        h("span", { class: "file-label", text: f.label || f.href }),
        h("span", { class: "file-meta", text: [fileExt(f.href), f.size].filter(Boolean).join(" · ") }),
        svg("0 0 24 24", "file-icon", [["path", { d: "M12 3v13M6 10l6 6 6-6M4 21h16" }]])))));
  }

  function renderWork(person, projects, chrome) {
    const main = bind("work");
    const id = new URLSearchParams(location.search).get("id") || "";
    const i = projects.findIndex((p) => p.id === id);

    if (i < 0) {
      document.title = `Episode not found · ${chrome.shortName}`;
      main.replaceChildren(
        h("section", { class: "lost", "aria-labelledby": "lost-title" },
          h("h1", { class: "lost-title", id: "lost-title", text: "This episode doesn't exist." }),
          h("p", { class: "lost-text", text: id ? `There's no project called "${id}". It may have been renamed.` : "The link didn't name a project." }),
          h("div", { class: "hero-actions" },
            h("a", { class: "btn", href: "./#works", text: "See every episode" }),
            h("a", { class: "link-arrow", href: "./", text: "Back to home" })),
          projects.length ? h("ol", { class: "lost-list" }, projects.map((p) =>
            h("li", null, h("a", { href: workURL(p) }, h("span", { text: epLabel(p) }), p.title)))) : null));
      return;
    }

    const p = projects[i];
    const photos = arr(p.photos);
    const renders = arr(p.renders);
    const files = arr(p.files);
    const story = arr(p.story);
    const highlights = arr(p.highlights);
    const tools = arr(p.tools);
    document.title = `${epLabel(p)} ${p.title} · ${chrome.shortName}`;
    const desc = $('meta[name="description"]');
    if (desc && p.summary) desc.setAttribute("content", p.summary);

    // One list for the lightbox: the real print first, then the file.
    const media = [
      ...photos.map((m) => ({ src: m.src, alt: m.alt, caption: m.caption, kind: "print" })),
      ...renders.map((m) => ({ src: m.src, alt: m.alt, caption: m.caption, kind: "file" })),
    ];

    const meta = [["Category", p.category], ["Date", formatDate(p.date)]].filter(([, v]) => v);
    const head = h("header", { class: "ch-head" },
      h("p", { class: "ch-ep", "data-reveal": "" }, h("span", { text: "EP." }), pad(p.episode)),
      h("h1", { class: "ch-title", "data-reveal": "", style: "--i:1" }, p.title),
      meta.length ? h("dl", { class: "ch-meta", "data-reveal": "", style: "--i:2" },
        meta.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v })))) : null);

    // The file → the real print, side by side, when both exist.
    let compare = null;
    if (renders.length && photos.length) {
      compare = h("div", { class: "compare" },
        shot(renders[0], "file", media, photos.length, p.title),
        h("div", { class: "compare-arrow", "data-reveal": "", style: "--i:1" },
          svg("0 0 120 60", null, [
            ["line", { x1: 4, y1: 18, x2: 70, y2: 18, class: "ar-line" }],
            ["line", { x1: 22, y1: 30, x2: 84, y2: 30, class: "ar-line" }],
            ["line", { x1: 10, y1: 42, x2: 70, y2: 42, class: "ar-line" }],
            ["path", { d: "M80 8 L116 30 L80 52 Z", class: "ar-head" }]]),
          h("p", { text: "printed" })),
        shot(photos[0], "print", media, 0, p.title));
    }

    const notes = [];
    if (highlights.length) notes.push(h("div", { "data-reveal": "", style: "--i:1" },
      h("h2", null, "Highlights"),
      h("ul", { class: "highlights" }, highlights.map((t) => h("li", { text: t })))));
    if (tools.length) notes.push(h("div", { "data-reveal": "", style: "--i:2" },
      h("h2", null, "Tools"),
      h("ul", { class: "tools" }, tools.map((t) => h("li", { text: t })))));
    if (files.length) notes.push(h("div", { "data-reveal": "", style: "--i:3", id: "downloads" },
      h("h2", null, "Print files"),
      fileList(files)));

    const body = (story.length || notes.length)
      ? h("div", { class: "ch-body" },
          story.length ? h("section", { class: "story", "aria-labelledby": "story-title", "data-reveal": "" },
            h("h2", { class: "story-title", id: "story-title" }, "The story"),
            story.map((t) => h("p", { text: t }))) : null,
          notes.length ? h("aside", { class: "notes", "aria-label": "Project details" }, notes) : null)
      : null;

    // Prev / next episode
    const prev = projects[i - 1], next = projects[i + 1];
    const pagerLink = (q, dir) => q
      ? h("a", { class: `pager-link pager-link--${dir}`, href: workURL(q), rel: dir },
          h("span", { class: "pager-dir", text: dir === "prev" ? `← ${epLabel(q)}` : `${epLabel(q)} →` }),
          h("span", { class: "pager-title", text: q.title }))
      : h("span", { class: `pager-link pager-link--${dir} pager-link--empty`, "aria-hidden": "true" });
    const pager = h("nav", { class: "pager", "aria-label": "Episodes" },
      pagerLink(prev, "prev"),
      h("a", { class: "pager-home", href: "./#works" }, "All episodes"),
      pagerLink(next, "next"));

    main.replaceChildren(
      h("nav", { class: "crumb", "aria-label": "Breadcrumb" },
        h("a", { href: "./", text: "Home" }), h("span", { "aria-hidden": "true", text: " / " }),
        h("a", { href: "./#works", text: "Works" }), h("span", { "aria-hidden": "true", text: " / " }),
        h("span", { "aria-current": "page", text: epLabel(p) })),
      h("article", { class: "chapter", "data-category": p.category || "" },
        head,
        p.summary ? h("p", { class: "ch-summary", "data-reveal": "" }, p.summary) : null,
        compare,
        body,
        gallery(photos, "print", media, 0, p),
        gallery(renders, "file", media, photos.length, p)),
      pager);
  }

  /* ---------- FILES ---------- */
  function renderFiles(person, projects) {
    const groups = projects.filter((p) => arr(p.files).length);
    const all = groups.flatMap((p) => arr(p.files));
    const bytes = all.reduce((s, f) => s + sizeBytes(f.size), 0);
    setText("files-summary", all.length
      ? `${all.length} download${all.length === 1 ? "" : "s"} from ${groups.length} project${groups.length === 1 ? "" : "s"}${bytes ? `, ${formatBytes(bytes)} in all` : ""}. Free to print. Each one links back to the project it came from.`
      : "No print files have been published yet.");
    bind("library").replaceChildren(...groups.map((p, i) => {
      const c = coverFor(p);
      const titleId = `lib-${p.id}`;
      const cover = h("a", { class: "lib-cover", href: workURL(p), tabindex: "-1", "aria-hidden": "true" },
        c ? picture(c.src, "", { fallback: c.full !== c.src ? c.full : null }) : null,
        h("span", { class: "card-ep", text: epLabel(p) }));
      if (!c) cover.classList.add("is-missing");
      return h("section", { class: "lib-group", "aria-labelledby": titleId, "data-reveal": "", style: `--i:${i % 3}` },
        cover,
        h("div", { class: "lib-text" },
          h("h2", { class: "lib-title", id: titleId }, h("a", { href: workURL(p), text: p.title })),
          h("p", { class: "lib-meta", text: [epLabel(p), p.category, formatDate(p.date)].filter(Boolean).join(" · ") })),
        h("div", { class: "lib-files" }, fileList(arr(p.files))));
    }));
  }

  /* ---------- ABOUT ---------- */
  function renderAbout(person, projects, chrome) {
    setText("about-name", person.name || chrome.shortName);
    setText("tagline", person.tagline || "");
    setText("intro", person.intro || "");
    document.title = `About · ${chrome.shortName}`;
    const ul = bind("about-links");
    ul.replaceChildren(...chrome.links.map(chrome.linkItem));
    if (!chrome.links.length) ul.closest(".about-links").hidden = true;
    const recent = projects.filter((p) => coverFor(p)).slice(0, 3);
    const items = recent.map((p, i) => h("li", { class: "card", "data-reveal": "", style: `--i:${i}` }, card(p)));
    bind("about-cards").replaceChildren(...items);
    applyRowSpans(items);
    renderGlance(projects);
  }

  /* ---------- reveal on scroll ---------- */
  function observeReveals() {
    const els = $$("[data-reveal]");
    if (!canAnimate()) { els.forEach((e) => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
    els.forEach((e) => io.observe(e));
  }

  function fail(err) {
    console.error(err);
    const msg = location.protocol === "file:"
      ? "This page reads projects.json, which browsers block when a file is opened straight from disk. Serve the folder (for example: python3 -m http.server) and open it from localhost."
      : "The project list could not be loaded. Please refresh the page.";
    $("main").replaceChildren(h("p", { class: "notice", role: "alert", text: msg }));
  }

  /* ---------- boot ---------- */
  async function boot() {
    let data;
    try {
      const res = await fetch("projects.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`projects.json: HTTP ${res.status}`);
      data = await res.json();
    } catch (e) { fail(e); return; }

    const person = data.person || {};
    const projects = arr(data.projects)
      .map((p, k) => ({ ...p, episode: Number.isFinite(p.episode) ? p.episode : k + 1 }))
      .sort((a, b) => a.episode - b.episode);
    const chrome = renderChrome(person);
    const page = document.body.dataset.page;

    if (page === "home") renderHome(person, projects, chrome);
    else if (page === "work") renderWork(person, projects, chrome);
    else if (page === "files") renderFiles(person, projects);
    else if (page === "about") renderAbout(person, projects, chrome);

    observeReveals();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
