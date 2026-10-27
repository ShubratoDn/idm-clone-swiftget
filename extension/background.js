// SwiftGet browser integration (Chrome / Edge, Manifest V3).
// Talks to the desktop app over http://127.0.0.1:<port>, which only accepts extension origins.

const DEFAULTS = { enabled: true, port: 52817, minSizeKB: 0 };
const BYPASS_MS = 15000;

// URLs the user chose to download in the browser after SwiftGet was unreachable.
const bypass = new Map();

async function config() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function appInfo(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function cookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

async function sendToApp(port, payload) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SwiftGet": "1" },
      body: JSON.stringify({ userAgent: navigator.userAgent, ...payload, cookies: await cookieHeader(payload.url) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function extensionOf(name) {
  const clean = (name || "").split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toUpperCase() : "";
}

function matchesList(ext, list) {
  if (!ext) return false;
  return list
    .split(/\s+/)
    .filter(Boolean)
    .some((p) => (p.endsWith("*") ? ext.startsWith(p.slice(0, -1).toUpperCase()) : ext === p.toUpperCase()));
}

// ---------- download interception ----------

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return; // blob:, data: and file: stay in the browser
  const until = bypass.get(url);
  if (until && until > Date.now()) {
    bypass.delete(url);
    return;
  }

  const cfg = await config();
  if (!cfg.enabled) return;
  if (cfg.minSizeKB > 0 && item.fileSize > 0 && item.fileSize < cfg.minSizeKB * 1024) return;

  const info = await appInfo(cfg.port);
  if (!info) return; // app not running: let the browser download normally

  const ext = extensionOf(item.filename) || extensionOf(url);
  const typed = matchesList(ext, info.extensions || "");
  const binaryMime = /^(application\/(octet-stream|zip|x-|vnd\.)|video\/|audio\/)/i.test(item.mime || "");
  if (!typed && !binaryMime) return;

  try {
    await chrome.downloads.cancel(item.id);
  } catch {
    /* already finished */
  }

  const fileName = item.filename ? item.filename.split(/[\\/]/).pop() : null;
  const ok = await sendToApp(cfg.port, { url, referrer: item.referrer || null, fileName });
  if (ok) {
    chrome.downloads.erase({ id: item.id }).catch(() => {});
  } else {
    bypass.set(url, Date.now() + BYPASS_MS);
    chrome.downloads.download({ url });
  }
});

// ---------- context menu ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "swg-link", title: "Download with SwiftGet", contexts: ["link"] });
  chrome.contextMenus.create({ id: "swg-media", title: "Download this video/audio with SwiftGet", contexts: ["video", "audio"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const cfg = await config();
  const url = info.menuItemId === "swg-link" ? info.linkUrl : info.srcUrl;
  if (!url || !/^https?:/i.test(url)) return;
  const ok = await sendToApp(cfg.port, { url, referrer: info.pageUrl || tab?.url || null });
  if (!ok) notifyOffline();
});

function notifyOffline() {
  chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
  chrome.action.setBadgeText({ text: "off" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

// ---------- video stream detection ----------

const MEDIA_KEY = (tabId) => `media_${tabId}`;

function mediaKind(url, contentType) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  const ct = (contentType || "").toLowerCase();
  if (path.endsWith(".m3u8") || ct.includes("mpegurl")) return "hls";
  if (/\.(mp4|webm|mkv|mov|m4v|mp3|m4a|flac)$/.test(path) || /^(video|audio)\//.test(ct)) return "http";
  return null;
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const header = (n) => details.responseHeaders?.find((h) => h.name.toLowerCase() === n)?.value;
    const kind = mediaKind(details.url, header("content-type"));
    if (!kind) return;
    const length = Number(header("content-length") || 0);
    // Skip tiny files and individual stream chunks.
    if (kind === "http" && (details.statusCode === 206 || (length > 0 && length < 512 * 1024))) return;
    recordMedia(details.tabId, { url: details.url, kind, size: length || null, at: Date.now() });
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders"],
);

async function recordMedia(tabId, entry) {
  const key = MEDIA_KEY(tabId);
  const store = await chrome.storage.session.get({ [key]: [] });
  const list = store[key];
  if (list.some((m) => m.url === entry.url)) return;
  list.push(entry);
  await chrome.storage.session.set({ [key]: list.slice(-30) });
  chrome.action.setBadgeBackgroundColor({ color: "#0b6e8a", tabId });
  chrome.action.setBadgeText({ text: String(Math.min(list.length, 99)), tabId });
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" && change.url) {
    chrome.storage.session.remove(MEDIA_KEY(tabId));
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(MEDIA_KEY(tabId)));

// ---------- popup messages ----------

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    const cfg = await config();
    if (msg.type === "status") {
      reply({ cfg, app: await appInfo(cfg.port) });
    } else if (msg.type === "download") {
      reply({ ok: await sendToApp(cfg.port, msg.payload) });
    }
  })();
  return true; // async reply
});
