# Project delivery / releases

The project owner has asked that every version be published on GitHub.

- Keep source changes on the session's current working branch; never switch branches to publish.
- Ship each new version as a separate GitHub Release in `UsmanMusav/Backrooms`, including the Windows x64 EXE, SHA-256, Russian instructions and third-party notices.
- Bump `package.json` and its lockfile, and add a matching section to `CHANGELOG.md`, before shipping a changed executable. Version labels, filenames and PE metadata are derived from `package.json`.
- Never overwrite published releases, tags or assets (`--clobber` is forbidden). Fixes use a new version number. Do not invent or relabel unavailable historical builds.
- `.github/workflows/windows.yml` tests/builds on Windows and publishes a previously unpublished version on push. An unchanged version is built/tested but an existing release is preserved. All releases are currently pre-releases pending manual Windows GUI validation/signing.
- Do not add generated binaries, `artifacts/`, `.cache/`, `.desktop/`, `dist/` or `node_modules/` to Git. Attach binaries to Releases instead.
- Continue to disclose WebView2 and Visual C++ x64 requirements, unsigned builds, LAN/NAT limitations, and which Windows/browser checks have actually run. Do not claim the Windows GUI has been tested from a server-only smoke test.
- Use `git` for commits/pushes and `gh` for GitHub operations. Never request or store credentials in chat.
