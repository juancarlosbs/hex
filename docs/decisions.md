# Architecture Decision Records (ADRs) — Hex

> Each ADR records: context, decision, discarded alternatives, and consequences (including
> the trade-offs we ACCEPTED). Rule for the agent: do not revert a decision here without
> opening an explicit discussion. If an implementation contradicts an ADR, the ADR wins.

Format: **Status** (Accepted / Proposed / Superseded) · Context · Decision · Alternatives · Consequences.

---

## ADR-001 — One unified REST + SOAP app (not two projects)

**Status**: Accepted

**Context**: The two original ideas (Postman-style REST client and SoapUI replacement) share ~90% of the surface: sidebar, tabs, response viewer, timing, persistence, HTTP engine. SOAP is, in the end, an HTTP POST with `text/xml` + `SOAPAction` header.

**Decision**: A single app where the protocol is an **attribute of the request**, not a separate screen. A SOAP operation is just another type of node in the same tree as REST collections.

**Alternatives**: (a) Two separate apps — discarded: two half-projects < one deep project; (b) SOAP-only app — discarded: REST provides the fast basic flow and serves as foundation.

**Consequences**: Single portfolio narrative ("client for those who suffer with legacy tooling"). The difference between protocols only shows up in the request builder (schema form vs free body) and a badge. Cost: the request model must accommodate both protocols from the start.

---

## ADR-002 — Tauri v2 (Rust) as the desktop platform

**Status**: Accepted

**Context**: We need a desktop app with low footprint (anti-SoapUI, which is heavy Java), network access without CORS, and a strong technical story for a senior portfolio.

**Decision**: Tauri v2 with React 19/TS/Vite frontend and Rust core.

**Alternatives**: (a) Electron — discarded: high footprint, no Rust story, and "another Electron app" doesn't differentiate; (b) Pure web app — discarded: CORS kills the product (browser API client can't talk to any API) and loses per-phase timing.

**Consequences**: Small binary, native engine, and the interview argument "why not fetch in the browser". Cost: Rust learning curve + two-language toolchain; webview varies by OS (WKWebView/WebView2/WebKitGTK).

---

## ADR-003 — Hexagonal architecture with pure domain

**Status**: Accepted

**Context**: The project's value is in the logic (WSDL/XSD parsing, `SchemaNode`, envelope serialization, timing) — which needs to be testable without network/fs and demonstrable in interviews.

**Decision**: Ports & adapters in Rust. `domain/` is **pure, no I/O**. Adapters: `engine/` (HTTP), `wsdl/` (parsing), `persistence/` (fs), `commands/` (IPC, thin — only validate and delegate).

**Alternatives**: (a) Logic in commands — discarded: couples domain to Tauri, not unit-testable; (b) loose MVC — discarded: no clear boundary, domain leaks into I/O.

**Consequences**: `cargo test` covers the heart without spinning up the app; swapping hyper/persistence doesn't touch the domain; the architecture itself becomes an interview topic (it's the pattern behind the Hex-agonal name). Cost: more boundary boilerplate (input/output types per layer).

---

## ADR-004 — Requests come from Rust, never from the webview

**Status**: Accepted

**Context**: `fetch` in the webview suffers from CORS, hides connection phases, and limits headers/protocols. The product's differentiators depend on full transport control.

**Decision**: All HTTP traffic runs in the Rust core. The frontend only calls typed commands via IPC.

**Alternatives**: fetch in the frontend with a Rust proxy only when needed — discarded: two network paths = two behaviors, and per-phase timing is lost on the fetch path.

**Consequences**: No CORS, real timing, free headers. Cost: every request crosses the IPC bridge (serialization), and streaming large responses requires Tauri events instead of a single return.

---

## ADR-005 — Instrumented HTTP engine on top of hyper (not reqwest) for the waterfall

**Status**: Accepted (with MVP shortcut)

**Context**: The timing waterfall (DNS/TCP/TLS/TTFB/download) is differentiator #3. reqwest **does not expose** connection phases (there's no equivalent to Go's `httptrace`).

**Decision**: Custom transport on top of `hyper` + `hyper-util`, with a **connector decorator** that stamps `Instant` at each boundary: DNS via isolated `hickory-resolver`, TCP connect, TLS handshake via `tokio-rustls`, TTFB on the first body byte, download until the last byte.

**Alternatives**: (a) Pure reqwest — kept only as **MVP shortcut** to get the REST flow up fast (total + approximate TTFB), swapped when tackling the waterfall; (b) measure with a parallel request (like crate `ttfb`) — discarded: would measure a different connection, not the user's actual request.

**Consequences**: True waterfall and the best technical story in the project ("I built an HTTP engine, didn't use one"). Cost: pooling/redirects/decompression that reqwest provided for free become our responsibility — implement only what's needed.

---

