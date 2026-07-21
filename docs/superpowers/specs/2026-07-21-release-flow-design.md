# Release flow — design

**Date:** 2026-07-21
**Status:** approved

## Goal

Start versioning and publishing releases for Hex. A release = a git tag
(`vX.Y.Z`) + a GitHub Release with notes auto-generated from Conventional
Commits + **downloadable installers for macOS, Windows and Linux** built by CI.

## Decisions

- **Manual trigger, local script** (`pnpm release <patch|minor|major>`) — the
  user decides when to release and which bump. The script only bumps/tags/pushes;
  it finishes in seconds.
- **Builds happen in CI** (GitHub Actions + `tauri-apps/tauri-action`), triggered
  by the tag push. macOS (aarch64 + x86_64), Windows and Linux installers are
  attached to the Release automatically.
- **release-please** is documented as the post-MVP upgrade for the *bump* step
  (it picks up existing tags, so migration is trivial). The CI build workflow
  stays the same either way.
- Release notes live only in the GitHub Release — no CHANGELOG.md for now.

## Components

### 1. `scripts/release.mjs`

Node script, zero dependencies (`node:fs`, `node:child_process`).
Invoked via `pnpm release <patch|minor|major>`. Steps, failing fast with a
clear message on any error (no automatic rollback):

1. **Validate**: bump arg is `patch|minor|major`; working tree clean; branch
   is `main`.
2. **Compute** new version from the current one in `package.json`.
3. **Bump** version in `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and the `hex` entry in `src-tauri/Cargo.lock`
   (so the next build doesn't dirty the tree).
4. **Commit** `chore(release): vX.Y.Z`, **tag** `vX.Y.Z`,
   `git push --follow-tags`.
5. Print a link to the Actions run — CI takes over from here.

### 2. `.github/workflows/release.yml`

Triggered on push of tags matching `v*`. Jobs:

1. **create-release**: creates the GitHub Release for the tag with
   auto-generated notes (`gh release create vX.Y.Z --generate-notes --draft`),
   outputs the release id.
2. **build** (matrix): `macos-latest` (aarch64 + x86_64 targets),
   `windows-latest`, `ubuntu-22.04`. Each runs `tauri-apps/tauri-action`
   pointing at the release id — it builds the app and uploads the installers
   (.dmg, .msi/.exe, .AppImage/.deb) as release assets.
3. **publish**: after all builds succeed, un-drafts the release
   (`gh release edit vX.Y.Z --draft=false`). If a build fails, the release
   stays draft — fix, delete tag+draft, re-run.

`permissions: contents: write`. Rust + pnpm caching to keep runs reasonable
(~15–25 min).

### 3. `docs/releases.md`

Short doc covering:
- The flow: `pnpm release minor` → tag push → CI builds → published Release
  with installers.
- Prerequisites (clean tree on `main`).
- What to do when CI fails mid-release (draft stays; delete tag + draft,
  fix, re-run).
- **Post-MVP** section: migrating the bump step to release-please — why
  (automatic bump from Conventional Commits, maintained CHANGELOG.md, release
  PR as publish button), what changes (release-please workflow + config with
  `extra-files` for the 3 version files), and that it picks up existing
  `v*` tags.

### 4. `package.json`

Add script: `"release": "node scripts/release.mjs"`.

### 5. `CLAUDE.md`

- **Commands** section: add `pnpm release <patch|minor|major>`.
- **Docs table**: add row for `docs/releases.md` — "publishing a release,
  versioning, release CI" — so future sessions read it when the user asks
  for a release.

## Error handling

Script: fail fast, print the failing step, exit non-zero; recoverable by hand.
CI: failed build leaves the release as draft, never a half-published release.

## Testing

Manual end-to-end: run `pnpm release patch` from a clean `main`, watch the
Actions run, verify the published Release has notes + installers for the
3 platforms, and the 4 version files agree. The script and workflow are
straight-line orchestration — no unit tests.
