# Disallow Body for GET/HEAD Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GET/HEAD requests never carry a body — the Body tab is disabled in the UI and the body is stripped on send.

**Architecture:** Frontend-only enforcement. One shared predicate `methodAllowsBody` in `src/lib/request-types.ts`, consumed by the tabs strip (disable Body tab), the request panel (fall back to Params view), and the response store (strip body before invoking the Rust engine). The Rust engine is untouched.

**Tech Stack:** React 19 + TypeScript, zustand, Vitest. Test command: `pnpm test` (or `pnpm vitest run <file>` for a single file).

**Spec:** `docs/superpowers/specs/2026-07-16-get-no-body-design.md`

## Global Constraints

- No `any` in TS. Named exports only. No hardcoded hex colors — Tailwind token classes only.
- `src/bindings.ts` is generated — never edit (not touched by this plan).
- Body content in the store is preserved — never mutate `request.body`; strip only in the spec passed to `api.sendRequest`.
- The no-body wire representation is `{ mode: "json", json: "", form: [] }` — `BodyMode` has no `"none"` and the engine rejects unknown modes.
- Commits: Conventional Commits, single line, no bullet body (trailer lines required by the harness are fine).

---

### Task 1: `methodAllowsBody` predicate + body strip on send

**Files:**
- Modify: `src/lib/request-types.ts` (add predicate after the `HttpMethod` type, line ~4)
- Modify: `src/store/responseStore.ts:41` (the `body:` line in `send`)
- Test: `src/store/responseStore.test.ts`

**Interfaces:**
- Produces: `methodAllowsBody(m: HttpMethod): boolean` exported from `src/lib/request-types.ts` — `false` for `"GET"` and `"HEAD"`, `true` otherwise. Task 2 imports it.

- [ ] **Step 1: Write the failing test**

Add to the `describe("send", ...)` block in `src/store/responseStore.test.ts`:

```ts
  it("strips the body for GET/HEAD methods", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    const req = request(); // method: "GET"
    req.body = { mode: "json", json: '{"a":1}', form: [] };
    await useResponseStore.getState().send(req);
    expect(api.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: { mode: "json", json: "", form: [] } })
    );
    // store body untouched
    expect(req.body.json).toBe('{"a":1}');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/store/responseStore.test.ts`
Expected: FAIL — `sendRequest` was called with `json: '{"a":1}'`, not `json: ""`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/request-types.ts`, after the `HttpMethod` type (line 4):

```ts
/** GET/HEAD must not carry a body (spec-level rule enforced in the UI and on send) */
export const methodAllowsBody = (m: HttpMethod) => m !== "GET" && m !== "HEAD";
```

In `src/store/responseStore.ts`, import the predicate and strip the body. Change the import on line 3:

```ts
import { OpenRequest, methodAllowsBody } from "../lib/request-types";
```

Change line 41 (`body: request.body,`) to:

```ts
        body: methodAllowsBody(request.method)
          ? request.body
          : { mode: "json", json: "", form: [] },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/store/responseStore.test.ts`
Expected: PASS — all tests including the new one. (The existing "builds the spec from the open request" test uses `method: "POST"` and is unaffected.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/request-types.ts src/store/responseStore.ts src/store/responseStore.test.ts
git commit -m "feat(request): strip body on send for GET/HEAD"
```

---

### Task 2: Disable Body tab in the UI for GET/HEAD

No component test infra exists (no `*.test.tsx` in the repo); per spec, this task is verified by typecheck + manual run, not new test infra.

**Files:**
- Modify: `src/components/request/RequestTabsStrip.tsx`
- Modify: `src/components/request/RequestPanel.tsx`

**Interfaces:**
- Consumes: `methodAllowsBody(m: HttpMethod): boolean` from `src/lib/request-types.ts` (Task 1).

- [ ] **Step 1: Disable the Body tab button**

In `src/components/request/RequestTabsStrip.tsx`:

Change the import on line 2 to include the predicate:

```ts
import { RequestTab, methodAllowsBody } from "../../lib/request-types";
```

Read the method from the store (next to the existing selectors, after line 19):

```ts
  const method = useRequestStore((s) => s.openRequests[requestId]?.method ?? "GET");
```

Inside the `TABS.map` callback, compute the disabled state and apply it. Replace the button (lines 28–45) with:

```tsx
        const disabled = t.key === "body" && !methodAllowsBody(method);
        const isActive = active === t.key && !disabled;
        return (
          <button
            key={t.key}
            type="button"
            disabled={disabled}
            title={disabled ? "GET/HEAD requests don't use a body" : undefined}
            onClick={() => setActiveTab(requestId, t.key)}
            className={`flex items-center gap-[6px] py-3 border-b-2 ${
              disabled
                ? "border-transparent text-muted/40 cursor-not-allowed"
                : isActive
                  ? "border-primary text-foreground cursor-pointer"
                  : "border-transparent text-muted hover:text-foreground cursor-pointer"
            }`}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <span className="text-[13px] font-medium">{t.label}</span>
            {count(t.key) > 0 && (
              <span className="text-[10px] px-[5px] py-[1px] rounded-full bg-secondary text-muted">
                {count(t.key)}
              </span>
            )}
          </button>
        );
```

(`text-muted/40` is a Tailwind opacity modifier on the existing `--muted` token — no new colors.)

- [ ] **Step 2: Fall back to Params when Body is active but not allowed**

In `src/components/request/RequestPanel.tsx`:

Add imports:

```ts
import { methodAllowsBody } from "../../lib/request-types";
```

Read the method (after the `activeTab` selector, line 13):

```ts
  const method = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.method : undefined));
```

Replace the tab-content lines 36–37:

```tsx
        {(activeTab === "params" ||
          (activeTab === "body" && method !== undefined && !methodAllowsBody(method))) && (
          <ParamsTab requestId={activeId} />
        )}
        {activeTab === "body" && method !== undefined && methodAllowsBody(method) && (
          <BodyTab requestId={activeId} />
        )}
```

Note: the stored `activeTab` stays `"body"`; only the rendered view falls back. The strip already shows Body as inactive when disabled (Step 1 sets `isActive = false` for a disabled tab) — Params won't show as highlighted, which is acceptable: no tab underline while the fallback view shows. Switching back to POST re-renders BodyTab with content intact.

- [ ] **Step 3: Typecheck and full test suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: no type errors; all Vitest suites PASS.

- [ ] **Step 4: Manual verification (app)**

Run: `pnpm tauri dev`
Check: open a request, set method POST, type a json body → switch to GET: Body tab dims and can't be clicked, view falls back to Params → Send hits the wire with no body → switch back to POST: Body tab re-enables with the typed content intact.

- [ ] **Step 5: Commit**

```bash
git add src/components/request/RequestTabsStrip.tsx src/components/request/RequestPanel.tsx
git commit -m "feat(request): disable body tab for GET/HEAD methods"
```