## ADR-006 — rustls throughout the stack (OpenSSL/native-tls forbidden)

**Status**: Accepted

**Context**: Native TLS varies by OS, complicates cross-platform builds, and mixes two TLS stacks if any dep pulls native-tls.

**Decision**: `rustls` (+ `rustls-native-certs` for the system CA store) in all deps. No feature that pulls OpenSSL.

**Consequences**: Reproducible builds on all 3 OSes, a single TLS path to instrument in the waterfall. Cost: rare legacy servers with old cipher suites may fail where OpenSSL would pass — accepted (and detectable in the future with an "insecure" option).

---

## ADR-007 — Typed IPC bridge with tauri-specta (pin `=` during RC)

**Status**: Accepted — ⚠️ **not yet wired (as of 2026-07-18)**. The `specta`/`tauri-specta` crates are **not in `Cargo.toml`**, no type derives `specta::Type`, `lib.rs` uses `tauri::generate_handler!` (not `tauri_specta::Builder`), and `src/bindings.ts` **does not exist**. The frontend currently uses **hand-written types in `src/lib/api.ts`** with bare `invoke()` — the exact drift this ADR exists to prevent. **TODO (own slice):** add the pinned crates, derive `specta::Type` on IPC types (`OperationRef`, `QName`, `SchemaNode`, …), wire the builder export, and replace `api.ts` hand-written types with `bindings.ts`. Until then, new IPC types derive only `Serialize, Deserialize` (matching `domain/wsdl.rs`).

**Context**: The Rust↔TS boundary is where silent bugs are born (diverging payloads). We want changing a command to break the frontend at compile-time.

**Decision**: `tauri-specta` v2 generates `src/bindings.ts` from commands/events. `specta`/`tauri-specta` versions **pinned with `=`** while in RC. Export only under `debug_assertions`, outside a folder watched by hot-reload.

**Alternatives**: `invoke("string", …)` manually with hand-written types — discarded: inevitable drift between sides.

**Consequences**: Single contract, safe refactors. Cost: RC dependency (mitigated by the pin) and a generation step in the flow.

---

## ADR-008 — roxmltree for reading XML, quick-xml (writer) for writing

**Status**: Accepted

**Context**: We need to parse WSDL, XSD, and responses (reading with tree traversal and namespace support) and serialize SOAP envelopes (writing with namespace control).

**Decision**: `roxmltree` as the single read-only parser (fast, read-only, excellent traversal ergonomics). `quick-xml` in writer mode to build the envelope.

**Alternatives**: (a) quick-xml for everything — possible, but the event-based read API is worse for schema traversal; (b) serde-xml — discarded: static mapping doesn't work for dynamic arbitrary-schema XML.

**Consequences**: Each library doing what it does best. Cost: two XML libs instead of one (accepted; disjoint roles).

---

## ADR-009 — Custom introspectable `SchemaNode`, not codegen

**Status**: Accepted

**Context**: Rust XSD crates are mostly **code generators** (XSD → structs at compile-time). Our case is the opposite: the user pastes an unknown WSDL at runtime and the UI builds a form from it.

**Decision**: Walk the XSD manually and build a custom model (`SchemaNode`: name, type, min/max occurs, nillable, enum values, children). This model is the contract between parser, UI form, and envelope serializer.

**Alternatives**: (a) xsd-parser (Bergmann89) via MetaTypes intermediate layer — plausible, kept as plan B if the subset grows; (b) codegen — impossible by product definition.

**Consequences**: Full control over the supported subset, lean model for IPC, and the central demonstrable piece ("how do you handle arbitrary schema at runtime"). Cost: we implement XSD semantics ourselves — mitigated by ADR-010.

---

## ADR-010 — Conscious XSD subset in MVP (the cut is a feature)

**Status**: Accepted

**Context**: Full XSD is a bottomless pit (`xs:any`, substitution groups, redefines, recursive types, rpc/encoded, WS-Security). Supporting everything kills the project.

**Decision**: MVP supports: `sequence`, simple types (string/int/decimal/boolean/date/dateTime/gYearMonth), `enumeration`, `minOccurs`/`maxOccurs` (incl. unbounded), `nillable`, `choice`, nested complex types, and **transitive `import`/`include` resolution** (this goes in MVP because real WSDLs are almost never single-file). Outside MVP: `xs:any`/`anyType` (falls back to raw editor), rpc/encoded (document/literal only), substitution groups, WS-Security, MTOM. Recursive types: lazy expansion + depth cap + badge.

**Consequences**: Executable scope and a senior argument ("knowing what not to build"). Cost: some enterprise WSDLs will partially fall back to the raw editor — acceptable, raw is the official escape hatch (ADR-013).

---

## ADR-011 — Git-friendly storage: 1 file per request; SQLite only for history

**Status**: Accepted

