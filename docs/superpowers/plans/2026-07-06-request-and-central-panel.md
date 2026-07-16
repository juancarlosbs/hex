# Request Panel & Central Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the REST Request builder (UrlBar + tabs Params/Body/Headers/Auth) inside a 3-pane resizable Central Panel, wired to a Zustand store, matching the Pencil design.

**Architecture:** Central Panel is a `react-resizable-panels` container (Sidebar | Request | Response placeholder). The Request Panel is a pure React tree driven by a single `useRequestStore` slice, with local UI state only for open menus/dropdowns. All colors from `styles/tokens.css`. No CodeMirror in this plan — body JSON uses a plain `<textarea>` (upgrade path noted). No backend `send_request` wiring; Send is a no-op button until the engine plan lands.

**Tech Stack:** React 19 + TS, Tailwind v4 tokens, Zustand, `react-resizable-panels`, `lucide-react`. No test framework (project has none yet — verify manually via `pnpm tauri dev`).

**Scope guardrails**
- **In:** REST only. Central Panel scaffold, UrlBar, tabs strip, Params/Headers/Body/Auth panels, state store, empty Response placeholder.
- **Out:** SOAP SchemaForm (separate plan), sending requests (engine plan), CodeMirror upgrade, drag-reorder of open-request tabs, multipart file picker dialog (UI only — file "chip" is a display node).
- **Deferred (mark `ponytail:`):** BodyJsonEditor = `<textarea>` (upgrade to CodeMirror in polish milestone). ResponsePanel = static empty state.

---

## File Structure

```
src/
  lib/
    request-types.ts        # KeyValue, RestBody, AuthConfig, OpenRequest, HTTP_METHODS
  store/
    requestStore.ts         # useRequestStore: openRequests, activeId, mutators
  components/
    CentralPanel.tsx        # 3-pane resizable container (Sidebar | Request | Response)
    response/
      ResponsePlaceholder.tsx  # empty state
    request/
      RequestPanel.tsx        # top: UrlBar + RequestTabsStrip + <ActiveTab />
      RequestEmpty.tsx        # shown when activeId is null
      UrlBar.tsx              # Method + URL input + Send
      MethodBadge.tsx         # small color-coded pill (also used by tabs bar)
      MethodDropdown.tsx      # trigger + open list of HTTP methods
      RequestTabsStrip.tsx    # Params · Body · Headers · Auth with counts
      KeyValueTable.tsx       # shared K/V rows (used by Params, Headers, Body form)
      ParamsTab.tsx           # thin wrapper on KeyValueTable + description col
      HeadersTab.tsx          # K/V table with `auto` rows locked
      ContentTypeDropdown.tsx # dropdown for JSON/urlencoded/multipart
      body/
        BodyTab.tsx           # toolbar (ContentTypeDropdown + Form/JSON toggle) + editor router
        BodyJsonEditor.tsx    # ponytail: <textarea> in --font-primary
        BodyFormEditor.tsx    # urlencoded + multipart rows (TYPE column when multipart)
      auth/
        AuthTab.tsx           # type dropdown + fields per selected AuthType
  App.tsx                     # mounts <CentralPanel /> in the main area
```

**Design principles:**
- One file = one component's responsibility.
- Shared K/V rows go through `KeyValueTable` (Params/Headers/Body-form all consume it, with column presets).
- Every stateful field is a controlled input backed by `useRequestStore`.
- Follow existing Tailwind-inline style (no cva yet — the current codebase does not adopt it; that's a separate refactor).

---

## Tokens & existing patterns to reuse

- Colors via Tailwind tokens (`bg-background`, `text-foreground`, `border-border`, `text-muted`, `text-method-get`, etc.) — see how `Titlebar.tsx` and `Sidebar.tsx` do it.
- Icons via `lucide-react` at 13-14px.
- `WebkitAppRegion: "no-drag"` on any interactive area *inside* the titlebar; NOT needed inside the Central Panel (already non-draggable).
- `cn()` utility from `src/lib/utils.ts`.

---

### Task 1: Install `react-resizable-panels`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

Run:
```bash
pnpm add react-resizable-panels
```
Expected: `react-resizable-panels` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Sanity check**

Run: `pnpm tauri dev` — the app must still build (Tauri window opens with just the Sidebar as before). If Vite reports an import cycle, stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add react-resizable-panels for CentralPanel"
```

---

### Task 2: Define request-types and HTTP_METHODS

**Files:**
- Create: `src/lib/request-types.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/lib/request-types.ts

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  DELETE: "text-method-delete",
  PATCH: "text-method-patch",
  HEAD: "text-muted",
  OPTIONS: "text-muted",
};

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  /** true when generated by the engine (Host, Content-Length, User-Agent…) */
  auto?: boolean;
  /** multipart: "text" | "file"; undefined for urlencoded/headers/params */
  type?: "text" | "file";
}

export type BodyMode = "json" | "form-urlencoded" | "form-multipart";

export interface RestBody {
  mode: BodyMode;
  json: string;
  form: KeyValue[]; // both urlencoded and multipart share; only multipart uses `type`
}

export type AuthType = "none" | "basic" | "bearer" | "apikey";

export type AuthConfig =
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "apikey"; key: string; value: string; addTo: "header" | "query" };

export type RequestTab = "params" | "body" | "headers" | "auth";

export interface OpenRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  activeTab: RequestTab;
  params: KeyValue[];
  headers: KeyValue[];
  body: RestBody;
  auth: AuthConfig;
}

export function makeEmptyRequest(id: string, name: string, method: HttpMethod = "GET"): OpenRequest {
  return {
    id,
    name,
    method,
    url: "",
    activeTab: "params",
    params: [],
    headers: [],
    body: { mode: "json", json: "", form: [] },
    auth: { type: "none" },
  };
}
```

Note: `text-method-put/patch` don't yet exist as Tailwind tokens if `tokens.css` only defines `--method-post/get/delete`. If a class doesn't exist, add the two vars in `styles/tokens.css` (`--method-put: #FF8400; --method-patch: #58A6FF;`) and their Tailwind mapping following the existing pattern. Check `styles/tokens.css` first — reuse existing names if they already cover PUT/PATCH.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/request-types.ts styles/tokens.css
git commit -m "feat(request): add request-types and HTTP method tokens"
```

---

### Task 3: Create `useRequestStore`

**Files:**
- Create: `src/store/requestStore.ts`

- [ ] **Step 1: Write the store**

```ts
// src/store/requestStore.ts
import { create } from "zustand";
import {
  AuthConfig,
  BodyMode,
  HttpMethod,
  KeyValue,
  OpenRequest,
  RequestTab,
  makeEmptyRequest,
} from "../lib/request-types";

