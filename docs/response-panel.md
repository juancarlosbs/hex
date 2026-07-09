# Response Panel

Static UI for displaying HTTP responses. The component tree exists and renders; it needs to be wired to a Tauri command and a Zustand store to show real responses.

## Component tree

```
ResponsePanel               src/components/response/ResponsePanel.tsx
├── ResponsePlaceholder     (shown when response is null)
├── ResponseStatusBar       src/components/response/ResponseStatusBar.tsx
├── ResponseTabsStrip       src/components/response/ResponseTabsStrip.tsx
├── ResponseFilterBar       src/components/response/ResponseFilterBar.tsx
└── body/
    ├── ResponseBodyView    src/components/response/body/ResponseBodyView.tsx
    └── JsonTree            src/components/response/body/JsonTree.tsx
```

## Data type

```ts
// src/lib/response-types.ts
interface HttpResponse {
  status: number;       // HTTP status code (200, 404, …)
  statusText: string;   // "OK", "Not Found", …
  timeMs: number;       // total round-trip time in milliseconds
  sizeBytes: number;    // response body size in bytes
  headers: Record<string, string>;
  body: string;         // raw response body (text or JSON string)
}
```

### Status colors

`statusColorClass(status)` and `statusBgClass(status)` in `response-types.ts` return Tailwind classes that map status ranges to the design tokens:

| Range | Token | Color |
|-------|-------|-------|
| 2xx | `text-status-2xx` / `bg-status-2xx` | `#3fb950` green |
| 3xx | `text-status-3xx` / `bg-status-3xx` | `#58a6ff` blue |
| 4xx | `text-status-4xx` / `bg-status-4xx` | `#e3b341` yellow |
| 5xx | `text-status-5xx` / `bg-status-5xx` | `#ff5c33` red |

## State that lives in ResponsePanel

```ts
const [response, setResponse] = useState<HttpResponse | null>(null);
const [activeTab, setActiveTab]     = useState<ResponseTab>("body");     // "body" | "headers" | "timing"
const [bodyView, setBodyView]       = useState<ResponseBodyView>("tree"); // "tree" | "raw"
const [filter, setFilter]           = useState("");                       // JSONPath filter string (not yet applied)
```

## What to implement

### 1. Create a response store

Create `src/store/responseStore.ts`:

```ts
import { create } from "zustand";
import { HttpResponse } from "../lib/response-types";

interface ResponseState {
  responses: Record<string, HttpResponse>; // keyed by requestId
  setResponse(requestId: string, response: HttpResponse): void;
  clearResponse(requestId: string): void;
}

export const useResponseStore = create<ResponseState>((set) => ({
  responses: {},
  setResponse(requestId, response) {
    set((s) => ({ responses: { ...s.responses, [requestId]: response } }));
  },
  clearResponse(requestId) {
    set((s) => {
      const { [requestId]: _, ...rest } = s.responses;
      return { responses: rest };
    });
  },
}));
```

### 2. Add a Tauri command for executing requests

In `src-tauri/src/commands/`, add a command that:
- Accepts the request parameters
- Uses the HTTP engine to execute the request
- Returns an `HttpResponse`-shaped value

The Rust return type maps to:

```rust
#[derive(Serialize, specta::Type)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub time_ms: u64,
    pub size_bytes: usize,
    pub headers: HashMap<String, String>,
    pub body: String,
}
```

After adding the command, regenerate `src/bindings.ts` with `pnpm tauri dev` (tauri-specta auto-generates on build).

### 3. Wire ResponsePanel to the store

In `ResponsePanel.tsx`, replace the two static lines:

```ts
// REMOVE:
const [response] = useState<HttpResponse | null>(STATIC_FIXTURE);

// REPLACE WITH:
const activeId = useRequestStore((s) => s.activeId);
const response = useResponseStore((s) => activeId ? s.responses[activeId] ?? null : null);
```

Remove the `STATIC_FIXTURE` constant as well.

### 4. Trigger execution from the Send button

The Send button (`SendButton` component or wherever it lives) should:

1. Read the active request from `useRequestStore`
2. Call the Tauri command via `lib/api.ts`
3. Call `useResponseStore.getState().setResponse(requestId, result)`
4. Clear the previous response before sending: `clearResponse(requestId)`

### 5. JSONPath filter (ResponseFilterBar)

The `filter` string is threaded through `ResponseFilterBar → ResponseBodyView → JsonTree` but not applied yet. To activate:

- In `ResponseBodyView`, apply the filter to `parsed` before passing to `JsonTree`
- Use a library like `jsonpath-plus` (already in the spirit of the stack) or implement a simple recursive walk
- The filter input placeholder shows `$.data.user.email` as example syntax

### 6. Timing tab (ResponseTabsStrip → TimingStub)

`TimingStub` in `ResponsePanel` is a placeholder. Implement it as a waterfall bar chart using the per-phase timing data from the engine:

```ts
interface TimingPhases {
  dns: number;
  tcp: number;
  tls: number;
  ttfb: number;
  download: number;
}
```

Add `timing?: TimingPhases` to `HttpResponse` and render horizontal bars using the design tokens `text-timing-dns`, `text-timing-tcp`, `text-timing-tls`, `text-timing-ttfb`, `text-timing-download`.

## The copy-leaf differentiator

`LeafNode` in `JsonTree.tsx` already implements the isolated copy-leaf:

```tsx
const copy = () => navigator.clipboard.writeText(raw); // raw = plain value, no key
```

Clicking the copy icon on any leaf copies the **value only** (not `"key": value`). This is intentional — it is one of the product's differentiators. Do not change this behavior.

For the last-copied highlight (orange left border on the highlighted row in the Pencil design), track `lastCopiedPath: string | null` in `JsonTree` and apply the highlight style when `path === lastCopiedPath`.

## File map

| File | Role |
|------|------|
| `src/lib/response-types.ts` | Types and status color helpers |
| `src/components/response/ResponsePanel.tsx` | Root panel, owns UI state |
| `src/components/response/ResponsePlaceholder.tsx` | "Hit Send" empty state |
| `src/components/response/ResponseStatusBar.tsx` | Status code, time, size, save icon |
| `src/components/response/ResponseTabsStrip.tsx` | Body / Headers / Timing tab strip |
| `src/components/response/ResponseFilterBar.tsx` | JSONPath filter input + Tree/Raw toggle |
| `src/components/response/body/ResponseBodyView.tsx` | Switches between tree and raw views |
| `src/components/response/body/JsonTree.tsx` | Recursive collapsible JSON tree |
| `src/store/responseStore.ts` | **To create** — response state keyed by requestId |
