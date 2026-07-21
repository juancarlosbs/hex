# Release Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm release <patch|minor|major>` bumps the version everywhere, tags, pushes — and CI builds macOS/Windows/Linux installers and publishes a GitHub Release with auto-generated notes.

**Architecture:** A zero-dependency Node script handles the local bump/commit/tag/push. A GitHub Actions workflow triggered by the `v*` tag creates a draft release with generated notes, builds installers via `tauri-apps/tauri-action` in a 4-way matrix, and un-drafts the release only when every build succeeds.

**Tech Stack:** Node 20 (`node:fs`, `node:child_process` only), GitHub Actions, `tauri-apps/tauri-action@v0`, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-07-21-release-flow-design.md`

## Global Constraints

- Commits are Conventional Commits, **single line only, no body** (CLAUDE.md rule).
- `docs/` is in `.gitignore` but doc files are tracked by precedent — stage them with `git add -f`.
- No new npm/cargo dependencies. The release script uses only Node built-ins.
- rustls only — nothing in the workflow may pull OpenSSL (tauri-action with the existing project config is fine; do not add features).
- All code, comments, and docs in English.
- `Cargo.lock` contains TWO `name = "hex"` entries: the app package (currently `0.1.0`) and the crates.io `hex` crate (`0.4.3`). Any version replace in `Cargo.lock` must assert exactly one match.

---

### Task 1: Release script

**Files:**
- Create: `scripts/release.mjs`
- Modify: `package.json` (scripts block, lines 6–12)

**Interfaces:**
- Produces: `pnpm release <patch|minor|major>` — bumps `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`; commits `chore(release): vX.Y.Z`; tags `vX.Y.Z`; runs `git push --follow-tags`. The tag push is what triggers Task 2's workflow.

- [ ] **Step 1: Write the script**

Create `scripts/release.mjs`:

```js
#!/usr/bin/env node
// Release: bump version everywhere, commit, tag, push. CI builds and publishes
// the GitHub Release from the tag (see docs/releases.md).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim();
const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  fail("usage: pnpm release <patch|minor|major>");
}

// --- validate ---
// -uno: untracked files (scratch dirs etc.) don't block a release
if (run("git status --porcelain -uno") !== "") fail("working tree is not clean");
if (run("git branch --show-current") !== "main") fail("must be on main");

// --- compute new version ---
const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const version =
  bump === "major" ? `${maj + 1}.0.0` :
  bump === "minor" ? `${maj}.${min + 1}.0` :
  `${maj}.${min}.${pat + 1}`;
const tag = `v${version}`;
console.log(`${pkg.version} -> ${version}`);

// --- bump files ---
// Replaces `from` with `to`, requiring exactly one occurrence — Cargo.lock
// has a second `name = "hex"` entry (the crates.io hex crate), so a loose
// match could corrupt it.
const replaceOnce = (file, from, to) => {
  const path = `${ROOT}${file}`;
  const src = readFileSync(path, "utf8");
  const count = src.split(from).length - 1;
  if (count !== 1) fail(`expected exactly 1 match in ${file}, found ${count}`);
  writeFileSync(path, src.replace(from, to));
};
replaceOnce("package.json", `"version": "${pkg.version}"`, `"version": "${version}"`);
replaceOnce("src-tauri/tauri.conf.json", `"version": "${pkg.version}"`, `"version": "${version}"`);
replaceOnce("src-tauri/Cargo.toml", `version = "${pkg.version}"`, `version = "${version}"`);
replaceOnce(
  "src-tauri/Cargo.lock",
  `name = "hex"\nversion = "${pkg.version}"`,
  `name = "hex"\nversion = "${version}"`,
);

