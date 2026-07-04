# Stack & Dependencies — Hex

> Exact libraries, with features, pins, and setup gotchas. Rule for the agent: use these
> deps and versions; don't swap a lib for another without opening a discussion (many choices are
> ADRs — e.g.: hyper vs reqwest, roxmltree vs quick-xml, rustls vs native-tls). Library state
> validated in Jun/2026 — confirm the latest stable version when running `add`.

Stack: **Tauri v2** · frontend **React 19 + TS (Vite)** · engine **Rust**.
JS package manager: **pnpm**. Rust: workspace in `src-tauri/`.

---

## 1. Rust (`src-tauri/Cargo.toml`)

### Tauri + typed bridge (ADR-007)
```toml
tauri = { version = "2", features = [] }
# Pin with "=" during RC phase (breaking between RCs):
spectra            = "=2.0.0-rc.24"
specta-typescript = "=0.0.11"
tauri-specta      = { version = "=2.0.0-rc.24", features = ["derive", "typescript"] }
serde      = { version = "1", features = ["derive"] }
serde_json = "1"
```

### Instrumented HTTP engine (ADR-005 — the waterfall differentiator)
> reqwest does NOT expose phases (DNS/TCP/TLS) — there's no equivalent to Go's `httptrace`.
> For a real waterfall, build the transport on top of hyper and stamp each phase.
```toml
tokio            = { version = "1", features = ["full"] }
hyper            = { version = "1", features = ["client", "http1", "http2"] }
hyper-util       = { version = "0.1", features = ["client", "client-legacy", "tokio"] }
http-body-util   = "0.1"
hickory-resolver = "0.24"   # isolated DNS (ex-trust-dns) -> measures DNS phase
tokio-rustls     = "0.26"   # isolated TLS handshake -> measures TLS phase
rustls           = "0.23"
rustls-native-certs = "0.8" # system CA store (ADR-006)
```
How to measure: `Instant` at DNS start/done, TCP connect, TLS handshake, TTFB (first body byte),
download (until last byte). Study reference: crate `ttfb` (phip1611) —
does DNS/TCP/TLS/TTFB on HTTP/1.1; good map, but you integrate it into the real request, not in parallel.

**MVP shortcut** (REST flow up fast — milestone step 3): `reqwest` with
`features = ["rustls-tls","json","stream","gzip","brotli"]` gives total + approximate TTFB.
Swap for the hyper engine when tackling the waterfall (step 4). NEVER enable a feature that pulls
native-tls/OpenSSL (ADR-006).

### WSDL / XSD / SOAP — XML (ADR-008, ADR-009)
```toml
roxmltree   = "0.20"   # READ: WSDL, XSD and the response tree (read-only, fast)
quick-xml   = { version = "0.37", features = ["serialize"] }  # WRITE the SOAP envelope
url         = "2"
# Optional (plan B if XSD subset grows — ADR-009/010):
# xsd-parser = "..."   # has introspectable IR (MetaTypes) + URL-based schema resolvers
```
Recommendation: **roxmltree** parses everything; **quick-xml** (writer) serializes the envelope.
Walk the XSD yourself for the MVP subset (ADR-010) — that's your `SchemaNode`.

### Errors & persistence
```toml
thiserror  = "2"    # typed errors for domain/engine
anyhow     = "1"    # errors at the command level
serde_yaml = "0.9"  # collections format (1 file per request, ADR-011) — or toml
# tempfile = "3"    # (dev-dependency) persistence tests with tempdir
```

### Tauri v2 plugins
```toml
tauri-plugin-decorum            = "..."  # titlebar overlay (ADR-012)
tauri-plugin-window-state       = "2"    # persists window size/position
tauri-plugin-fs                 = "2"    # request/collection files (git-friendly)
tauri-plugin-dialog             = "2"    # open WSDL / save
tauri-plugin-clipboard-manager  = "2"    # copy-leaf to clipboard
tauri-plugin-store              = "2"    # settings (lightweight kv)
# tauri-plugin-sql              = "2"    # OPTIONAL: history in SQLite (ADR-011)
```

### Tauri feature for tests (ADR-015)
```toml
[dev-dependencies]
tauri = { version = "2", features = ["test"] }  # mock_builder / MockRuntime
```

