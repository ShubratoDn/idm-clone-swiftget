# Changelog

All notable changes to SwiftGet are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-10-28

### Added

- "Download this video" button over videos on web pages (browser extension). When several streams are
  found, it lists them best first.

### Fixed

- The About dialog shows the real app version instead of a fixed number.
- Videos played by a normal `<video>` element (for example on Fiverr) were not detected, because the
  browser streams them with byte-range requests (HTTP 206). They are now detected with their full size
  and downloaded from the first byte, however much the page has already played.

## [1.0.0] - 2026-10-27

First public release.

### Added

- Multi-connection segmented downloading (1–32 connections per file) over separate HTTP/1.1 connections.
- Dynamic segmentation: connections that finish early take over half of the largest remaining range.
- Resume for paused, failed and interrupted downloads, with a size/ETag check that restarts changed files.
- Graceful handling of servers that cap connections or rate-limit (HTTP 429/503, `Retry-After`).
- Download queue with a configurable number of simultaneous downloads.
- Scheduler: start and stop the queue at set times on chosen days; exit, sleep or shut down when done.
- Global speed limiter shared by all connections.
- HLS (`.m3u8`) video downloads with best-variant selection, AES-128 decryption and optional MP4 remux via ffmpeg.
- Chrome/Edge extension: download capture with cookies and referrer, "Download with SwiftGet" context menu,
  and detection of video/audio streams on pages.
- Classic desktop interface: categories tree, download list, Download File Info dialog, per-download progress
  window with a connection map, Download complete dialog, Options and Scheduler dialogs.
- Resuming a download reopens its progress window; "Show download progress" in the right-click menu.
- Automatic file categories (Compressed, Documents, Music, Programs, Video) with per-category folders.
- System tray icon, close to tray, launch at Windows startup, clipboard URL prefill, single-instance app.
- NSIS (`.exe`) and MSI installers.

[Unreleased]: https://github.com/ShubratoDn/idm-clone-swiftget/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/ShubratoDn/idm-clone-swiftget/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ShubratoDn/idm-clone-swiftget/releases/tag/v1.0.0