interface RequestState {
  openRequests: Record<string, OpenRequest>;
  order: string[]; // tab order in titlebar
  activeId: string | null;

  openRequest(id: string, name: string, method?: HttpMethod): void;
  closeRequest(id: string): void;
  setActive(id: string | null): void;

  setUrl(id: string, url: string): void;
  setMethod(id: string, method: HttpMethod): void;
  setActiveTab(id: string, tab: RequestTab): void;

  setKV(id: string, section: "params" | "headers", row: KeyValue): void;
  addKV(id: string, section: "params" | "headers"): void;
  removeKV(id: string, section: "params" | "headers", rowId: string): void;

  setBodyMode(id: string, mode: BodyMode): void;
  setBodyJson(id: string, json: string): void;
  setFormRow(id: string, row: KeyValue): void;
  addFormRow(id: string): void;
  removeFormRow(id: string, rowId: string): void;

  setAuth(id: string, auth: AuthConfig): void;
}

const uid = () => crypto.randomUUID();

export const useRequestStore = create<RequestState>((set) => ({
  openRequests: {},
  order: [],
  activeId: null,

  openRequest(id, name, method = "GET") {
    set((s) => {
      if (s.openRequests[id]) return { ...s, activeId: id };
      return {
        openRequests: { ...s.openRequests, [id]: makeEmptyRequest(id, name, method) },
        order: [...s.order, id],
        activeId: id,
      };
    });
  },

  closeRequest(id) {
    set((s) => {
      const { [id]: _, ...rest } = s.openRequests;
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? (order[order.length - 1] ?? null) : s.activeId;
      return { openRequests: rest, order, activeId };
    });
  },

  setActive(id) { set({ activeId: id }); },

  setUrl(id, url) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { url }) }));
  },
  setMethod(id, method) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { method }) }));
  },
  setActiveTab(id, activeTab) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { activeTab }) }));
  },

  setKV(id, section, row) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = r[section].map((x) => (x.id === row.id ? row : x));
      return { openRequests: patch(s.openRequests, id, { [section]: list }) };
    });
  },
  addKV(id, section) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = [...r[section], { id: uid(), key: "", value: "", enabled: true }];
      return { openRequests: patch(s.openRequests, id, { [section]: list }) };
    });
  },
  removeKV(id, section, rowId) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = r[section].filter((x) => x.id !== rowId);
      return { openRequests: patch(s.openRequests, id, { [section]: list }) };
    });
  },

  setBodyMode(id, mode) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, mode } }) };
    });
  },
  setBodyJson(id, json) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, json } }) };
    });
  },
  setFormRow(id, row) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = r.body.form.map((x) => (x.id === row.id ? row : x));
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form } }) };
    });
  },
  addFormRow(id) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = [
        ...r.body.form,
        { id: uid(), key: "", value: "", enabled: true, type: "text" as const },
      ];
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form } }) };
    });
  },
  removeFormRow(id, rowId) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = r.body.form.filter((x) => x.id !== rowId);
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form } }) };
    });
  },

  setAuth(id, auth) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { auth }) }));
  },
}));

function patch(
  map: Record<string, OpenRequest>,
  id: string,
  fields: Partial<OpenRequest>,
): Record<string, OpenRequest> {
  const cur = map[id];
  if (!cur) return map;
  return { ...map, [id]: { ...cur, ...fields } };
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/requestStore.ts
git commit -m "feat(request): add zustand store for open requests"
```

---

### Task 4: `MethodBadge` component

**Files:**
- Create: `src/components/request/MethodBadge.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/MethodBadge.tsx
import { HttpMethod, METHOD_COLOR } from "../../lib/request-types";
import { cn } from "../../lib/utils";

interface MethodBadgeProps {
  method: HttpMethod;
  className?: string;
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        "text-[11px] font-bold tracking-[0.4px] uppercase",
        METHOD_COLOR[method],
        className,
      )}
      style={{ fontFamily: "var(--font-primary)" }}
    >
      {method}
    </span>
  );
}
```

- [ ] **Step 2: Verify visually**

No standalone verification — we'll see it when integrated into `UrlBar` (Task 6). Just confirm `pnpm tsc --noEmit` passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/request/MethodBadge.tsx
git commit -m "feat(request): add MethodBadge component"
```

---

### Task 5: `MethodDropdown` component

**Files:**
- Create: `src/components/request/MethodDropdown.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/MethodDropdown.tsx
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { HTTP_METHODS, HttpMethod, METHOD_COLOR } from "../../lib/request-types";

interface MethodDropdownProps {
  method: HttpMethod;
  onChange: (method: HttpMethod) => void;
}

export function MethodDropdown({ method, onChange }: MethodDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-[9px] rounded-[6px] bg-card border border-border cursor-pointer hover:bg-secondary"
      >
        <span
          className={`text-[13px] font-bold tracking-[0.4px] ${METHOD_COLOR[method]}`}
          style={{ fontFamily: "var(--font-primary)" }}
        >
          {method}
        </span>
        {open ? (
          <ChevronUp size={14} className="text-muted" />
        ) : (
          <ChevronDown size={14} className="text-muted" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-[6px] bg-card border border-border shadow-lg">
          <ul className="flex flex-col gap-[1px] p-1">
            {HTTP_METHODS.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                    m === method ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <span
                    className={`text-[12px] font-bold tracking-[0.4px] ${METHOD_COLOR[m]}`}
                    style={{ fontFamily: "var(--font-primary)" }}
                  >
                    {m}
                  </span>
                  {m === method && <Check size={12} className="text-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/request/MethodDropdown.tsx
git commit -m "feat(request): add MethodDropdown"
```

---

### Task 6: `UrlBar` component

**Files:**
- Create: `src/components/request/UrlBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/UrlBar.tsx
import { CornerDownLeft } from "lucide-react";
import { MethodDropdown } from "./MethodDropdown";
import { useRequestStore } from "../../store/requestStore";

interface UrlBarProps {
  requestId: string;
}

export function UrlBar({ requestId }: UrlBarProps) {
  const req = useRequestStore((s) => s.openRequests[requestId]);
  const setUrl = useRequestStore((s) => s.setUrl);
  const setMethod = useRequestStore((s) => s.setMethod);

  if (!req) return null;

  return (
    <div className="flex items-center gap-2 p-2 bg-card rounded-[8px] border border-border">
      <MethodDropdown method={req.method} onChange={(m) => setMethod(requestId, m)} />

      <input
        value={req.url}
        onChange={(e) => setUrl(requestId, e.target.value)}
        placeholder="https://api.example.com/resource"
        className="flex-1 min-w-0 px-3 py-[9px] text-[13px] bg-background border border-border rounded-[6px] text-foreground placeholder:text-muted outline-none focus:border-ring"
        style={{ fontFamily: "var(--font-primary)" }}
      />

      <button
        type="button"
        className="flex items-center gap-2 px-5 py-[10px] rounded-[6px] bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer hover:opacity-90"
        style={{ fontFamily: "var(--font-secondary)" }}
        title="Send (⌘↵)"
      >
        Send
        <CornerDownLeft size={14} />
      </button>
    </div>
  );
}
```

