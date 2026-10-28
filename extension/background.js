// SwiftGet browser integration (Chrome / Edge, Manifest V3).
// Talks to the desktop app over http://127.0.0.1:<port>, which only accepts extension origins.

import { classify, downloadPayload, rankCandidates, stripRangeParams } from "./media.js";

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
const MAX_MEDIA_PER_TAB = 30;

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const header = (n) => details.responseHeaders?.find((h) => h.name.toLowerCase() === n)?.value;
    const entry = classify({
      url: details.url,
      type: details.type,
      statusCode: details.statusCode,
      contentType: header("content-type"),
      contentRange: header("content-range"),
      contentLength: header("content-length"),
    });
    if (entry) recordMedia(details.tabId, { ...entry, at: Date.now() });
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders"],
);

async function mediaFor(tabId) {
  const key = MEDIA_KEY(tabId);
  return (await chrome.storage.session.get({ [key]: [] }))[key];
}

async function recordMedia(tabId, entry) {
  const list = await mediaFor(tabId);
  const existing = list.find((m) => m.url === entry.url);
  if (existing) {
    // A later response may reveal the size (e.g. the first one was "bytes 0-1/*").
    if (!existing.size && entry.size) {
      existing.size = entry.size;
      await chrome.storage.session.set({ [MEDIA_KEY(tabId)]: list });
    }
    return;
  }
  list.push(entry);
  await chrome.storage.session.set({ [MEDIA_KEY(tabId)]: list.slice(-MAX_MEDIA_PER_TAB) });
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

/** Candidates for the on-page button: the video's own address first (when it is a real URL), then what the tab loaded. */
async function videoCandidates(tabId, src) {
  const found = rankCandidates(await mediaFor(tabId));
  if (src && /^https?:/i.test(src)) {
    const clean = stripRangeParams(src);
    const known = found.find((m) => m.url === clean);
    const direct = known ?? {
      kind: /\.m3u8(\?|#|$)/i.test(clean) ? "hls" : "http",
      url: clean,
      size: null,
      ext: (/\.(\w{2,4})(\?|#|$)/.exec(new URL(clean).pathname)?.[1] ?? "mp4").toLowerCase(),
    };
    return [direct, ...found.filter((m) => m !== known)];
  }
  return found; // blob:/MediaSource players: only the network log knows the real address
}

// ---------- messages from the popup and the on-page button ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const cfg = await config();
    switch (msg.type) {
      case "status":
        reply({ cfg, app: await appInfo(cfg.port) });
        break;
      case "media-list":
        reply({ media: rankCandidates(await mediaFor(msg.tabId)) });
        break;
      case "video-candidates": {
        const app = await appInfo(cfg.port);
        const candidates = sender.tab ? await videoCandidates(sender.tab.id, msg.src) : [];
        reply({ app: Boolean(app), candidates: candidates.slice(0, 8) });
        break;
      }
      case "download-media": {
        const payload = downloadPayload(msg.entry, msg.title ?? sender.tab?.title, msg.pageUrl ?? sender.tab?.url);
        reply({ ok: await sendToApp(cfg.port, payload) });
        break;
      }
      default:
        reply(null);
    }
  })();
  return true; // async reply
});