**Context**: SoapUI's monolithic project file (one giant XML) is impossible to merge and is one of the most cited pain points. Developers want to version their workspace in Git.

**Decision**: Collections/requests persisted as **individual text files** (serde → readable YAML/TOML), mirroring the sidebar tree. Execution history (voluminous, not versionable) can go to SQLite via `tauri-plugin-sql`, separately.

**Alternatives**: (a) SQLite for everything — discarded: kills workspace diff/merge/PR; (b) single JSON — discarded: recreates the SoapUI problem.

**Consequences**: Versionable and PR-reviewable workspaces (differentiator #4). Cost: rename/move = fs operations; consistency between tree and disk requires care.

---

## ADR-012 — Frameless window + titlebar overlay via tauri-plugin-decorum

**Status**: Accepted

**Context**: The custom titlebar (workspace switcher + tabs in the bar) is part of the visual identity. Doing it manually (`decorations: false`) breaks resize/Snap on Windows and traffic light handling on macOS.

**Decision**: `tauri-plugin-decorum`: `create_overlay_titlebar()` + `set_traffic_lights_inset()` on macOS; `titleBarStyle: "Overlay"` + `hiddenTitle: true` in conf. `data-tauri-drag-region` on the empty strip (remembering it doesn't inherit to children).

**Consequences**: Consistent overlay on all 3 OSes while preserving native behaviors. Known and accepted costs: bar height varies by OS (don't hardcode px) and there's a window-drag-without-focus limitation (old Tauri issue).

---

## ADR-013 — Form-first with raw XML escape hatch (Form ⇄ XML toggle)

**Status**: Accepted

**Context**: The user's #1 pain is writing envelopes by hand; but arbitrary schemas will always have corners the form can't cover (`xs:any`, subset edge cases).

**Decision**: The form generated from `SchemaNode` is the primary mode. Toggle to view/edit the raw envelope (CodeMirror + lang-xml). MVP: form → XML (preview). Bidirectional XML → form sync is v2.

**Consequences**: Nobody gets stuck (raw always exists), and the form remains the product. Cost: two editing modes require a clear definition of which is the source of truth (in MVP: the form; editing raw disables the form until reset).

---

## ADR-014 — Frontend: shadcn/ui + CSS tokens, zustand, react-query, virtualization

**Status**: Accepted

**Context**: The design tokens (defined in Pencil) already follow the shadcn variable vocabulary (`--background/-card/-primary/…`) + semantics (`--method-*`, `--soap-op`, `--status-*`, `--timing-*`, `--field-*`). Enterprise WSDLs generate trees with hundreds of nodes.

**Decision**: Tailwind + shadcn/ui themed by tokens (hardcoded hex in components forbidden). App state in `zustand`; IPC calls wrapped in `react-query` (loading/error states). Trees (operations, response, form) **virtualized** with `@tanstack/react-virtual`. Panels with `react-resizable-panels`, editors with CodeMirror, palette with `cmdk`. Recursive components for `SchemaForm` and `ResponseTree`.

**Alternatives**: Redux — unnecessary for this scope; CSS-in-JS — conflicts with the token pipeline.

**Consequences**: UI matches the design 1:1; no freezing on large trees (SoapUI out-of-memory is exactly the anti-case). Cost: virtualization complicates selection/scroll — treated as part of the critical path.

---

## ADR-015 — Test pyramid: domain in cargo test, UI with mockIPC, minimal E2E on CI Linux

**Status**: Accepted

**Context**: Development is on macOS, where WebDriver for WKWebView is historically problematic; business logic lives in the pure domain.

**Decision**: (1) Bulk of tests in `cargo test` on domain/WSDL pipeline (pure functions, tempdir for persistence); (2) UI wiring with Vitest + `mockIPC` from bindings; (3) **one** happy-path E2E (hero flow) running on CI Linux (`webkit2gtk-driver`); locally on Mac, optionally `tauri-plugin-webdriver` (debug-only dep).

**Consequences**: Fast local feedback, coverage where the logic lives, E2E without platform headaches. Cost: E2E doesn't run natively in the Mac local flow by default — accepted.

---

## ADR-016 — Name and brand: Hex, within the Halloween suite

**Status**: Accepted

**Context**: The author's personal projects follow a Halloween theme with domain double meaning (e.g.: Pumpkin for a gym app → "pump"). For this project, the name needed to belong to the theme and resonate with what the app is.

**Decision**: **Hex** — spell (Halloween) + hexadecimal (bytes/protocol) + hexagonal architecture (ADR-003) + hexagon ⬢ (icon for SOAP operations in the design).

**Alternatives**: witch (homophone of "which", bad SEO), Cauldron, Wraith, Rune.

**Consequences**: 3-letter name, typeable, with 4 layers of meaning that reinforce the project itself. Domain/registration: use subdomain of personal domain (hex.<domain>.dev) instead of buying a dedicated domain.
