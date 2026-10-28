// IDM-style "Download this video" button shown over videos while the pointer is on them.
// The button lives in a closed Shadow DOM so the page's styles cannot affect it (or vice versa).
(() => {
  if (window.__swiftgetButton) return;
  window.__swiftgetButton = true;

  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 120;
  const HIDE_DELAY = 2500;

  let host = null;
  let ui = null;
  let current = null; // the <video>/<audio> the button belongs to
  let hideTimer = 0;
  let lastMove = 0;
  let busy = false;

  const ICON =
    '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 1.5h4v5.5h3L8 12.5 3 7h3z" fill="#fff"/><rect x="3" y="13.5" width="10" height="1.6" rx=".8" fill="#fff"/></svg>';

  function build() {
    host = document.createElement("div");
    host.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;display:none;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #111; position: relative; }
        .btn { display: flex; align-items: center; gap: 6px; padding: 6px 11px 6px 9px; border: 0; border-radius: 5px;
               background: linear-gradient(#1fb7a6, #0b6e8a); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
               box-shadow: 0 2px 8px rgba(0,0,0,.35); white-space: nowrap; }
        .btn:hover { filter: brightness(1.08); }
        .close { position: absolute; top: -7px; right: -7px; width: 17px; height: 17px; border-radius: 50%; border: 0;
                 background: #333; color: #fff; font: 11px/17px sans-serif; text-align: center; cursor: pointer; padding: 0; display: none; }
        .wrap:hover .close { display: block; }
        .menu { position: absolute; right: 0; top: calc(100% + 4px); min-width: 300px; max-width: 420px; background: #fff;
                border: 1px solid #c8c8c8; border-radius: 5px; box-shadow: 0 6px 20px rgba(0,0,0,.3); padding: 4px 0; }
        .menu .head { padding: 4px 10px 6px; color: #555; font-size: 12px; }
        .item { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer; }
        .item:hover { background: #e5f3ff; }
        .item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: #e8f1fb; color: #1565c0; }
        .size { color: #666; font-size: 12px; }
        .note { padding: 8px 10px; max-width: 300px; color: #333; }
      </style>
      <div class="wrap">
        <button class="btn" type="button">${ICON}<span class="label">Download this video</span></button>
        <button class="close" type="button" title="Hide for this video">✕</button>
        <div class="menu" hidden></div>
      </div>`;
    ui = {
      btn: root.querySelector(".btn"),
      label: root.querySelector(".label"),
      close: root.querySelector(".close"),
      menu: root.querySelector(".menu"),
      wrap: root.querySelector(".wrap"),
    };
    ui.btn.addEventListener("click", onDownloadClick);
    ui.close.addEventListener("click", () => {
      if (current) current.dataset.swiftgetHidden = "1";
      hide();
    });
    host.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    host.addEventListener("mouseleave", scheduleHide);
    (document.body || document.documentElement).appendChild(host);
  }

  function mediaAt(x, y) {
    for (const v of document.querySelectorAll("video")) {
      if (v.dataset.swiftgetHidden) continue;
      const r = v.getBoundingClientRect();
      if (r.width < MIN_WIDTH || r.height < MIN_HEIGHT) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  function place() {
    if (!current || !host) return;
    const r = current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width === 0) return hide();
    const width = ui.wrap.offsetWidth || 170;
    host.style.top = `${Math.max(6, r.top + 10)}px`;
    host.style.left = `${Math.min(innerWidth - width - 6, Math.max(6, r.right - width - 10))}px`;
  }

  function show(video) {
    if (!host) build();
    clearTimeout(hideTimer);
    if (current !== video) {
      current = video;
      resetMenu();
    }
    host.style.display = "block";
    place();
  }

  function hide() {
    if (!host) return;
    host.style.display = "none";
    resetMenu();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!ui.menu.hidden) return; // keep the list open until the user chooses or moves on
      hide();
    }, HIDE_DELAY);
  }

  function resetMenu() {
    if (!ui) return;
    ui.menu.hidden = true;
    ui.menu.textContent = "";
    ui.label.textContent = "Download this video";
  }

  function flash(text) {
    ui.label.textContent = text;
    setTimeout(() => ui && (ui.label.textContent = "Download this video"), 2500);
  }

  function formatSize(n) {
    if (!n) return "";
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    return `${Math.round(n / 1024)} KB`;
  }

  function nameOf(url) {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop()) || url;
    } catch {
      return url;
    }
  }

  async function send(entry) {
    ui.menu.hidden = true;
    ui.label.textContent = "Sending to SwiftGet…";
    const res = await chrome.runtime.sendMessage({ type: "download-media", entry, title: document.title, pageUrl: location.href });
    flash(res?.ok ? "Sent to SwiftGet ✓" : "SwiftGet is not running");
  }

  async function onDownloadClick() {
    if (busy || !current) return;
    if (!ui.menu.hidden) {
      ui.menu.hidden = true;
      return;
    }
    busy = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "video-candidates", src: current.currentSrc || current.src });
      if (!res?.app) return flash("SwiftGet is not running");
      const list = res.candidates || [];
      if (list.length === 0) {
        ui.menu.innerHTML = '<div class="note">No downloadable stream found yet. Let the video play for a few seconds, then try again.</div>';
        ui.menu.hidden = false;
        return;
      }
      if (list.length === 1) return send(list[0]);

      ui.menu.textContent = "";
      const head = document.createElement("div");
      head.className = "head";
      head.textContent = "Choose what to download (best first):";
      ui.menu.append(head);
      for (const entry of list) {
        const item = document.createElement("div");
        item.className = "item";
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = entry.kind === "hls" ? "HLS" : (entry.ext || "file").toUpperCase();
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = nameOf(entry.url);
        name.title = entry.url;
        const size = document.createElement("span");
        size.className = "size";
        size.textContent = formatSize(entry.size);
        item.append(tag, name, size);
        item.addEventListener("click", () => send(entry));
        ui.menu.append(item);
      }
      ui.menu.hidden = false;
    } catch {
      flash("Extension was updated, reload the page");
    } finally {
      busy = false;
    }
  }

  // Videos are often covered by the player's own controls, so hit-test the pointer instead of
  // relying on mouseenter on the <video> element.
  document.addEventListener(
    "mousemove",
    (e) => {
      const now = Date.now();
      if (now - lastMove < 120) return;
      lastMove = now;
      if (host && host.contains(e.target)) return;
      const v = mediaAt(e.clientX, e.clientY);
      if (v) show(v);
      else if (host && host.style.display !== "none") scheduleHide();
    },
    { passive: true },
  );
  addEventListener("scroll", place, { passive: true, capture: true });
  addEventListener("resize", place, { passive: true });
  document.addEventListener("fullscreenchange", hide);
})();
