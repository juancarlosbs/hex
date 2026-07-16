# Product — Hex

> Functional scope of Hex: vision, prioritized features, modals, flows, and — just as important
> — what stays OUT. Rule for the agent: do not implement anything marked 🔵 (v2) or ❌
> (non-goal) without explicit confirmation. In scope conflicts, this doc wins over code.

Legend: **🟢 MVP** · **🔵 v2/later** · **⭐ differentiator (critical path)** · **[S]** SOAP only · **[R]** REST only

---

## 1. Vision

**Hex is a native API client (REST + SOAP/WSDL) for devs who suffer with legacy tooling.**

Thesis: the SOAP space is abandoned — SoapUI is a 2005 Java monster; Postman/Insomnia
treat SOAP as a second-class citizen. Developers integrating legacy systems (banks, government,
FGTS) edit XML envelopes by hand every day. Hex solves this with a schema-generated form,
in a native, fast, git-friendly app.

**Target user**: full stack dev in fintech/enterprise who consumes legacy SOAP services
AND modern REST APIs on the same work day.

**Anti-vision**: Hex is NOT a "complete Postman". It is deep in one flow (the hero flow),
not wide across a hundred features.

### The 4 differentiators (never regress)

1. **Schema-generated form** — fill a SOAP operation **without writing XML**.
2. **Isolated copy-leaf** — in the response, select/copy the value without the key/tag.
3. **Real timing waterfall** — DNS/TCP/TLS/TTFB/download per request.
4. **Git-friendly storage + native speed** — 1 file per request; opens instantly.

---

## 2. The hero flow

This is the flow that must be flawless — it's what a recruiter/user tests first:

```
empty state → "Import WSDL" → operations appear in sidebar
→ click an operation → pre-built form (required fields marked, enums in dropdown)
→ fill in → Send → timing waterfall + response tree with copy-leaf
```

Every prioritization decision exists so this flow ships first and perfect.
Implementation order: see `docs/architecture.md` (milestones).

---

## 3. Features

### Workspace & organization

| Feature | Priority |
|---|---|
| Collections with nested folders + drag-reorder | 🟢 |
| Open request tabs (in titlebar) | 🟢 |
| Send history per request | 🟢 |
| Import WSDL (URL or file) **[S]** | 🟢⭐ |
| Git-friendly plain-text storage (1 file per request) | 🟢⭐ |
| Multiple workspaces (switcher in titlebar) | 🟢 |
| Import OpenAPI / Postman / cURL **[R]** | 🔵 |
| Export cURL / generate code snippet | 🔵 |
| Command palette ⌘K (keyboard-driven navigation/run) | 🔵⭐ |

### Request building

| Feature | Priority |
|---|---|
| Schema-generated form (XSD→UI) **[S]** | 🟢⭐ *(the central piece)* |
| Form ⇄ XML toggle (envelope preview; see ADR-013) **[S]** | 🟢 |
| Automatic `SOAPAction` / `Content-Type` from binding **[S]** | 🟢 |
| Method/URL bar + JSON/raw/form-data body **[R]** | 🟢 |
| Query params + path variables **[R]** | 🟢 |
| Headers editor (both) | 🟢 |
| Auth: Basic / Bearer / API key | 🟢 |
| Environment variables `{{var}}` interpolated | 🟢⭐ |
| Required field validation before Send (authoritative in Rust) | 🟢 |
| Auth: OAuth2 (redirect flow) | 🔵 |
| WS-Security (UsernameToken) **[S]** | 🔵 *(UI exists in design; engine is v2)* |
| Bidirectional XML → form sync | 🔵 |

### Response

| Feature | Priority |
|---|---|
| XML/JSON tree with **copy-leaf ⧉** (value without key) | 🟢⭐ |
| Per-phase timing waterfall | 🟢⭐ |
| **SOAP Fault rendered as error** (even with HTTP 200) **[S]** | 🟢 |
| Status/time/size always visible; color by status range | 🟢 |
| Tree ⇄ Raw toggle (with pretty-print) | 🟢 |
| Response headers | 🟢 |
| XPath filter **[S]** / JSONPath **[R]** | 🔵⭐ |
| Search in response · save response · cookies | 🔵 |

### Environments & SOAP-specific

