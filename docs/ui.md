# UI & Design System — Hex

> How the frontend looks and is organized: tokens, layout, titlebar, components, and the rendering
> rules for central pieces (SchemaForm, response tree, waterfall). Rule for the agent: color,
> font, and radius come ONLY from tokens (`styles/tokens.css`) — no hardcoded hex in components.
> Types come from `domain-model.md`; folder structure from `architecture.md`.

Dark-first. High density (reference: Yaak/Linear). The values below are from the design (Pencil), source of truth.

---

## 1. Design tokens (`styles/tokens.css`)

shadcn vocabulary + semantics. These ARE the values; `styles/tokens.css` declares them as CSS vars and Tailwind/shadcn reference them.

### Surfaces & text
```
--background   #111111      --foreground        #FFFFFF
--card         #1A1A1A      --card-foreground    #FFFFFF
--popover      #1A1A1A      --muted-foreground   #B8B9B6
--muted        #2E2E2E      --border             #2E2E2E
--input        #2E2E2E      --ring               #666666
--secondary    #2E2E2E      --destructive        #FF5C33
```
> Note: `--accent` is `#111111` (not the orange). The **action color is `--primary`** (`#FF8400`,
> foreground `#111111`) — Send, focus, primary selection. Do not use `--accent` as a highlight color.

### Sidebar
```
--sidebar #18181b   --sidebar-foreground #fafafa   --sidebar-border #ffffff1a
--sidebar-accent #2a2a30 (active item)   --sidebar-ring #71717a
```

### Semantics (what gives devtool identity)
```
Methods:  GET #3FB950 · POST #E3B341 · PUT #FF8400 · DELETE #FF5C33
SOAP op:  --soap-op #A371F7   (+ --soap-op-surface #1C1530)
Status:   2xx #3FB950 · 3xx #58A6FF · 4xx #E3B341 · 5xx #FF5C33
Timing:   dns #58A6FF · tcp #A371F7 · tls #E3B341 · ttfb #FF8400 · download #3FB950
Field:    --field-required #FF5C33 · --field-optional #6E7681
Feedback: error #24100B/#FF5C33 · info #222229/#B2B2FF · success #222924/#B6FFCE · warning #291C0F/#FF8400
```

### Typography & shape
```
--font-primary   JetBrains Mono   (DATA: URL, values, XML, body, timing)
--font-secondary Geist            (CHROME: labels, menus, tabs, buttons)
Radii: --radius-xs 4 · --radius-s 6 · --radius-m 16 · --radius-pill 999
```
The mono(data) / sans(chrome) separation is what makes it feel like a dev tool, not a dashboard. Don't mix them.

---

## 2. Macro layout