Note: Send is intentionally a no-op — engine wiring is a separate plan.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/UrlBar.tsx
git commit -m "feat(request): add UrlBar wired to requestStore"
```

---

### Task 7: `RequestTabsStrip` component

**Files:**
- Create: `src/components/request/RequestTabsStrip.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/RequestTabsStrip.tsx
import { RequestTab } from "../../lib/request-types";
import { useRequestStore } from "../../store/requestStore";

const TABS: { key: RequestTab; label: string }[] = [
  { key: "params", label: "Params" },
  { key: "body", label: "Body" },
  { key: "headers", label: "Headers" },
  { key: "auth", label: "Auth" },
];

interface RequestTabsStripProps {
  requestId: string;
}

export function RequestTabsStrip({ requestId }: RequestTabsStripProps) {
  const active = useRequestStore((s) => s.openRequests[requestId]?.activeTab);
  const params = useRequestStore((s) => s.openRequests[requestId]?.params.length ?? 0);
  const headers = useRequestStore((s) => s.openRequests[requestId]?.headers.length ?? 0);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);

  const count = (k: RequestTab) => (k === "params" ? params : k === "headers" ? headers : 0);

  return (
    <div className="flex items-center gap-4 px-3 border-b border-border">
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(requestId, t.key)}
            className={`flex items-center gap-[6px] py-3 border-b-2 cursor-pointer ${
              isActive ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
            style={{ fontFamily: "var(--font-secondary)" }}
          >
            <span className="text-[13px] font-medium">{t.label}</span>
            {count(t.key) > 0 && (
              <span className="text-[10px] px-[5px] py-[1px] rounded-full bg-secondary text-muted">
                {count(t.key)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/RequestTabsStrip.tsx
git commit -m "feat(request): add RequestTabsStrip"
```

---

### Task 8: `KeyValueTable` shared component

**Files:**
- Create: `src/components/request/KeyValueTable.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/KeyValueTable.tsx
import { Check, Lock, Plus, Trash2 } from "lucide-react";
import { KeyValue } from "../../lib/request-types";
import { cn } from "../../lib/utils";

export interface KeyValueTableColumn {
  key: "key" | "value" | "description";
  label: string;
  placeholder: string;
}

interface KeyValueTableProps {
  rows: KeyValue[];
  columns: KeyValueTableColumn[];
  onChangeRow: (row: KeyValue) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  /** Empty display row hint (visible last item to invite adding) — parity with Pencil design. */
  emptyRowHint?: boolean;
}

export function KeyValueTable(props: KeyValueTableProps) {
  const { rows, columns, onChangeRow, onAddRow, onRemoveRow, emptyRowHint = true } = props;

  return (
    <div className="flex flex-col w-full">
      {/* Column header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
        <div className="w-[14px]" aria-hidden />
        {columns.map((c) => (
          <div
            key={c.key}
            className="flex-1 text-[10px] font-semibold tracking-[0.6px] text-muted"
            style={{ fontFamily: "var(--font-secondary)" }}
          >
            {c.label}
          </div>
        ))}
        <div className="w-[14px]" aria-hidden />
      </div>

      {rows.map((row) => (
        <Row key={row.id} row={row} columns={columns} onChange={onChangeRow} onRemove={onRemoveRow} />
      ))}

      {emptyRowHint && (
        <button
          type="button"
          onClick={onAddRow}
          className="flex items-center gap-3 px-3 py-[9px] border-b border-border text-left cursor-pointer hover:bg-secondary/40"
        >
          <div className="w-[14px] h-[14px] rounded-[3px] border border-border" aria-hidden />
          {columns.map((c) => (
            <span
              key={c.key}
              className="flex-1 text-[12px] text-muted opacity-50"
              style={{ fontFamily: "var(--font-primary)" }}
            >
              {c.placeholder}
            </span>
          ))}
          <Plus size={14} className="text-muted opacity-70" />
        </button>
      )}
    </div>
  );
}

function Row(props: {
  row: KeyValue;
  columns: KeyValueTableColumn[];
  onChange: (row: KeyValue) => void;
  onRemove: (id: string) => void;
}) {
  const { row, columns, onChange, onRemove } = props;
  const dim = row.auto || !row.enabled;

  return (
    <div className="flex items-center gap-3 px-3 py-[9px] border-b border-border">
      {row.auto ? (
        <div className="flex items-center justify-center w-[14px] h-[14px]" title="Auto-generated">
          <Lock size={10} className="text-muted" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange({ ...row, enabled: !row.enabled })}
          className={cn(
            "flex items-center justify-center w-[14px] h-[14px] rounded-[3px] border cursor-pointer",
            row.enabled ? "bg-primary border-primary" : "border-border",
          )}
          aria-label={row.enabled ? "Disable row" : "Enable row"}
        >
          {row.enabled && <Check size={10} className="text-primary-foreground" />}
        </button>
      )}

      {columns.map((c) => (
        <input
          key={c.key}
          value={row[c.key] ?? ""}
          placeholder={c.placeholder}
          disabled={row.auto}
          onChange={(e) => onChange({ ...row, [c.key]: e.target.value })}
          className={cn(
            "flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:text-muted/50",
            dim ? "text-muted" : "text-foreground",
            c.key === "description" ? "" : "",
          )}
          style={{ fontFamily: c.key === "description" ? "var(--font-secondary)" : "var(--font-primary)" }}
        />
      ))}

      {row.auto ? (
        <div className="w-[14px]" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="cursor-pointer text-muted hover:text-foreground"
          aria-label="Remove row"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/KeyValueTable.tsx
git commit -m "feat(request): add shared KeyValueTable"
```

---

### Task 9: `ParamsTab`

**Files:**
- Create: `src/components/request/ParamsTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/ParamsTab.tsx
import { ArrowUpDown, List, Plus } from "lucide-react";
import { KeyValueTable } from "./KeyValueTable";
import { useRequestStore } from "../../store/requestStore";

interface ParamsTabProps {
  requestId: string;
}

export function ParamsTab({ requestId }: ParamsTabProps) {
  const params = useRequestStore((s) => s.openRequests[requestId]?.params ?? []);
  const setKV = useRequestStore((s) => s.setKV);
  const addKV = useRequestStore((s) => s.addKV);
  const removeKV = useRequestStore((s) => s.removeKV);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-[6px] text-muted">
          <List size={13} />
          <span className="text-[12px]" style={{ fontFamily: "var(--font-secondary)" }}>
            {params.length} {params.length === 1 ? "param" : "params"}
          </span>
        </div>
        <div className="flex-1" />
        <ArrowUpDown size={14} className="text-muted cursor-pointer hover:text-foreground" />
        <Plus
          size={14}
          className="text-muted cursor-pointer hover:text-foreground"
          onClick={() => addKV(requestId, "params")}
        />
      </div>

      <KeyValueTable
        rows={params}
        columns={[
          { key: "key", label: "KEY", placeholder: "Key" },
          { key: "value", label: "VALUE", placeholder: "Value" },
          { key: "description", label: "DESCRIPTION", placeholder: "Description" },
        ]}
        onChangeRow={(row) => setKV(requestId, "params", row)}
        onAddRow={() => addKV(requestId, "params")}
        onRemoveRow={(id) => removeKV(requestId, "params", id)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/ParamsTab.tsx
git commit -m "feat(request): add ParamsTab"
```

---

### Task 10: `HeadersTab`

**Files:**
- Create: `src/components/request/HeadersTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/HeadersTab.tsx
import { EyeOff, List, Lock, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { KeyValueTable } from "./KeyValueTable";
import { useRequestStore } from "../../store/requestStore";
import { KeyValue } from "../../lib/request-types";

interface HeadersTabProps {
  requestId: string;
}

/** Static list of headers the engine sets automatically. Displayed read-only. */
const AUTO_HEADERS: KeyValue[] = [
  { id: "auto-host", key: "Host", value: "(derived from URL)", enabled: true, auto: true },
  { id: "auto-ct", key: "Content-Type", value: "(derived from body mode)", enabled: true, auto: true },
  { id: "auto-ua", key: "User-Agent", value: "hex/0.1.0", enabled: true, auto: true },
];

export function HeadersTab({ requestId }: HeadersTabProps) {
  const headers = useRequestStore((s) => s.openRequests[requestId]?.headers ?? []);
  const setKV = useRequestStore((s) => s.setKV);
  const addKV = useRequestStore((s) => s.addKV);
  const removeKV = useRequestStore((s) => s.removeKV);
  const [hideAuto, setHideAuto] = useState(false);

  const rows = useMemo(
    () => (hideAuto ? headers : [...headers, ...AUTO_HEADERS]),
    [headers, hideAuto],
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-[6px] text-muted">
          <List size={13} />
          <span className="text-[12px]" style={{ fontFamily: "var(--font-secondary)" }}>
            {headers.length + AUTO_HEADERS.length} headers
          </span>
        </div>
        <div
          className="flex items-center gap-[4px] px-[6px] py-[2px] rounded-full border"
          style={{ borderColor: "var(--color-soap-op)", background: "var(--color-soap-op-surface)" }}
          title="Auto-generated"
        >
          <Lock size={9} style={{ color: "var(--color-soap-op)" }} />
          <span
            className="text-[10px] font-semibold"
            style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-secondary)" }}
          >
            {AUTO_HEADERS.length} auto
          </span>
        </div>
        <div className="flex-1" />
        <EyeOff
          size={14}
          className={`cursor-pointer ${hideAuto ? "text-foreground" : "text-muted hover:text-foreground"}`}
          onClick={() => setHideAuto((v) => !v)}
          aria-label="Toggle auto headers"
        />
        <Plus
          size={14}
          className="text-muted cursor-pointer hover:text-foreground"
          onClick={() => addKV(requestId, "headers")}
        />
      </div>

      <KeyValueTable
        rows={rows}
        columns={[
          { key: "key", label: "KEY", placeholder: "Header" },
          { key: "value", label: "VALUE", placeholder: "Value" },
        ]}
        onChangeRow={(row) => {
          if (row.auto) return;
          setKV(requestId, "headers", row);
        }}
        onAddRow={() => addKV(requestId, "headers")}
        onRemoveRow={(id) => removeKV(requestId, "headers", id)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/HeadersTab.tsx
git commit -m "feat(request): add HeadersTab with auto headers"
```

---

### Task 11: `ContentTypeDropdown`

**Files:**
- Create: `src/components/request/ContentTypeDropdown.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/ContentTypeDropdown.tsx
import { useEffect, useRef, useState } from "react";
import { Braces, Check, ChevronDown, ChevronUp, Code, Paperclip } from "lucide-react";
import { BodyMode } from "../../lib/request-types";
import { LucideIcon } from "lucide-react";

interface ContentTypeOption {
  mode: BodyMode;
  icon: LucideIcon;
  label: string;
}

const OPTIONS: ContentTypeOption[] = [
  { mode: "json", icon: Code, label: "application/json" },
  { mode: "form-urlencoded", icon: Braces, label: "application/x-www-form-urlencoded" },
  { mode: "form-multipart", icon: Paperclip, label: "multipart/form-data" },
];

interface ContentTypeDropdownProps {
  mode: BodyMode;
  onChange: (mode: BodyMode) => void;
}

export function ContentTypeDropdown({ mode, onChange }: ContentTypeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0];
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-card border border-border cursor-pointer hover:bg-secondary"
      >
        <CurrentIcon size={13} className="text-muted" />
        <span
          className="text-[12px] text-foreground"
          style={{ fontFamily: "var(--font-primary)" }}
        >
          {current.label}
        </span>
        {open ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>

      {open && (
        <ul className="absolute left-0 top-[calc(100%+4px)] z-30 w-[296px] rounded-[6px] bg-card border border-border shadow-lg p-1">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = o.mode === mode;
            return (
              <li key={o.mode}>
                <button
                  type="button"
                  onClick={() => { onChange(o.mode); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                    active ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={13} className="text-muted" />
                    <span className="text-[12px] text-foreground" style={{ fontFamily: "var(--font-primary)" }}>
                      {o.label}
                    </span>
                  </span>
                  {active && <Check size={12} className="text-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/ContentTypeDropdown.tsx
git commit -m "feat(request): add ContentTypeDropdown"
```

---

### Task 12: `BodyJsonEditor` (ponytail: textarea)

**Files:**
- Create: `src/components/request/body/BodyJsonEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/body/BodyJsonEditor.tsx
// ponytail: plain <textarea> for now. Upgrade path: swap for @uiw/react-codemirror
// with lang-json when the polish milestone lands (docs/architecture.md §7 milestone 8).

interface BodyJsonEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function BodyJsonEditor({ value, onChange }: BodyJsonEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      placeholder='{\n  "key": "value"\n}'
      className="w-full h-full min-h-[240px] resize-none bg-background text-foreground p-3 text-[12px] outline-none border-0 placeholder:text-muted"
      style={{ fontFamily: "var(--font-primary)" }}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/body/BodyJsonEditor.tsx
git commit -m "feat(request): add BodyJsonEditor (textarea, upgrade path noted)"
```

---

### Task 13: `BodyFormEditor` (urlencoded + multipart)

**Files:**
- Create: `src/components/request/body/BodyFormEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/body/BodyFormEditor.tsx
import { ChevronDown, File, Type, X } from "lucide-react";
import { useState } from "react";
import { KeyValue } from "../../../lib/request-types";
import { KeyValueTable } from "../KeyValueTable";
import { useRequestStore } from "../../../store/requestStore";
import { cn } from "../../../lib/utils";

interface BodyFormEditorProps {
  requestId: string;
  multipart: boolean;
}

export function BodyFormEditor({ requestId, multipart }: BodyFormEditorProps) {
  const rows = useRequestStore((s) => s.openRequests[requestId]?.body.form ?? []);
  const setFormRow = useRequestStore((s) => s.setFormRow);
  const addFormRow = useRequestStore((s) => s.addFormRow);
  const removeFormRow = useRequestStore((s) => s.removeFormRow);

  if (!multipart) {
    return (
      <KeyValueTable
        rows={rows}
        columns={[
          { key: "key", label: "KEY", placeholder: "Key" },
          { key: "value", label: "VALUE", placeholder: "Value" },
        ]}
        onChangeRow={(row) => setFormRow(requestId, row)}
        onAddRow={() => addFormRow(requestId)}
        onRemoveRow={(id) => removeFormRow(requestId, id)}
      />
    );
  }

  return (
    <MultipartTable
      rows={rows}
      onChangeRow={(row) => setFormRow(requestId, row)}
      onAddRow={() => addFormRow(requestId)}
      onRemoveRow={(id) => removeFormRow(requestId, id)}
    />
  );
}

// Bespoke table because of the TYPE column (Text/File) that the shared KVTable does not model.
function MultipartTable(props: {
  rows: KeyValue[];
  onChangeRow: (row: KeyValue) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
}) {
  const { rows, onChangeRow, onAddRow, onRemoveRow } = props;

  return (
    <div className="flex flex-col w-full">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
        <div className="w-[14px]" />
        <div className="flex-1 text-[10px] font-semibold tracking-[0.6px] text-muted" style={{ fontFamily: "var(--font-secondary)" }}>KEY</div>
        <div className="text-[10px] font-semibold tracking-[0.6px] text-muted w-[76px]" style={{ fontFamily: "var(--font-secondary)" }}>TYPE</div>
        <div className="flex-1 text-[10px] font-semibold tracking-[0.6px] text-muted" style={{ fontFamily: "var(--font-secondary)" }}>VALUE</div>
        <div className="w-[14px]" />
      </div>

      {rows.map((row) => (
        <MultipartRow key={row.id} row={row} onChange={onChangeRow} onRemove={onRemoveRow} />
      ))}

      <button
        type="button"
        onClick={onAddRow}
        className="flex items-center gap-3 px-3 py-[9px] border-b border-border text-left cursor-pointer hover:bg-secondary/40"
      >
        <div className="w-[14px] h-[14px] rounded-[3px] border border-border" />
        <span className="flex-1 text-[12px] text-muted opacity-50" style={{ fontFamily: "var(--font-primary)" }}>Key</span>
        <span className="w-[76px] text-[10px] text-muted opacity-50">Text</span>
        <span className="flex-1 text-[12px] text-muted opacity-50" style={{ fontFamily: "var(--font-primary)" }}>Value</span>
        <div className="w-[14px]" />
      </button>
    </div>
  );
}

function MultipartRow(props: {
  row: KeyValue;
  onChange: (row: KeyValue) => void;
  onRemove: (id: string) => void;
}) {
  const { row, onChange, onRemove } = props;
  const [typeOpen, setTypeOpen] = useState(false);
  const isFile = row.type === "file";

  return (
    <div className="flex items-center gap-3 px-3 py-[9px] border-b border-border">
      <button
        type="button"
        onClick={() => onChange({ ...row, enabled: !row.enabled })}
        className={cn(
          "flex items-center justify-center w-[14px] h-[14px] rounded-[3px] border cursor-pointer",
          row.enabled ? "bg-primary border-primary" : "border-border",
        )}
      />

      <input
        value={row.key}
        onChange={(e) => onChange({ ...row, key: e.target.value })}
        placeholder="Key"
        className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted/50"
        style={{ fontFamily: "var(--font-primary)" }}
      />

      <div className="relative w-[76px]">
        <button
          type="button"
          onClick={() => setTypeOpen((v) => !v)}
          className="w-full flex items-center gap-[4px] px-[7px] py-[3px] rounded-[4px] bg-secondary border border-border cursor-pointer"
        >
          {isFile ? <File size={11} className="text-muted" /> : <Type size={11} className="text-muted" />}
          <span className="text-[10px] font-semibold text-foreground flex-1 text-left" style={{ fontFamily: "var(--font-secondary)" }}>
            {isFile ? "File" : "Text"}
          </span>
          <ChevronDown size={10} className="text-muted" />
        </button>
        {typeOpen && (
          <ul className="absolute left-0 top-[calc(100%+2px)] z-30 w-full rounded-[4px] bg-card border border-border shadow-lg p-1">
            {(["text", "file"] as const).map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ ...row, type: t, value: "" });
                    setTypeOpen(false);
                  }}
                  className="w-full text-left text-[10px] px-2 py-1 rounded-[3px] hover:bg-secondary text-foreground"
                >
                  {t === "text" ? "Text" : "File"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isFile ? (
        <FileValue row={row} onChange={onChange} />
      ) : (
        <input
          value={row.value}
          onChange={(e) => onChange({ ...row, value: e.target.value })}
          placeholder="Value"
          className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted/50"
          style={{ fontFamily: "var(--font-primary)" }}
        />
      )}

      <button
        type="button"
        onClick={() => onRemove(row.id)}
        className="cursor-pointer text-muted hover:text-foreground"
        aria-label="Remove row"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FileValue({ row, onChange }: { row: KeyValue; onChange: (row: KeyValue) => void }) {
  const has = row.value.length > 0;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      {has ? (
        <span
          className="flex items-center gap-[6px] px-[8px] py-[3px] rounded-[4px] border"
          style={{ background: "var(--color-soap-op-surface)", borderColor: "var(--color-soap-op)" }}
        >
          <File size={11} style={{ color: "var(--color-soap-op)" }} />
          <span
            className="text-[11px]"
            style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-primary)" }}
          >
            {row.value}
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...row, value: "" })}
            className="cursor-pointer"
            aria-label="Clear file"
          >
            <X size={11} style={{ color: "var(--color-soap-op)" }} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() =>
            // ponytail: file picker dialog is engine-plan territory. For now, set a stub filename
            // so the chip renders. Wire to tauri-plugin-dialog::open in the engine plan.
            onChange({ ...row, value: "example.pdf" })
          }
          className="text-[12px] text-muted underline underline-offset-2 cursor-pointer hover:text-foreground"
          style={{ fontFamily: "var(--font-primary)" }}
        >
          Choose file…
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/body/BodyFormEditor.tsx
git commit -m "feat(request): add BodyFormEditor (urlencoded + multipart)"
```

---

### Task 14: `BodyTab` (toolbar + editor router)

**Files:**
- Create: `src/components/request/body/BodyTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/body/BodyTab.tsx
import { Plus, WandSparkles } from "lucide-react";
import { ContentTypeDropdown } from "../ContentTypeDropdown";
import { BodyJsonEditor } from "./BodyJsonEditor";
import { BodyFormEditor } from "./BodyFormEditor";
import { useRequestStore } from "../../../store/requestStore";

interface BodyTabProps {
  requestId: string;
}

export function BodyTab({ requestId }: BodyTabProps) {
  const body = useRequestStore((s) => s.openRequests[requestId]?.body);
  const setBodyMode = useRequestStore((s) => s.setBodyMode);
  const setBodyJson = useRequestStore((s) => s.setBodyJson);
  const addFormRow = useRequestStore((s) => s.addFormRow);

  if (!body) return null;

  const isForm = body.mode !== "json";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <ContentTypeDropdown mode={body.mode} onChange={(m) => setBodyMode(requestId, m)} />
        <div className="flex-1" />
        {isForm ? (
          <Plus
            size={14}
            className="text-muted cursor-pointer hover:text-foreground"
            onClick={() => addFormRow(requestId)}
            aria-label="Add row"
          />
        ) : (
          <WandSparkles
            size={14}
            className="text-muted cursor-pointer hover:text-foreground"
            onClick={() => setBodyJson(requestId, tryPrettyJson(body.json))}
            aria-label="Beautify"
          />
        )}
      </div>

      <div className="flex-1 min-h-0">
        {body.mode === "json" && <BodyJsonEditor value={body.json} onChange={(v) => setBodyJson(requestId, v)} />}
        {body.mode === "form-urlencoded" && <BodyFormEditor requestId={requestId} multipart={false} />}
        {body.mode === "form-multipart" && <BodyFormEditor requestId={requestId} multipart={true} />}
      </div>
    </div>
  );
}

function tryPrettyJson(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/body/BodyTab.tsx
git commit -m "feat(request): add BodyTab (mode router + toolbar)"
```

---

### Task 15: `AuthTab`

**Files:**
- Create: `src/components/request/auth/AuthTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/request/auth/AuthTab.tsx
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, KeyRound, LockOpen } from "lucide-react";
import { AuthConfig, AuthType } from "../../../lib/request-types";
import { useRequestStore } from "../../../store/requestStore";

const AUTH_LABELS: Record<AuthType, string> = {
  none: "No Auth",
  basic: "Basic Auth",
  bearer: "Bearer Token",
  apikey: "API Key",
};

interface AuthTabProps {
  requestId: string;
}

export function AuthTab({ requestId }: AuthTabProps) {
  const auth = useRequestStore((s) => s.openRequests[requestId]?.auth);
  const setAuth = useRequestStore((s) => s.setAuth);
  if (!auth) return null;

  const change = (t: AuthType) => setAuth(requestId, defaultForType(t));

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-[10px] font-semibold tracking-[0.6px] text-muted" style={{ fontFamily: "var(--font-secondary)" }}>
          AUTH TYPE
        </span>
        <div className="flex-1" />
        <AuthTypeSelector value={auth.type} onChange={change} />
      </div>

      {auth.type === "none" && <NoneBody />}
      {auth.type === "basic" && (
        <BasicBody
          auth={auth}
          onChange={(next) => setAuth(requestId, next)}
        />
      )}
      {auth.type === "bearer" && (
        <BearerBody
          auth={auth}
          onChange={(next) => setAuth(requestId, next)}
        />
      )}
      {auth.type === "apikey" && (
        <ApiKeyBody
          auth={auth}
          onChange={(next) => setAuth(requestId, next)}
        />
      )}
    </div>
  );
}

function defaultForType(t: AuthType): AuthConfig {
  switch (t) {
    case "none":   return { type: "none" };
    case "basic":  return { type: "basic", username: "", password: "" };
    case "bearer": return { type: "bearer", token: "" };
    case "apikey": return { type: "apikey", key: "", value: "", addTo: "header" };
  }
}

function AuthTypeSelector({ value, onChange }: { value: AuthType; onChange: (t: AuthType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-card border border-border cursor-pointer hover:bg-secondary"
      >
        <KeyRound size={13} className="text-muted" />
        <span className="text-[12px] font-semibold text-foreground" style={{ fontFamily: "var(--font-secondary)" }}>
          {AUTH_LABELS[value]}
        </span>
        {open ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>
      {open && (
        <ul className="absolute right-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-[6px] bg-card border border-border shadow-lg p-1">
          {(Object.keys(AUTH_LABELS) as AuthType[]).map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => { onChange(t); setOpen(false); }}
                className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                  t === value ? "bg-secondary" : "hover:bg-secondary"
                }`}
              >
                <span className="text-[12px] text-foreground" style={{ fontFamily: "var(--font-secondary)" }}>
                  {AUTH_LABELS[t]}
                </span>
                {t === value && <Check size={12} className="text-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoneBody() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8">
      <LockOpen size={20} className="text-muted" />
      <span className="text-[12px] text-muted" style={{ fontFamily: "var(--font-secondary)" }}>
        This request does not use any authentication.
      </span>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  masked?: boolean;
}

