// Rules for recognising downloadable video/audio in network traffic.
// Kept free of chrome.* APIs so they can be unit-tested with Node (see media.test.mjs).

export const MIN_MEDIA_BYTES = 512 * 1024;

// Query parameters some players use to fetch one slice of a file (e.g. ?bytestart=0&byteend=99999).
const RANGE_PARAMS = ["range", "bytestart", "byteend"];
const MEDIA_EXT = /\.(mp4|webm|mkv|mov|m4v|mp3|m4a|flac|ogg|oga|wav|aac)$/;
const CT_EXT = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/wav": "wav",
};

export function hasRangeParam(url) {
  try {
    const u = new URL(url);
    return RANGE_PARAMS.some((p) => u.searchParams.has(p));
  } catch {
    return false;
  }
}

/** Removes slice parameters so the whole file is downloaded from the first byte. */
export function stripRangeParams(url) {
  try {
    const u = new URL(url);
    RANGE_PARAMS.forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

/** Full file size: the total from "Content-Range: bytes 0-99/12345", else Content-Length. */
export function totalSize(statusCode, contentRange, contentLength) {
  if (statusCode === 206 && contentRange) {
    const m = /\/(\d+)\s*$/.exec(contentRange);
    if (m) return Number(m[1]);
    return null; // "bytes 0-99/*": total unknown
  }
  const n = Number(contentLength);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Decides whether a response is a downloadable media file.
 * Returns { kind: "hls" | "http", url, size, ext } or null.
 *
 * Browsers fetch <video>/<audio> files with byte ranges, so a 206 reply is normal and is
 * accepted; the recorded URL points at the whole file. Pieces fetched by script players
 * (Media Source Extensions) are skipped, because one piece alone is not a playable video.
 */
export function classify({ url, type, statusCode, contentType, contentRange, contentLength }) {
  if (!/^https?:/i.test(url)) return null;
  if (statusCode !== 200 && statusCode !== 206) return null;
  const path = url.split(/[?#]/)[0].toLowerCase();
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();

  if (path.endsWith(".m3u8") || ct.includes("mpegurl")) {
    return { kind: "hls", url, size: null, ext: "ts" };
  }
  if (path.endsWith(".mpd") || ct.includes("dash+xml")) return null; // DASH is not supported yet
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || ct.startsWith("image/")) return null;

  const extMatch = MEDIA_EXT.exec(path);
  const fromMediaElement = type === "media";
  if (!fromMediaElement) {
    // Script-driven requests only count when they name a media file and fetch all of it.
    if (!extMatch || hasRangeParam(url)) return null;
  }

  const size = totalSize(statusCode, contentRange, contentLength);
  if (size != null && size < MIN_MEDIA_BYTES) return null;

  const ext = extMatch?.[1] ?? CT_EXT[ct] ?? "mp4";
  return { kind: "http", url: stripRangeParams(url), size, ext };
}

/** Best choices first: HLS playlists in the order seen (the master usually comes first), then files by size. */
export function rankCandidates(list) {
  const hls = list.filter((m) => m.kind === "hls");
  const files = list.filter((m) => m.kind !== "hls").sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return [...hls, ...files];
}

export function safeTitle(title) {
  const t = (title || "video").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return (t || "video").slice(0, 120);
}

/** What to send to SwiftGet for a detected entry: the page title makes a better name than a CDN hash. */
export function downloadPayload(entry, pageTitle, pageUrl) {
  return {
    url: entry.url,
    referrer: pageUrl || null,
    kind: entry.kind,
    fileName: `${safeTitle(pageTitle)}.${entry.ext || (entry.kind === "hls" ? "ts" : "mp4")}`,
  };
}

export function displayName(url) {
  try {
    const last = new URL(url).pathname.split("/").pop();
    return decodeURIComponent(last) || url;
  } catch {
    return url;
  }
}

export function formatSize(n) {
  if (!n) return "";
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
