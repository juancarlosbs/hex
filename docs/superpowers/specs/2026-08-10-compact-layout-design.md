# Compact Layout — Activity Bar + Drawer + Stacked Panels

**Date:** 2026-08-10
**Status:** Approved

## Goal

Implement the compact layout from the Pencil design (`App — Compact`, `App — Compact (Drawer)` in `index.pen`): when the window is narrow, the sidebar collapses into a 48px activity bar rail, the collections sidebar opens as an overlay drawer, and the request/response split stacks vertically.

## Activation

Responsive breakpoint, no manual toggle: `window.matchMedia("(max-width: 899px)")` via a small `useMediaQuery` hook (`src/lib/useMediaQuery.ts`). At ≥900px the current layout renders unchanged.

## Design

### New component: `src/components/ActivityBar.tsx`

48px-wide vertical rail (`--color-sidebar` background, right border), per the `Activity Bar` component in the design: 34×34 icon buttons with 6px gap, 10px vertical padding — Collections (folder), Environments (layers), History (history), separator, More (ellipsis).

- **Collections** toggles the sidebar drawer (active state: `bg-secondary`, foreground icon).
- **Environments** opens the existing `SettingsDialog` at the environments section (rendered by the ActivityBar itself).
- **History** and **More** are rendered for design fidelity but inert — no flows are defined for them in the design yet.

### `CentralPanel.tsx` — compact branch

When compact:

- `Sidebar` is not rendered inline; `ActivityBar` takes its place.
- The `react-resizable-panels` `Group` switches to `orientation="vertical"` (separate `id` so persisted sizes don't clash): center panel (tabs + request) on top, response panel below.
- Drawer: when open, an overlay covers the area right of the rail (`left-12`), with a scrim (`bg-black/50`, click closes) and the existing `Sidebar` component anchored to the left edge, matching the `Scrim` + `Sidebar Drawer` nodes in the design.

The drawer state resets naturally when the breakpoint flips back to wide (component branch unmounts).

### Titlebar — compact triggers

Per the `App — Compact` titlebar overrides in the design, below the breakpoint the workspace switcher and env selector collapse to icon + chevron (name/label text hidden, trigger width fits content). Both components take a `compact` prop; `Titlebar` derives it from the same `useMediaQuery(COMPACT_MQ)` breakpoint.

## Testing

- `useMediaQuery` and `ActivityBar` unit tests (Vitest + Testing Library, `matchMedia` mocked).
- Full compact layout (panel stacking, drawer overlay) verified manually in `pnpm tauri dev` — jsdom doesn't lay out.