| Feature | Priority |
|---|---|
| Environment manager (dev/staging/prod) | 🟢 |
| WSDL parse + **transitive `import`/`include` resolution** | 🟢⭐ |
| service → binding (SOAP version) → operations tree in sidebar | 🟢 |
| **Update Definition** (re-fetch WSDL at runtime, no restart) | 🟢 |
| `xs:choice` as branch selector · repeatable arrays · collapsed optionals | 🟢 |
| Recursive types: lazy expansion + depth cap + badge | 🟢 |
| `xs:any`/`anyType` → falls back to raw editor for that subnode | 🟢 |
| Scoped variables (global/env/collection) · masked secrets | 🔵 |

### App

| Feature | Priority |
|---|---|
| Custom titlebar (frameless + overlay; decorum) | 🟢 |
| Resizable three-pane with persisted state | 🟢 |
| Dark theme (dark-first); light | 🟢 dark / 🔵 light |
| Basic keyboard shortcuts (Send, new tab, switch tab) | 🟢 |
| TLS: ignore certificate (per request, with warning) | 🔵 |
| Client certificates · proxy · configurable timeout | 🔵 |

---

## 4. Modals / dialogs

| Modal | Priority | Content |
|---|---|---|
| **Import WSDL** | 🟢⭐ | URL or file → schema resolution loading → **operations preview** → confirm. First impression of the product; error path handled (see flow 2). |
| New request / new collection | 🟢 | Name + type (REST/SOAP) + destination in tree. |
| Environment manager | 🟢 | CRUD of environments and variables; mark secret (🔵 masking). |
| Settings | 🟢 | Theme, behavior, shortcuts. |
| Rename / confirm deletion | 🟢 | Deletion always with confirmation (anti-SoapUI: never lose a request). |
| Command palette ⌘K | 🔵 | Non-blocking overlay. |
| Generate code / export | 🔵 | Language/format choice. |
| Keyboard shortcut cheat sheet (`?`) | 🔵 | — |

---

## 5. Flows

### F1 — Hero (onboarding → first request) 🟢⭐
Described in section 2. UI states: empty state with CTA "Import WSDL" or "New request".

### F2 — WSDL Import 🟢⭐
```
paste URL/file → parse → resolve imports/includes transitively
  ├─ success → operations tree preview → confirm → enters sidebar
  └─ FAILURE (external schema 404, timeout, invalid XML, unsupported rpc/encoded)
       → clear error in modal, pointing to WHICH schema failed and why; never silently import partial
```
The error path is an MVP requirement, not polish — it's the #1 real-world pain.

### F3 — Send request 🟢
```
fill form → validate required fields (frontend = UX; Rust = authoritative, see ADR-003)
→ Send → waterfall + response
Error paths (all with dedicated UI):
  · network/DNS/TLS failure → error at the corresponding phase, visible in waterfall
  · timeout → same
  · SOAP Fault (HTTP 200 + soap:Fault in body) → render as structured ERROR, not success
```
Current engine: reqwest shortcut (ADR-005) — total time only; per-phase waterfall and phase-attributed errors land with the instrumented engine.

### F4 — Switch environment 🟢
Switcher in titlebar → re-interpolation of all `{{var}}` in the visible request.

### F5 — Organize 🟢
Save request in collection, move between folders, rename, duplicate. Every mutation
reflects on the filesystem (1 file per request; see ADR-011).

### F6 — Update Definition 🟢
Re-fetch the service WSDL → diff operations (new/removed/changed) → apply.
Saved requests from removed operations are not deleted; they are marked as orphans.

### F7 — Auth setup 🔵 (OAuth2)
Choose type → redirect popup → token capture → applied to headers.

---

## 6. Non-goals ❌ (do not implement; not even "just a start")

- **Pre/post-request scripting** (embedded JS engine) — bottomless pit; kills focus.
- **Full WS-Security** (XML signature/encryption) — UsernameToken only, and only in v2.
- **Mock server from WSDL** — a different product.
- **Collaboration / cloud sync / accounts** — Hex is local-first by thesis (ADR-011).
- **Code-gen for N languages** — at most cURL export (🔵).
- **rpc/encoded, substitution groups, MTOM** — outside the subset (ADR-010); reject with a clear message on import.
- **gRPC / GraphQL / WebSocket** — outside the product thesis. REST + SOAP, period.

Rationale: a portfolio impresses through **depth in a well-finished flow**, not
breadth of half-done features. Any proposal for a ❌ item requires updating this doc first.

---

## 7. MVP "done" metrics

- Hero flow complete without touching XML, on a real WSDL (e.g.: public SOAP test service).
- Importing a WSDL with external `import`/`include` resolves or fails with a useful message.
- SOAP Fault appears as an error, never as a green 200.
- Git-versioned workspace produces readable per-request diffs.
- App opens in < 2s and the response tree with hundreds of nodes scrolls without freezing (virtualization).