// --- commit, tag, push ---
run("git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
run(`git commit -m "chore(release): ${tag}"`);
run(`git tag ${tag}`);
console.log(`committed and tagged ${tag}, pushing...`);
execSync("git push --follow-tags", { cwd: ROOT, stdio: "inherit" });

const repoUrl = run("git remote get-url origin")
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
console.log(`done. CI will build and publish the release:`);
console.log(`${repoUrl}/actions/workflows/release.yml`);
```

- [ ] **Step 2: Wire it into package.json**

In `package.json`, add the `release` script to the existing scripts block:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "release": "node scripts/release.mjs"
  },
```

- [ ] **Step 3: Verify the failure modes (these are the tests)**

The script is straight-line git/gh orchestration — its testable surface is validation. Run each case and confirm the exact error without anything being mutated:

Run: `node scripts/release.mjs`
Expected: exit 1, `error: usage: pnpm release <patch|minor|major>`

Run: `node scripts/release.mjs patch` (from the feature branch, clean tracked tree)
Expected: exit 1, `error: must be on main`

Run: `echo >> CLAUDE.md && node scripts/release.mjs patch; git checkout -- CLAUDE.md`
Expected: exit 1, `error: working tree is not clean` (the trailing checkout restores the file)

Also verify nothing changed: `git status --porcelain -uno` prints nothing new.

- [ ] **Step 4: Commit**

```bash
git add scripts/release.mjs package.json
git commit -m "feat(release): add pnpm release script (bump + tag + push)"
```

---

### Task 2: Release CI workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the `vX.Y.Z` tag pushed by Task 1's script.
- Produces: a published GitHub Release for that tag with auto-generated notes and installer assets (.dmg ×2 archs, .msi/.exe, .AppImage/.deb).

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  create-release:
    runs-on: ubuntu-22.04
    outputs:
      release_id: ${{ steps.create.outputs.result }}
    steps:
      - name: Create draft release with generated notes
        id: create
        uses: actions/github-script@v7
        with:
          result-encoding: string
          script: |
            const tag = context.ref.replace('refs/tags/', '')
            const { data } = await github.rest.repos.createRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              tag_name: tag,
              name: tag,
              draft: true,
              generate_release_notes: true,
            })
            return data.id

  build:
    needs: create-release
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: --target aarch64-apple-darwin
          - platform: macos-latest
            args: --target x86_64-apple-darwin
          - platform: ubuntu-22.04
            args: ""
          - platform: windows-latest
            args: ""
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - run: pnpm install

      - name: Build and upload installers
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          releaseId: ${{ needs.create-release.outputs.release_id }}
          args: ${{ matrix.args }}

  publish:
    needs: [create-release, build]
    runs-on: ubuntu-22.04
    steps:
      - name: Publish release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release edit "${GITHUB_REF_NAME}" --repo "${{ github.repository }}" --draft=false
```

Notes for the implementer:
- `create-release` uses `github-script` (not `gh release create`) because the REST call returns the release id directly; the `releases/tags/:tag` endpoint does NOT return draft releases, so there is no reliable way to look the id up afterwards.
- `fail-fast: false` so one platform failing doesn't cancel the others' uploads; the `publish` job still requires ALL builds green before un-drafting.
- Do not add a `tauriScript` or extra config — the repo's `src-tauri/tauri.conf.json` is picked up automatically.

- [ ] **Step 2: Validate the YAML parses**

Run: `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/release.yml'); puts 'ok'"`
Expected: `ok`
(macOS ships ruby; if unavailable, `pnpm dlx yaml-lint .github/workflows/release.yml`.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build installers and publish GitHub Release on v* tags"
```

---

### Task 3: docs/releases.md

**Files:**
- Create: `docs/releases.md` (staged with `git add -f` — `docs/` is gitignored but tracked by precedent)

**Interfaces:**
- Consumes: the flow implemented in Tasks 1–2 (`pnpm release`, `release.yml`).
- Produces: the doc that CLAUDE.md's docs table points to in Task 4.

- [ ] **Step 1: Write the doc**

Create `docs/releases.md`:

```markdown
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

The release stays a draft — nothing half-published. To retry:

1. Fix the problem on `main`.
2. Delete the draft release (GitHub UI or `gh release delete vX.Y.Z`).
3. Delete the tag: `git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z`.
4. Revert the release commit if the fix requires it, then run
   `pnpm release` again.

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
```

- [ ] **Step 2: Commit**

```bash
git add -f docs/releases.md
git commit -m "docs: add release flow guide"
```

---

### Task 4: CLAUDE.md guidance

**Files:**
- Modify: `CLAUDE.md` (docs table + Commands section)

**Interfaces:**
- Consumes: `docs/releases.md` from Task 3.
- Produces: future Claude sessions read `docs/releases.md` and run `pnpm release` when the user asks for a release.

- [ ] **Step 1: Add the docs-table row**

In the CLAUDE.md docs table, after the `docs/decisions.md` row:

```markdown
| `docs/decisions.md`     | why each architecture decision was made (ADRs) |
| `docs/releases.md`      | versioning, publishing a release, release CI — **read before doing a release** |
```

- [ ] **Step 2: Add the command**

In the `## Commands` section, after the Lint/format line:

```markdown
- Lint/format: `pnpm lint` · `cargo fmt` · `cargo clippy`
- Release: `pnpm release <patch|minor|major>` (from `main`; see `docs/releases.md`)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: point CLAUDE.md at the release flow"
```

---

## Final verification (manual, after merge to main)

The real end-to-end test is the first release, run by the user from `main`:

1. `pnpm release patch` → expect version `0.1.0 -> 0.1.1`, tag `v0.1.1` pushed.
2. Watch the Actions run → all 4 matrix builds green, release published.
3. Release page shows generated notes + 4+ installer assets.
4. `grep -r '"0.1.1"' package.json src-tauri/tauri.conf.json` and
   `grep '^version' src-tauri/Cargo.toml` all agree; `pnpm tauri dev` build
   does not dirty `Cargo.lock`.
