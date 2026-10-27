const $ = (id) => document.getElementById(id);

function nameOf(url) {
  try {
    const p = new URL(url).pathname.split("/").pop();
    return decodeURIComponent(p) || url;
  } catch {
    return url;
  }
}

function formatSize(n) {
  if (!n) return "";
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

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
  const key = `media_${tab.id}`;
  const list = (await chrome.storage.session.get({ [key]: [] }))[key];
  if (!list.length) return;

  const box = $("media");
  box.textContent = "";
  for (const m of list) {
    const row = document.createElement("div");
    row.className = "item";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = m.kind === "hls" ? "HLS" : "FILE";
    const name = document.createElement("span");
    name.className = "name";
    name.title = m.url;
    name.textContent = `${nameOf(m.url)} ${formatSize(m.size)}`;
    const btn = document.createElement("button");
    btn.textContent = "Download";
    btn.onclick = async () => {
      const title = (tab.title || "video").replace(/[<>:"/\\|?*]+/g, " ").trim().slice(0, 120);
      const payload = { url: m.url, referrer: tab.url, kind: m.kind };
      if (m.kind === "hls") payload.fileName = `${title}.ts`;
      const { ok } = await chrome.runtime.sendMessage({ type: "download", payload });
      btn.textContent = ok ? "Sent ✓" : "Failed";
      btn.disabled = ok;
    };
    row.append(tag, name, btn);
    box.append(row);
  }
}

init();