---

## 2. Frontend (`package.json`)

### Base
```
@tauri-apps/api
@tauri-apps/plugin-{fs,dialog,clipboard-manager,store,window-state}
react@19  react-dom@19  vite  typescript
```

### UI / design system (ADR-014 — matches design tokens)
> Tokens ARE shadcn variables (`--background/-foreground/-card/-primary/-secondary/`
> `-muted/-accent/-destructive/-border/-input/-ring/-sidebar*/-popover`) + semantics
> (`--method-*`, `--soap-op`, `--status-*`, `--timing-*`, `--field-*`). Single source: `styles/tokens.css`.
```
tailwindcss              # NOTE: v4 — shadcn setup differs from v3
shadcn/ui                # via CLI; brings Radix underneath
class-variance-authority  clsx  tailwind-merge
lucide-react             # icons (same as design)
@fontsource/jetbrains-mono   geist   # JetBrains Mono (data) + Geist (chrome)
```
shadcn covers the primitives: **Tabs, Select/DropdownMenu, Dialog** (modals), **Tooltip**,
**ToggleGroup** (`xs:choice` selector and Form/XML toggle), **Collapsible** (optionals and nodes).

### State, data, performance
```
zustand                 # app state: collections, tabs, active request, settings
@tanstack/react-query   # wraps invokes (loading/error/cache for send and import)
@tanstack/react-virtual # VIRTUALIZES operations tree and response tree (large WSDL)
react-resizable-panels  # resizable three-pane + collapsible sidebars
```

### Editors / interaction
```
@uiw/react-codemirror  @codemirror/lang-xml  @codemirror/lang-json
                        # Form/XML editor (envelope) and Raw views, with highlighting
cmdk                    # Cmd-K command palette
# react-hook-form + zod # OPTIONAL; recursive form driven by SchemaNode tends to be
                        # cleaner with controlled state in zustand (see domain-model.md)
```

### Tests (ADR-015)
```
vitest  @testing-library/react  @testing-library/user-event  jsdom
# E2E: webdriverio + (@wdio/* config); on Mac locally, tauri-plugin-webdriver (dev-only)
```

---

## 3. Setup gotchas (what usually burns time)

- **Pin `specta`/`tauri-specta` with `=`** — they're in RC, breaking between versions. New builder:
  `tauri_specta::Builder::<Wry>::new().commands(collect_commands![...]).events(collect_events![...])`
  and `.export(specta_typescript::Typescript::default(), "../src/bindings.ts")` under `#[cfg(debug_assertions)]`.
- **DO NOT export `bindings.ts` into a folder watched by hot-reload** — causes an infinite reload loop.
- **rustls throughout the stack** (ADR-006) — no feature that pulls OpenSSL/native-tls, not even transitively.
- **Tailwind v4** has a different shadcn setup than v3 — follow the v4 guide (config in CSS, not in `tailwind.config.js`).
- **Titlebar (decorum)**: `create_overlay_titlebar()` + (macOS) `set_traffic_lights_inset(...)`; `tauri.conf.json` with `titleBarStyle:"Overlay"`, `hiddenTitle:true`. `data-tauri-drag-region` does not inherit to children — mark interactive elements as non-draggable.
- **Heavy history in SQLite** separate from versionable collections (ADR-011) — don't mix them in the same file.
- **`geist`** is Vercel's font package; `@fontsource/jetbrains-mono` brings the mono. Register both font families in CSS and reference them via typography tokens.

---

## 4. Reference template

`github.com/dannysmith/tauri-template` — Tauri v2 + React 19 + TS + tauri-specta +
resizable panels + platform titlebar + Claude Code integration. Good structural starting point
(don't copy blindly; adapt to the layers in `architecture.md`).

---

## 5. Commands (reflect in CLAUDE.md)

```
pnpm tauri dev            # development
pnpm tauri build          # production build
pnpm test                 # Vitest (frontend)
pnpm test:e2e             # E2E (CI Linux; see testing.md)
cargo test                # inside src-tauri/ (domain + pipeline)
cargo fmt && cargo clippy # before commit
pnpm lint
pnpm tauri icon           # generate app icons from 1024px PNG (Hex logo)
```
