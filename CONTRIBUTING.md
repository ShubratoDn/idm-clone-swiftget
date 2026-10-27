# Contributing to SwiftGet

Thanks for your interest in improving SwiftGet! Bug reports, feature ideas and pull requests are all welcome.

## Reporting bugs and requesting features

- Search [existing issues](https://github.com/ShubratoDn/idm-clone-swiftget/issues) first.
- Use the **Bug report** or **Feature request** template and include your SwiftGet and Windows versions.
- Never paste private, signed or authenticated download links. Report security problems privately
  (see [SECURITY.md](SECURITY.md)).

## Development setup

Requirements:

- Windows 10 or 11 with [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (included in Windows 11)
- [Rust](https://rustup.rs/) stable with the MSVC toolchain and Visual Studio Build Tools (C++ workload)
- [Node.js](https://nodejs.org/) 20 or newer

```powershell
git clone https://github.com/ShubratoDn/idm-clone-swiftget.git
cd idm-clone-swiftget
npm install
npx tauri dev
```

`npx tauri dev` starts the Vite dev server and the desktop app with hot reload for the UI.
Rust changes rebuild and restart the app automatically.

## Before opening a pull request

```powershell
npm run build              # TypeScript type-check + production bundle
cd src-tauri
cargo test                 # unit tests + end-to-end engine tests
cargo fmt --check
```

The engine tests start a local HTTP server that throttles every connection, so they verify both
correctness (byte-for-byte file comparison, pause/resume) and the multi-connection speed-up.

Guidelines:

- Keep pull requests focused on one change and describe how you tested it.
- Match the existing code style: small, well-named functions, comments that explain *why*.
- Add or update tests for engine changes (`src-tauri/src/engine`).
- For UI changes, include before/after screenshots.

## Project structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the download engine, manager and UI fit together.

## Releasing (maintainers)

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and
   `extension/manifest.json`.
2. Add the release to [CHANGELOG.md](CHANGELOG.md) and write `docs/release-notes/vX.Y.Z.md`.
3. Commit, then tag and push:

   ```powershell
   git tag -a vX.Y.Z -m "SwiftGet vX.Y.Z"
   git push origin main --tags
   ```

The [Release workflow](.github/workflows/release.yml) runs the tests, builds the installers and the
browser-extension zip, and publishes them with SHA-256 checksums on the
[Releases page](https://github.com/ShubratoDn/idm-clone-swiftget/releases).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