function Field({ label, value, placeholder, onChange, masked }: FieldProps) {
  const [visible, setVisible] = useState(!masked);
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      <label
        className="w-[140px] text-[12px] font-medium text-muted"
        style={{ fontFamily: "var(--font-secondary)" }}
      >
        {label}
      </label>
      <div className="flex-1 min-w-0 flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-background border border-border">
        <input
          type={masked && !visible ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted"
          style={{ fontFamily: "var(--font-primary)" }}
        />
        {masked && (
          <button type="button" onClick={() => setVisible((v) => !v)} className="cursor-pointer text-muted" aria-label="Toggle visibility">
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

function BasicBody(props: { auth: Extract<AuthConfig, { type: "basic" }>; onChange: (a: AuthConfig) => void }) {
  const { auth, onChange } = props;
  return (
    <>
      <Field label="Username" value={auth.username} onChange={(v) => onChange({ ...auth, username: v })} />
      <Field label="Password" value={auth.password} onChange={(v) => onChange({ ...auth, password: v })} masked />
    </>
  );
}

function BearerBody(props: { auth: Extract<AuthConfig, { type: "bearer" }>; onChange: (a: AuthConfig) => void }) {
  const { auth, onChange } = props;
  return (
    <>
      <Field label="Token" value={auth.token} onChange={(v) => onChange({ ...auth, token: v })} masked />
      <div className="flex items-center gap-2 px-4 py-[10px] text-muted">
        <span className="text-[11px]" style={{ fontFamily: "var(--font-primary)" }}>
          → Authorization: Bearer {auth.token ? `${auth.token.slice(0, 12)}…` : "<token>"}
        </span>
      </div>
    </>
  );
}

function ApiKeyBody(props: { auth: Extract<AuthConfig, { type: "apikey" }>; onChange: (a: AuthConfig) => void }) {
  const { auth, onChange } = props;
  return (
    <>
      <Field label="Key" value={auth.key} onChange={(v) => onChange({ ...auth, key: v })} placeholder="X-API-Key" />
      <Field label="Value" value={auth.value} onChange={(v) => onChange({ ...auth, value: v })} masked />
      <div className="flex items-center gap-3 px-4 py-3">
        <label className="w-[140px] text-[12px] font-medium text-muted" style={{ fontFamily: "var(--font-secondary)" }}>Add to</label>
        <div className="inline-flex items-center gap-[2px] p-[2px] rounded-[6px] bg-card border border-border">
          {(["header", "query"] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => onChange({ ...auth, addTo: loc })}
              className={`px-3 py-1 rounded-[4px] cursor-pointer text-[11px] font-semibold ${
                auth.addTo === loc ? "bg-secondary text-foreground" : "text-muted"
              }`}
              style={{ fontFamily: "var(--font-secondary)" }}
            >
              {loc === "header" ? "Header" : "Query"}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/request/auth/AuthTab.tsx
git commit -m "feat(request): add AuthTab with None/Basic/Bearer/API Key"
```

---

### Task 16: `RequestPanel` (assemble the three)

**Files:**
- Create: `src/components/request/RequestPanel.tsx`
- Create: `src/components/request/RequestEmpty.tsx`

- [ ] **Step 1: Write `RequestEmpty`**

```tsx
// src/components/request/RequestEmpty.tsx
import { Hexagon } from "lucide-react";

export function RequestEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
      <Hexagon size={32} className="text-muted opacity-50" />
      <span className="text-[13px]" style={{ fontFamily: "var(--font-secondary)" }}>
        Select a request from the sidebar or create a new one.
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Write `RequestPanel`**

```tsx
// src/components/request/RequestPanel.tsx
import { useRequestStore } from "../../store/requestStore";
import { UrlBar } from "./UrlBar";
import { RequestTabsStrip } from "./RequestTabsStrip";
import { ParamsTab } from "./ParamsTab";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./body/BodyTab";
import { AuthTab } from "./auth/AuthTab";
import { RequestEmpty } from "./RequestEmpty";

export function RequestPanel() {
  const activeId = useRequestStore((s) => s.activeId);
  const activeTab = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.activeTab : null));

  if (!activeId) return <RequestEmpty />;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-2">
        <UrlBar requestId={activeId} />
      </div>
      <RequestTabsStrip requestId={activeId} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "params" && <ParamsTab requestId={activeId} />}
        {activeTab === "body" && <BodyTab requestId={activeId} />}
        {activeTab === "headers" && <HeadersTab requestId={activeId} />}
        {activeTab === "auth" && <AuthTab requestId={activeId} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/request/RequestPanel.tsx src/components/request/RequestEmpty.tsx
git commit -m "feat(request): assemble RequestPanel"
```

---

### Task 17: `ResponsePlaceholder` pane

**Files:**
- Create: `src/components/response/ResponsePlaceholder.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/response/ResponsePlaceholder.tsx
import { PanelRight } from "lucide-react";

export function ResponsePlaceholder() {
  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex items-center gap-2 px-4 py-[10px] border-b border-border">
        <span
          className="text-[10px] font-semibold tracking-[0.6px] text-muted"
          style={{ fontFamily: "var(--font-secondary)" }}
        >
          RESPONSE
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 flex-1 text-muted">
        <PanelRight size={28} className="opacity-50" />
        <span className="text-[13px]" style={{ fontFamily: "var(--font-secondary)" }}>
          Hit Send to see the response.
        </span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/response/ResponsePlaceholder.tsx
git commit -m "feat(response): add ResponsePlaceholder pane"
```

---

### Task 18: `CentralPanel` (3-pane resizable container)

**Files:**
- Create: `src/components/CentralPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/CentralPanel.tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { RequestPanel } from "./request/RequestPanel";
import { ResponsePlaceholder } from "./response/ResponsePlaceholder";

export function CentralPanel() {
  return (
    <PanelGroup direction="horizontal" autoSaveId="hex-central">
      <Panel defaultSize={20} minSize={12} maxSize={40}>
        <Sidebar />
      </Panel>
      <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={48} minSize={30}>
        <RequestPanel />
      </Panel>
      <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={32} minSize={20}>
        <ResponsePlaceholder />
      </Panel>
    </PanelGroup>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/CentralPanel.tsx
git commit -m "feat: add CentralPanel 3-pane resizable container"
```

---

### Task 19: Mount `CentralPanel` in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Swap the Sidebar mount for CentralPanel**

Replace lines 22–28 with:

```tsx
  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Titlebar />
      <div className="flex-1 overflow-hidden">
        <CentralPanel />
      </div>
    </div>
  );
```

Also remove the now-unused `Sidebar` import and add:

```tsx
import { CentralPanel } from "./components/CentralPanel";
```

- [ ] **Step 2: Verify visually**

Run: `pnpm tauri dev`. Confirm:
- Three panes visible: Sidebar (~20%) | Request (empty state) | Response placeholder.
- Panes are draggable at the two vertical dividers.
- Window resize preserves proportions.
- Empty request panel shows "Select a request…" copy.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount CentralPanel in App"
```

---

### Task 20: Wire Sidebar → open request in `requestStore`

**Files:**
- Modify: `src/components/CollectionTree.tsx`
- Modify: `src/store/collectionStore.ts` (only if needed to expose `setActiveRequest` semantics)

The `CollectionTree` already tracks an active request via `useCollectionStore.setActiveRequest`. We now also need to open that request in `useRequestStore` when a REST request is clicked, so the RequestPanel picks it up.

- [ ] **Step 1: Read `CollectionTree.tsx`**

Skim to find where a request node is clicked (there is an `onClick` on request rows). Look for the call to `setActiveRequest`.

- [ ] **Step 2: On request click, also call `openRequest`**

At the click handler for a REST request row, add:

```tsx
import { useRequestStore } from "../store/requestStore";
import { HttpMethod, HTTP_METHODS } from "../lib/request-types";

// inside the component or handler:
const openRequestInStore = useRequestStore((s) => s.openRequest);
const setActiveInStore = useRequestStore((s) => s.setActive);

function handleRequestClick(node: /* CollectionNode of kind rest */ any) {
  setActiveRequest(node.id);
  const method = (HTTP_METHODS as readonly string[]).includes(node.method)
    ? (node.method as HttpMethod)
    : "GET";
  openRequestInStore(node.id, node.name, method);
  setActiveInStore(node.id);
}
```

Only apply the store call to REST requests. SOAP nodes are out of scope for this plan — for SOAP clicks, keep the existing `setActiveRequest` behavior but do not call `openRequest` yet.

- [ ] **Step 3: Verify visually**

Run: `pnpm tauri dev`. Steps:
- Create a REST request in the sidebar.
- Click it. The request panel switches from "Select a request…" to a filled `UrlBar` with the request's method.
- Type in the URL field — the value persists when switching tabs.
- Switch between Params / Body / Headers / Auth tabs; each tab reflects its own state.
- Close the app and reopen it. The pane widths should persist (`autoSaveId="hex-central"` writes to `localStorage`).

- [ ] **Step 4: Commit**

```bash
git add src/components/CollectionTree.tsx
git commit -m "feat(request): open selected REST request in requestStore"
```

---

### Task 21: End-to-end smoke walkthrough

**Files:** none.

- [ ] **Step 1: Run the app**

Run: `pnpm tauri dev`

- [ ] **Step 2: Golden path checklist**

Verify by hand — check off each item:
- [ ] Three panes visible; resize handles work.
- [ ] Sidebar shows workspace + collections tree.
- [ ] Click a REST request → RequestPanel populates.
- [ ] Method dropdown opens, changes color-coded label on select, closes on outside click.
- [ ] URL input accepts text and persists per request.
- [ ] Params tab: add row, edit key/value/description, toggle enabled, remove row. Counter in tab strip increments.
- [ ] Headers tab: add row, toggle enabled, remove. Auto headers list at bottom is locked (checkbox → lock icon). Toggle hide-auto with the eye-off icon.
- [ ] Body tab:
  - [ ] JSON mode: type into textarea; click sparkles → pretty-prints if valid JSON, no-op if not.
  - [ ] Switch to `application/x-www-form-urlencoded`: form rows appear (no TYPE column).
  - [ ] Switch to `multipart/form-data`: TYPE column appears; toggling Text/File on a row swaps the value cell for the file chip. Click "Choose file…" — stub filename appears; X clears it.
- [ ] Auth tab:
  - [ ] Type dropdown changes the fields.
  - [ ] Basic → Username/Password fields; password eye toggle works.
  - [ ] Bearer → Token field + preview line.
  - [ ] API Key → Key/Value/Add-to segments (Header|Query).
- [ ] Close the window and reopen — pane sizes preserved.

- [ ] **Step 3: Commit any doc updates**

If you noticed a mismatch between plan and design during the walkthrough, capture it in a follow-up TODO. Do not silently deviate.

```bash
git commit --allow-empty -m "chore: complete request+central panel walkthrough"
```

---

## Follow-ups (out of scope, but flag)

- Wire `Send` to the Rust engine (`send_request` command).
- Replace `BodyJsonEditor` textarea with CodeMirror + `lang-json`.
- File picker via `@tauri-apps/plugin-dialog` — replace the stub filename setter.
- Move the tabs-of-open-requests from `Titlebar.tsx` local state into `useRequestStore.order` / `activeId`.
- SOAP: SchemaForm renderer + `Form ⇄ XML` toggle.
- Response Panel: status header, tabs (Body/Headers/Timing), ResponseTree with copy-leaf, waterfall.

---

## Self-Review

**Spec coverage** — the spec here is the Pencil design + `docs/ui.md` §5 (Request builder) + `docs/product.md` §3 (Request building — REST fields).
- REST UrlBar (method + URL + Send) — Tasks 4–6.
- Tabs Params/Body/Headers/Auth — Tasks 7, 9, 10, 14, 15.
- Body: JSON + form-urlencoded + multipart — Tasks 11–14.
- Auth: None/Basic/Bearer/API Key — Task 15.
- 3-pane resizable — Tasks 18–19.
- Sidebar wiring — Task 20.
- Response Panel is placeholder only — flagged as out of scope.
- SOAP is out of scope — explicitly deferred to a separate plan.
- Send button is UI only — flagged as out of scope.

**Placeholder scan** — none. Every step contains real code or an explicit ponytail note with an upgrade path.

**Type consistency** — `HttpMethod`, `AuthConfig`, `KeyValue`, `OpenRequest` are defined in Task 2 and referenced consistently. Store method names (`openRequest`, `setUrl`, `setMethod`, `setActiveTab`, `setKV`, `addKV`, `removeKV`, `setBodyMode`, `setBodyJson`, `setFormRow`, `addFormRow`, `removeFormRow`, `setAuth`) match across Tasks 3, 6, 7, 9, 10, 14, 15, 16, 20.

**Ambiguity check** — the term "Central Panel" is ambiguous (could mean the middle pane only or the whole 3-pane container). This plan uses the second reading and states it explicitly in the top scope block. If the user pushes back, the swap is trivial: `CentralPanel` becomes `MainPane` (middle only) and a new `PanelsShell` owns the resizable group.
