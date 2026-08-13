# Hex-to-Tokens Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every hardcoded hex color from `src/components/` by adding four `--color-env-*` tokens and migrating three components to existing + new Tailwind token classes.

**Architecture:** Tailwind v4 `@theme` in `src/App.css` is the single source of color tokens; defining `--color-env-development` automatically generates the `bg-env-development` utility. A single helper `src/lib/envColor.ts` maps environment names to dot classes, replacing two duplicated hex maps. Spec: `docs/superpowers/specs/2026-07-27-hex-to-tokens-design.md`.

**Tech Stack:** React 19 + TS, Tailwind v4 (`@theme`), Vitest, `cn()` from `src/lib/utils.ts`.

## Global Constraints

- Work in the worktree `.worktrees/chore-migrate-hex-to-tokens` on branch `chore/migrate-hex-to-tokens` (all commands below run from that directory).
- No `any` in TS. Named exports only. Class merging via `cn()` — never string concatenation.
- Zero visual change except `#141414` → `bg-sidebar` (`#18181b`) in the SettingsDialog sidebar (approved in spec).
- No behavior changes and no refactoring beyond the hex swaps in the three components.
- Commit messages: Conventional Commits, single line, plain English (no "via").

---

### Task 1: Env tokens + `envDotClass` helper

**Files:**
- Modify: `src/App.css` (inside the `@theme` block, after `--color-sidebar-muted`)
- Create: `src/lib/envColor.ts`
- Test: `src/lib/envColor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `envDotClass(name: string): string` — returns `"bg-env-development" | "bg-env-staging" | "bg-env-production"` for the three seeded names, `"bg-env-neutral"` for anything else. Tasks 2 and 3 import it as `import { envDotClass } from "../lib/envColor";`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/envColor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { envDotClass } from "./envColor";

describe("envDotClass", () => {
  it("maps the three seeded environment names", () => {
    expect(envDotClass("Development")).toBe("bg-env-development");
    expect(envDotClass("Staging")).toBe("bg-env-staging");
    expect(envDotClass("Production")).toBe("bg-env-production");
  });

  it("falls back to neutral for unknown names", () => {
    expect(envDotClass("QA")).toBe("bg-env-neutral");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/envColor.test.ts`
Expected: FAIL — cannot resolve `./envColor`.

- [ ] **Step 3: Write the helper**

Create `src/lib/envColor.ts`:

```ts
const ENV_DOT_CLASS: Record<string, string> = {
  Development: "bg-env-development",
  Staging: "bg-env-staging",
  Production: "bg-env-production",
};

export function envDotClass(name: string): string {
  return ENV_DOT_CLASS[name] ?? "bg-env-neutral";
}
```

- [ ] **Step 4: Add the tokens to `src/App.css`**

Inside the `@theme` block, immediately after the line `--color-sidebar-muted: #b8b9b6;`, add:

```css
  --color-env-development: #28c840;
  --color-env-staging: #febc2e;
  --color-env-production: #ff5f57;
  --color-env-neutral: #b8b9b6;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/envColor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/App.css src/lib/envColor.ts src/lib/envColor.test.ts
git commit -m "chore(tokens): add env color tokens and envDotClass helper"
```

---

### Task 2: Migrate `EnvSelector` to tokens

**Files:**
- Modify: `src/components/EnvSelector.tsx`

**Interfaces:**
- Consumes: `envDotClass(name: string): string` from `src/lib/envColor.ts` (Task 1).
- Produces: nothing new — component props unchanged.

- [ ] **Step 1: Replace the local hex map with the helper**

Delete lines 20–24:

```ts
const ENV_COLORS: Record<string, string> = {
  Development: "#28C840",
  Staging: "#FEBC2E",
  Production: "#FF5F57",
};
```

Add to the imports:

```ts
import { envDotClass } from "../lib/envColor";
```

- [ ] **Step 2: Migrate the trigger dot**

Replace:

```ts
  const dotColor = env ? (ENV_COLORS[env.name] ?? "#B8B9B6") : null;
```

with:

