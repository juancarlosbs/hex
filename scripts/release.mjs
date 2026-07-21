#!/usr/bin/env node
// Release: bump version everywhere, commit, tag, push. CI builds and publishes
// the GitHub Release from the tag (see docs/releases.md).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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
run(`git tag -a ${tag} -m "${tag}"`);
console.log(`committed and tagged ${tag}, pushing...`);
execSync("git push --follow-tags", { cwd: ROOT, stdio: "inherit" });

const repoUrl = run("git remote get-url origin")
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
console.log(`done. CI will build and publish the release:`);
console.log(`${repoUrl}/actions/workflows/release.yml`);
