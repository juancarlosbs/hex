# Tab Strip Relocation — Titlebar → Center Panel

**Date:** 2026-07-30
**Status:** Approved

## Goal

Move the open-request tab strip out of the custom titlebar into the center panel, directly above the URL bar, matching the updated Pencil design (`index.pen`). The strip must scroll horizontally when tabs overflow instead of growing without bound.

Out of scope (future iterations): activity bar rail, sidebar drawer, compact/responsive layout.

## Current State

- `src/components/Titlebar.tsx` contains an inline `RequestTabs` component (~65 lines) and `DiscardChangesDialog`, rendered inside the drag-region header between `WorkspaceSwitcher` and the right-side actions.
- `src/components/CentralPanel.tsx` renders `Sidebar` + a `react-resizable-panels` `Group`: left `Panel` → `RequestPanel`, right `Panel` → `ResponsePanel`.
- Tab state lives in `requestStore` (`order`, `openRequests`, `activeId`, `setActive`, `closeRequest`) and `collectionStore` (`setActiveRequest`). No store changes needed.

## Design

### New component: `src/components/request/RequestTabsBar.tsx`

- Move `RequestTabs` and `DiscardChangesDialog` out of `Titlebar.tsx` into this file, exported as `RequestTabsBar` (named export, per conventions).
- Keep existing behavior unchanged: click activates (`setActive` + `setActiveRequest`), X closes, dirty tabs get a confirm dialog before closing, method label colored by `METHOD_COLORS` (the constant moves with the component).
- Strip visual per the Pencil design: `bg-card`, `border-b border-border`, padding `8px 10px`, `gap-[6px]`. Tab items keep their current styling.
- The `WebkitAppRegion: no-drag` style is dropped — the strip no longer lives in the drag region.

### Horizontal scroll behavior

- Strip container: `overflow-x-auto` with the scrollbar hidden (`scrollbar-width: none` plus `::-webkit-scrollbar { display: none }` utility in `App.css`); scrolling happens with trackpad/wheel.
- Tab items get `shrink-0` and keep their natural width — they never shrink or truncate.
- Auto-scroll: a `useEffect` keyed on `activeId` calls `scrollIntoView({ inline: "nearest", block: "nearest" })` on the active tab element so activating an off-screen tab brings it into view.

### Mounting point: `CentralPanel.tsx`

The left panel of the split becomes a column with the strip on top:

```tsx
<Panel defaultSize={60} minSize={30}>
  <div className="flex flex-col h-full">
    <RequestTabsBar />
    <div className="flex-1 min-h-0">
      <RequestPanel />
    </div>
  </div>
</Panel>
```

With no open requests, `order` is empty and the strip renders nothing (returns `null`), so the empty state looks unchanged.

### Titlebar cleanup

- Remove `RequestTabs`, `DiscardChangesDialog`, `METHOD_COLORS`, and imports made unused by the move (`useRequestStore`, `useCollectionStore`, `X`).
- Layout otherwise unchanged: the existing `flex-1` spacer already fills the space the tabs occupied, keeping the drag region large.

## Error handling

No new failure modes: the component consumes store state that already exists, and the dirty-close confirm flow is preserved as-is.

## Testing

New `src/components/request/RequestTabsBar.test.tsx` (Vitest + Testing Library, following existing component test patterns):

1. Renders one tab per entry in `order` with method + name.
2. Clicking a tab calls `setActive` and `setActiveRequest`.
3. Clicking X on a clean tab closes it immediately.
4. Clicking X on a dirty tab shows the confirm dialog; Discard closes, Cancel keeps it.
5. Renders nothing when no requests are open.

No automated test for scroll/scrollIntoView (jsdom doesn't lay out); verified manually in `pnpm tauri dev`.