```ts
  const dotClass = env ? envDotClass(env.name) : null;
```

and replace the trigger dot render:

```tsx
        {dotColor ? (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
```

with:

```tsx
        {dotClass ? (
          <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass)} />
```

- [ ] **Step 3: Migrate the dropdown surfaces**

Line 77 — replace:

```tsx
        <div className="absolute top-full right-0 mt-1 w-[220px] rounded-md bg-[#1A1A1A] border border-[#2E2E2E] shadow-lg z-50 overflow-hidden">
```

with:

```tsx
        <div className="absolute top-full right-0 mt-1 w-[220px] rounded-md bg-card border border-border shadow-lg z-50 overflow-hidden">
```

Line 92 ("No Environment" row) — replace:

```tsx
                env === null ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
```

with:

```tsx
                env === null ? "bg-sidebar-accent" : "hover:bg-secondary"
```

Line 111 (environment row) — replace:

```tsx
                    active ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
```

with:

```tsx
                    active ? "bg-sidebar-accent" : "hover:bg-secondary"
```

Line 140 (footer) — replace:

```tsx
            className="flex items-center gap-[6px] px-3 py-2 border-t border-[#2E2E2E] cursor-pointer hover:bg-[#2E2E2E]"
```

with:

```tsx
            className="flex items-center gap-[6px] px-3 py-2 border-t border-border cursor-pointer hover:bg-secondary"
```

- [ ] **Step 4: Migrate the list dot**

Replace:

```tsx
              const color = ENV_COLORS[e.name] ?? "#B8B9B6";
```

with:

```tsx
              const dotCls = envDotClass(e.name);
```

and the list dot render:

```tsx
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
```

with:

```tsx
                    <span className={cn("w-2 h-2 rounded-full shrink-0", dotCls)} />
```

- [ ] **Step 5: Verify**

Run: `grep -n '#[0-9a-fA-F]\{6\}' src/components/EnvSelector.tsx`
Expected: no output.

Run: `npx tsc --noEmit && pnpm test`
Expected: clean compile, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/EnvSelector.tsx
git commit -m "chore(tokens): migrate EnvSelector hex colors to tokens"
```

---

### Task 3: Migrate `SettingsDialog` to tokens

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

**Interfaces:**
- Consumes: `envDotClass(name: string): string` from `src/lib/envColor.ts` (Task 1).
- Produces: nothing new — component props unchanged.

- [ ] **Step 1: Replace the local hex map with the helper**

Delete lines 19–27:

```ts
const ENV_DOT_COLORS: Record<string, string> = {
  Development: "#28C840",
  Staging: "#FEBC2E",
  Production: "#FF5F57",
};

function envDotColor(name: string): string {
  return ENV_DOT_COLORS[name] ?? "#B8B9B6";
}
```

Add to the imports:

```ts
import { envDotClass } from "../lib/envColor";
```

- [ ] **Step 2: Migrate the two dots**

Line 367 (selected environment header) — replace:

```tsx
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: envDotColor(selected.name) }}
          />
```

with:

```tsx
          <span className={cn("w-2 h-2 rounded-full shrink-0", envDotClass(selected.name))} />
```

Line 557 (environment list row) — replace:

```tsx
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: envDotColor(env.name) }}
              />
```

with:

```tsx
              <span className={cn("w-2 h-2 rounded-full shrink-0", envDotClass(env.name))} />
```

- [ ] **Step 3: Migrate the settings sidebar background**

Line 608–611 — replace:

```tsx
        <div
          className="w-[200px] shrink-0 flex flex-col gap-[2px] p-3 border-r border-border"
          style={{ backgroundColor: "#141414" }}
        >
```

with:

```tsx
        <div className="w-[200px] shrink-0 flex flex-col gap-[2px] p-3 border-r border-border bg-sidebar">
```

(This is the one approved visual change: `#141414` → `#18181b`.)

- [ ] **Step 4: Verify**

Run: `grep -n '#[0-9a-fA-F]\{6\}' src/components/SettingsDialog.tsx`
Expected: no output.

