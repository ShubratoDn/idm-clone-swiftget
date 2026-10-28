// Run with: node --test extension/
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, downloadPayload, rankCandidates, stripRangeParams, totalSize } from "./media.js";

const MB = 1024 * 1024;

test("a <video> file streamed with byte ranges (206) is detected with its full size", () => {
  const entry = classify({
    url: "https://cdn.example.com/video/upload/gig-intro.mp4",
    type: "media",
    statusCode: 206,
    contentType: "video/mp4",
    contentRange: `bytes 0-1048575/${48 * MB}`,
    contentLength: String(MB),
  });
  assert.deepEqual(entry, { kind: "http", url: "https://cdn.example.com/video/upload/gig-intro.mp4", size: 48 * MB, ext: "mp4" });
});

test("a <video> file without an extension is detected from the media element and content type", () => {
  const entry = classify({ url: "https://cdn.example.com/v/9f8e7d", type: "media", statusCode: 206, contentType: "video/webm", contentRange: `bytes 0-99/${20 * MB}` });
  assert.equal(entry.kind, "http");
  assert.equal(entry.ext, "webm");
});

test("slice parameters are removed so the download starts from the first byte", () => {
  const entry = classify({ url: "https://video.example.com/clip.mp4?bytestart=1048576&byteend=2097151&token=abc", type: "media", statusCode: 200, contentType: "video/mp4", contentLength: String(MB) });
  assert.equal(entry.url, "https://video.example.com/clip.mp4?token=abc");
  assert.equal(stripRangeParams("https://x.com/a.mp4?range=0-100"), "https://x.com/a.mp4");
});

test("pieces fetched by script players (MediaSource) are ignored", () => {
  // No file extension: a stream piece, not a playable file.
  assert.equal(classify({ url: "https://rr1.example.com/videoplayback?itag=137&range=0-500000", type: "xmlhttprequest", statusCode: 200, contentType: "video/mp4", contentLength: String(2 * MB) }), null);
  assert.equal(classify({ url: "https://cdn.example.com/seg/chunk-12.m4s", type: "xmlhttprequest", statusCode: 200, contentType: "video/mp4", contentLength: String(2 * MB) }), null);
  // Named file, but only a slice of it.
  assert.equal(classify({ url: "https://cdn.example.com/a.mp4?range=0-99999", type: "xmlhttprequest", statusCode: 200, contentType: "video/mp4" }), null);
});

test("small files, pages and DASH manifests are ignored", () => {
  assert.equal(classify({ url: "https://x.com/beep.mp3", type: "media", statusCode: 200, contentType: "audio/mpeg", contentLength: "40000" }), null);
  assert.equal(classify({ url: "https://x.com/watch", type: "media", statusCode: 200, contentType: "text/html" }), null);
  assert.equal(classify({ url: "https://x.com/manifest.mpd", type: "xmlhttprequest", statusCode: 200, contentType: "application/dash+xml" }), null);
  assert.equal(classify({ url: "https://x.com/a.mp4", type: "media", statusCode: 404, contentType: "video/mp4" }), null);
});

test("HLS playlists are detected", () => {
  const entry = classify({ url: "https://x.com/hls/master.m3u8?sig=1", type: "xmlhttprequest", statusCode: 200, contentType: "application/vnd.apple.mpegurl" });
  assert.equal(entry.kind, "hls");
});

test("total size comes from Content-Range for partial replies", () => {
  assert.equal(totalSize(206, "bytes 0-1/5000000", "2"), 5000000);
  assert.equal(totalSize(206, "bytes 0-1/*", "2"), null);
  assert.equal(totalSize(200, undefined, "1234"), 1234);
});

test("candidates are ranked HLS first, then larger files first", () => {
  const ranked = rankCandidates([
    { kind: "http", url: "small", size: 2 * MB },
    { kind: "hls", url: "master" },
    { kind: "http", url: "big", size: 90 * MB },
  ]);
  assert.deepEqual(ranked.map((m) => m.url), ["master", "big", "small"]);
});

test("downloads are named after the page title", () => {
  const p = downloadPayload({ kind: "http", url: "https://cdn/x.mp4", ext: "mp4" }, 'I will do: "Spring Boot" / React | Fiverr', "https://www.fiverr.com/gig");
  assert.equal(p.fileName, "I will do Spring Boot React Fiverr.mp4");
  assert.equal(p.referrer, "https://www.fiverr.com/gig");
});
