# Migrate hardcoded hex to design tokens

**Date:** 2026-07-27
**Branch:** `chore/migrate-hex-to-tokens`
**Origin:** CodeRabbit finding on PR #15 (docs/ui.md thread), deferred as pre-existing tech debt. Tracked in ai-memory at `notes/tech-debt-hardcoded-hex-to-tokens.md`.

## Problem

Three components violate the token-only styling convention ("no hardcoded hex in components — tokens only from `src/App.css`"):

- `src/components/EnvSelector.tsx` — env dot color map + dropdown surface hex
- `src/components/SettingsDialog.tsx` — duplicated env dot color map + `#141414` sidebar background
- `src/components/WorkspaceSwitcher.tsx` — dropdown surface hex

The environment name → color map is duplicated in two files, and none of the environment colors exist as tokens.

## Decisions

1. **Keep current env dot values.** The macOS traffic-light colors (`#28C840`/`#FEBC2E`/`#FF5F57`) become new tokens; no unification with the `--status-*`/`--method-*` palette (different semantics, and the design is the source of truth). Pure refactor, zero visual change.
2. **`#141414` snaps to `bg-sidebar` (`#18181b`).** Same semantics (navigation sidebar surface), imperceptible visual difference, no single-use token added. This is the only visual change in the chore.
3. **Dots consume tokens via Tailwind classes** (`bg-env-development`), not inline `style`. Tailwind v4 generates the utilities from `@theme` automatically; class strings stay literal so the scanner detects them.

## Changes

### 1. Tokens — `src/App.css` (`@theme`)

```css
--color-env-development: #28c840;
--color-env-staging: #febc2e;
--color-env-production: #ff5f57;
--color-env-neutral: #b8b9b6;
```

### 2. Shared helper — `src/lib/envColor.ts` (new)

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

Replaces both duplicated maps (`ENV_COLORS` in EnvSelector, `ENV_DOT_COLORS` in SettingsDialog).

### 3. Component migration

| Current | Becomes |
|---|---|
| `ENV_COLORS`/`ENV_DOT_COLORS` maps + `style={{ backgroundColor }}` on dots | `envDotClass(name)` merged into the dot's `className` via `cn()` |
| `bg-[#1A1A1A]` | `bg-card` |
| `bg-[#2E2E2E]` / `border-[#2E2E2E]` / `hover:bg-[#2E2E2E]` | `bg-secondary` / `border-border` / `hover:bg-secondary` |
| `bg-[#2a2a30]` | `bg-sidebar-accent` |
| `style={{ backgroundColor: "#141414" }}` (SettingsDialog sidebar) | `bg-sidebar` class |

No behavior changes. No other refactoring in these components.

### 4. Docs

- `docs/stack.md`: add `--env-*` to the semantic token families list.
- `docs/ui.md`: add the environment colors to the design tokens section.

## Verification

- `git grep -n '#[0-9a-fA-F]\{6\}' src/components/ src/features/` returns nothing (excluding `src/assets/`).
- Small test for `envDotClass`: known names map, unknown name falls back to `bg-env-neutral`.
- `pnpm test`, `tsc --noEmit`, `pnpm lint` clean.
- Visual check in the running app: EnvSelector dropdown, WorkspaceSwitcher dropdown, Settings dialog (dots + surfaces unchanged; settings sidebar shifts `#141414` → `#18181b`).

## Out of scope

- Any other refactor in the three components.
- Colors outside `src/` (e.g. `src/assets/react.svg`).