Resizable three-pane (`react-resizable-panels`) under the custom titlebar. State (widths, last split, open request) persisted.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  [Workspace ▾]  tab · tab · +        ⌘K search      ⚙   _ ▢ ✕       │ titlebar ~40px
├───────────────┬──────────────────────────────┬─────────────────────────┤
│ SIDEBAR ~280  │ REQUEST (flex, min ~480)     │ RESPONSE (flex, min ~360)│
│ WSDL+REST tree│ url bar · tabs · SchemaForm  │ status · tabs · tree     │
└───────────────┴──────────────────────────────┴─────────────────────────┘
```
Request/response split: horizontal by default (wide screens); toggle to vertical (tall SOAP forms).

---

## 3. Titlebar (frameless + overlay — ADR-012)

`tauri-plugin-decorum`: `create_overlay_titlebar()` + (macOS) `set_traffic_lights_inset(...)`;
`tauri.conf.json` with `titleBarStyle:"Overlay"`, `hiddenTitle:true`.

Content: `[macOS traffic lights] [Workspace ▾]  ·  [open tabs][+]  ·  flex-drag  ·  [⌘K][⚙] [win controls]`

Caveats: `data-tauri-drag-region` on the empty strip (does NOT inherit; mark interactive elements as non-draggable); bar height varies by OS (don't hardcode px — reserve via WCO env vars or let decorum manage it); conditional padding by platform (traffic lights on the left on mac; min/max/close on the right on win).

---

## 4. Sidebar — single tree (REST + SOAP)

Search at the top, then the tree, `Update Definition` in the footer per WSDL service.

- **REST request**: method badge in token color (`GET` green, `POST` amber…).
- **SOAP operation**: `⬢` badge in `--soap-op` (violet) — separates "this is SOAP" without making it a separate screen.
- Importing a WSDL creates a folder: `Service ▾ / Binding (SOAP 1.2) / ⬢ Operation…`.
- Active item: `--sidebar-accent` background, 2px `--primary` bar on the left.
- **REQUIREMENT (review fix)**: the active item must reflect the OPEN request. The Sidebar is a reusable component — "active" is state, not a hardcoded value. On the SOAP screen, highlight the shown operation, not a random REST item.

---

## 5. Request builder — SchemaForm (the central piece)

Tabs: **Body · Headers · Auth** (SOAP) / **Params · Body · Headers · Auth** (REST). Body active.
`Form ⇄ XML` toggle in the corner.

### `SchemaNode` → widget (the UI half of the domain-model §4 mapping)

| `SchemaNode` | Widget |
|---|---|
| `Leaf` String/Integer/Decimal | typed input (number for numerics) |
| `Leaf` Boolean | toggle |
| `Leaf` Date/DateTime/gYearMonth | date picker |
| `Leaf` with `enum_values` | **dropdown** (Select) |
| `Leaf` with `fixed` | read-only input |
| `occurs.optional()` (min=0) | dimmed + checkbox/"+" to include (color `--field-optional`) |
| required `occurs` (min≥1) | `*` marker in `--field-required`; blocks Send if empty |
| `occurs.repeatable()` | **repeatable group** with `＋/－`, instances numbered `[0][1]` |
| `Choice` | **branch selector** (ToggleGroup/segmented); only chosen branch renders |
| `nillable` | option to send nil |
| `Any` | raw XML editor (CodeMirror) for that subnode |

Nesting: collapsible complex types (Collapsible), hairline indentation guide to read the hierarchy (review fix: Employee inside GetBalance was hard to read).

`SOAPAction`/`Content-Type` shown as automatic line (derived from binding — user doesn't type them).

### Form ⇄ XML (ADR-013)
Toggle shows the generated envelope (CodeMirror + `lang-xml`, tags in `--soap-op`). MVP: form → XML preview; editing raw disables the form until reset (source of truth = form).

---

## 6. Response viewer

Header always visible: dot + `200 OK` (color by range: `--status-*`) · **time** · **size** (mono).
Tabs: **Body · Headers · Timing**.

### Tree (Body) + copy-leaf (differentiator #2)
- Each leaf value is its own element; hover → `⧉ copy value`; click selects **only the value**, never the tag.
- **REQUIREMENT (review fix)**: selection does NOT use `--soap-op` (violet already means SOAP). Add a neutral token `--selection` (subtle tint of `--muted` or `--primary` at low opacity). Do not reuse `--soap-op-surface` for selection.
- Namespace prefixes in `key` (e.g.: `ns2:MainValue`) rendered dimmed (`--muted-foreground`).
- **REQUIREMENT (review fix)**: body switches according to protocol — **JSON** tree for REST, **XML** for SOAP. The filter already switches (JSONPath/XPath); the tree must follow. Don't show `soap:Envelope` in a REST response.
- **SOAP Fault** (`ResponseBody::Soap{fault:Some}`) renders as a **structured error** (`--destructive`), never as a green 200 (product.md F3).
- Large trees: virtualized (`@tanstack/react-virtual`).

### Timing waterfall (differentiator #3)
- **REQUIREMENT (review fix — resolve duplication)**: the full waterfall (5 phases) lives in the **Timing tab**. In the response header, a **compact one-line summary** (total + thin bars) is always visible. Do not render the full waterfall below the body AND have the Timing tab — that was redundant.
- One color per phase (`--timing-dns/tcp/tls/ttfb/download`), with ms on the right.
- Missing phase (cached DNS, reused connection, HTTP without TLS) shows "—" — it's real information (domain-model §9).

---

## 7. Component structure (maps `architecture.md` §2)

```
components/titlebar/   sidebar/   request/   response/   ui/(shadcn)
features/
  schema-form/    -> recursive SchemaForm (SchemaNode -> widgets)
  response-tree/  -> recursive ResponseTree + copy-leaf
  timing/         -> Waterfall + compact summary
  wsdl-import/    -> modal (loading/resolution error)
```
`SchemaForm` and `ResponseTree` follow the same recursive pattern: render a node, map over children.

---

## 8. Principles (to avoid falling into a generic template)

- Identity comes from the protocol/network world: technical, data in mono and front and center, quiet chrome.
- Spend boldness on TWO moments, discipline the rest: the **form-from-WSDL** (schema becoming fillable UI) and the **timing waterfall**. The memorable micro-detail is the `⧉ copy leaf`.
- Copy voice: active and direct ("Send" → "Sent"). Empty state is an invitation ("Paste a WSDL URL or create a request"), not decoration.

---

## 9. Logo & app icon

**Hex sigil** — hexagon in linework `#FF8400` on near-black (`#111111`), with abstract ticks at the vertices; interlaced geometric center. Easter-egg option: tiny faceted gem in the center (Hextech reference, subtle, keeping the orange — not gold/blue).

Two versions: **full** (README, splash, empty state) and **simplified 16px** (favicon, dock/tray — just hexagonal frame + reduced center, to avoid noise).

Pipeline: clean SVG → 1024×1024 PNG → `pnpm tauri icon` generates `.icns`/`.ico`/tray PNGs.
Halloween suite coherence: themed geometric shape + ticks + own color on near-black (Pumpkin etc. follow the same recipe).
