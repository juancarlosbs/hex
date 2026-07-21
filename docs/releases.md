# Releases

How to version and publish a release of Hex.

## Flow

1. Be on `main` with a clean tracked tree (untracked files are fine).
2. Run `pnpm release <patch|minor|major>`.

The script bumps the version in `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, commits
`chore(release): vX.Y.Z`, tags `vX.Y.Z`, and pushes with `--follow-tags`.

The tag push triggers `.github/workflows/release.yml`, which:

1. Creates a **draft** GitHub Release with notes auto-generated from
   Conventional Commits since the last tag.
2. Builds installers in a matrix — macOS (aarch64 + x86_64 .dmg),
   Windows (.msi/.exe), Linux (.AppImage/.deb) — via `tauri-apps/tauri-action`
   and attaches them to the draft.
3. Publishes the release only when **all** builds succeed (~15–25 min).

## Choosing the bump

Conventional Commits since the last release decide it: any `feat` → `minor`,
only `fix`/`chore`/etc → `patch`, breaking change (`!`) → `major`.

## When CI fails mid-release

The release stays a draft — nothing half-published. If a single matrix leg
failed (e.g. a flaky runner), use GitHub's **"Re-run failed jobs"** — never
"Re-run all jobs", which would create a duplicate draft release. The
numbered procedure below is the full-restart path, for when the problem is
in the code or config itself:

1. Fix the problem on `main`.
2. Delete the draft release (GitHub UI or `gh release delete vX.Y.Z`).
3. Delete the tag: `git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z`.
4. Revert the release commit if the fix requires it, then run
   `pnpm release` again.

If you skip reverting the release commit before re-releasing, the next
`pnpm release` simply bumps to the next version number and the failed one
is skipped — harmless, just an unused version number.

## Post-MVP: release-please

When releasing becomes frequent (or contributors join), replace the manual
bump script with [release-please](https://github.com/googleapis/release-please):

- **Why:** it reads Conventional Commits on `main`, keeps a release PR open
  with the computed bump + accumulated CHANGELOG.md; merging the PR tags and
  releases — no local script, no manual bump choice.
- **What changes:** add the release-please workflow + a config using
  `extra-files` so it bumps `src-tauri/tauri.conf.json` and
  `src-tauri/Cargo.toml` alongside `package.json`. The build workflow
  (`release.yml`) stays exactly as is — it only cares about `v*` tags.
- **Migration:** trivial — release-please bootstraps from the latest existing
  `v*` tag.
