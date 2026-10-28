import { displayName, formatSize } from "./media.js";

const $ = (id) => document.getElementById(id);

async function init() {
  const { cfg, app } = await chrome.runtime.sendMessage({ type: "status" });
  const status = $("status");
  status.textContent = app ? `connected · v${app.version}` : "app not running";
  status.className = `pill ${app ? "on" : "off"}`;

  $("enabled").checked = cfg.enabled;
  $("port").value = cfg.port;
  $("minSize").value = cfg.minSizeKB;
  $("enabled").onchange = (e) => chrome.storage.local.set({ enabled: e.target.checked });
  $("port").onchange = (e) => chrome.storage.local.set({ port: Number(e.target.value) || 52817 });
  $("minSize").onchange = (e) => chrome.storage.local.set({ minSizeKB: Math.max(0, Number(e.target.value) || 0) });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const { media } = await chrome.runtime.sendMessage({ type: "media-list", tabId: tab.id });
  if (!media.length) return;

  const box = $("media");
  box.textContent = "";
  for (const m of media) {
    const row = document.createElement("div");
    row.className = "item";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = m.kind === "hls" ? "HLS" : (m.ext || "file").toUpperCase();
    const name = document.createElement("span");
    name.className = "name";
    name.title = m.url;
    name.textContent = `${displayName(m.url)} ${formatSize(m.size)}`;
    const btn = document.createElement("button");
    btn.textContent = "Download";
    btn.onclick = async () => {
      const { ok } = await chrome.runtime.sendMessage({ type: "download-media", entry: m, title: tab.title, pageUrl: tab.url });
      btn.textContent = ok ? "Sent ✓" : "Failed";
      btn.disabled = ok;
    };
    row.append(tag, name, btn);
    box.append(row);
  }
}

init();