Run: `npx tsc --noEmit && pnpm test`
Expected: clean compile, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsDialog.tsx
git commit -m "chore(tokens): migrate SettingsDialog hex colors to tokens"
```

---

### Task 4: Migrate `WorkspaceSwitcher` to tokens

**Files:**
- Modify: `src/components/WorkspaceSwitcher.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (surface swaps only — this component has no env dots).
- Produces: nothing new — component props unchanged.

- [ ] **Step 1: Migrate the dropdown surfaces**

Line 70 — replace:

```tsx
        <div className="absolute top-full left-0 mt-1 w-[220px] rounded-md bg-[#1A1A1A] border border-[#2E2E2E] shadow-lg z-50 overflow-hidden">
```

with:

```tsx
        <div className="absolute top-full left-0 mt-1 w-[220px] rounded-md bg-card border border-border shadow-lg z-50 overflow-hidden">
```

Line 83 (search box) — replace:

```tsx
            <div className="flex items-center gap-[6px] bg-[#2E2E2E] border border-[#2E2E2E] rounded-md px-2 py-[6px]">
```

with:

```tsx
            <div className="flex items-center gap-[6px] bg-secondary border border-border rounded-md px-2 py-[6px]">
```

Line 102 (workspace row) — replace:

```tsx
                    isActive ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
```

with:

```tsx
                    isActive ? "bg-sidebar-accent" : "hover:bg-secondary"
```

Line 119 (footer) — replace:

```tsx
            className="flex items-center gap-[6px] px-3 py-2 border-t border-[#2E2E2E] cursor-pointer hover:bg-[#2E2E2E]"
```

with:

```tsx
            className="flex items-center gap-[6px] px-3 py-2 border-t border-border cursor-pointer hover:bg-secondary"
```

- [ ] **Step 2: Verify**

Run: `grep -n '#[0-9a-fA-F]\{6\}' src/components/WorkspaceSwitcher.tsx`
Expected: no output.

Run: `npx tsc --noEmit && pnpm test`
Expected: clean compile, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceSwitcher.tsx
git commit -m "chore(tokens): migrate WorkspaceSwitcher hex colors to tokens"
```

---

### Task 5: Docs + final sweep

**Files:**
- Modify: `docs/stack.md:97`
- Modify: `docs/ui.md` (section "Semantics (what gives devtool identity)")

**Interfaces:**
- Consumes: token names from Task 1.
- Produces: nothing — documentation only.

- [ ] **Step 1: Add `--env-*` to the token families in `docs/stack.md`**

Line 97 — replace:

```
> (`--method-*`, `--soap-op`, `--status-*`, `--timing-*`, `--field-*`). Single source: `src/App.css`.
```

with:

```
> (`--method-*`, `--soap-op`, `--status-*`, `--timing-*`, `--field-*`, `--env-*`). Single source: `src/App.css`.
```

- [ ] **Step 2: Add the env colors to `docs/ui.md`**

In section "### Semantics (what gives devtool identity)", inside the code block, after the `Field:` line, add:

```
Env:      development #28C840 · staging #FEBC2E · production #FF5F57 · neutral #B8B9B6
```

- [ ] **Step 3: Final hex sweep across the frontend**

Run: `git grep -n '#[0-9a-fA-F]\{6\}' -- 'src/' ':!src/App.css' ':!src/assets/' ':!*.test.*'`
Expected: no output.

- [ ] **Step 4: Full verification**

Run: `pnpm test && npx tsc --noEmit`
Expected: all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add docs/stack.md docs/ui.md
git commit -m "docs: document env color tokens"
```

---

## Final acceptance (from the spec)

- `git grep -n '#[0-9a-fA-F]\{6\}' -- 'src/components/'` → empty.
- `envDotClass` test covers the three names + fallback.
- `pnpm test`, `tsc --noEmit` clean (no `lint` script exists in package.json).
- Visual check in the running app (`pnpm tauri dev`): EnvSelector dropdown, WorkspaceSwitcher dropdown, and SettingsDialog look unchanged (except the settings sidebar `#141414` → `#18181b`).
