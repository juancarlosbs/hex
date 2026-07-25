# Pencil — Request Panel Components

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar os componentes reutilizáveis no Pencil para o Request Panel, cobrindo todas as peças que aparecem nas telas `App — REST Request` e `App — SOAP Operation` mas ainda não existem como `reusable: true`.

**Architecture:** Cada componente é criado como frame com `reusable: true`, com todas as variantes de estado definidas inline como frames filhos ou anotadas com notes. Após cada componente, fazer screenshot e aguardar aprovação antes de prosseguir para o próximo.

**Tech Stack:** Pencil MCP (`batch_design`, `get_screenshot`), tokens de `styles/tokens.css`, ícones Lucide.

---

## Componentes a criar (em ordem de dependência)

| # | Componente | Depende de | Descrição |
|---|---|---|---|
| 1 | `MethodBadge` | — | Badge de método HTTP (GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS) e SOAP op (⬢) |
| 2 | `SendButton` | — | Botão primário de envio (idle + loading) |
| 3 | `UrlBar` | MethodBadge, SendButton | Barra de URL: método + input + Send (REST) / endpoint readonly + Send (SOAP) |
| 4 | `RequestTab` | — | Tab item único: active/inactive (usado em Request e Response) |
| 5 | `RequestTabStrip` | RequestTab | Faixa de tabs REST (Params · Body · Headers · Auth) e SOAP (Body · Headers · Auth) |
| 6 | `KeyValueRow` | — | Linha de chave/valor para Headers e Params: enabled + disabled |
| 7 | `AutoMetaBar` | — | Barra SOAP com SOAPAction e Content-Type derivados do binding (read-only) |
| 8 | `SchemaFormField` | — | Campo folha do SchemaForm: required, optional, enum dropdown, boolean toggle, read-only |

---

## Referência de tokens usados

```
Colors:
  --background   #111111    --foreground  #FFFFFF
  --card         #1A1A1A    --border      #2E2E2E
  --secondary    #2E2E2E    --muted-foreground #B8B9B6
  --primary      #FF8400    --primary-foreground #111111
  --destructive  #FF5C33
  --soap-op      #A371F7    --soap-op-surface #1C1530

Method colors:
  GET    #3FB950
  POST   #E3B341
  PUT    #FF8400
  DELETE #FF5C33
  PATCH  #58A6FF
  HEAD / OPTIONS  #B8B9B6 (muted)

Field:
  --field-required  #FF5C33
  --field-optional  #6E7681

Fonts:
  --font-primary   JetBrains Mono   (dados, URLs, valores)
  --font-secondary Geist            (chrome: labels, tabs, botões)

Radii:
  --radius-xs 4   --radius-s 6
```

---

### Task 1: MethodBadge

**Arquivo:** `index.pen` — novo componente reusável

Variantes a incluir como filhos do componente (um frame por variante):
- `GET` — pill verde `#3FB950`
- `POST` — âmbar `#E3B341`
- `PUT` — laranja `#FF8400`
- `DELETE` — vermelho `#FF5C33`
- `PATCH` — azul `#58A6FF`
- `HEAD` — muted `#B8B9B6`
- `OPTIONS` — muted `#B8B9B6`
- `SOAP ⬢` — violeta `#A371F7`, fundo `#1C1530`

Cada pill: `cornerRadius: 4`, `padding: [2, 6]`, texto `fontSize: 11`, `fontWeight: 700`, `fontFamily: Geist`.

- [ ] **Step 1: Criar o componente MethodBadge**

Usar `batch_design`:
```js
const pos = FindEmptySpace({ width: 600, height: 80, direction: "bottom", padding: 80 })
badge = Insert(document, {
  type: "frame", name: "MethodBadge", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "horizontal", gap: 8, alignItems: "center",
  padding: 8, fill: "$--card"
})

const methods = [
  { label: "GET",     color: "#3FB950", bg: "#0D2B12" },
  { label: "POST",    color: "#E3B341", bg: "#2B2208" },
  { label: "PUT",     color: "#FF8400", bg: "#2B1A00" },
  { label: "DELETE",  color: "#FF5C33", bg: "#2B1000" },
  { label: "PATCH",   color: "#58A6FF", bg: "#0A1F35" },
  { label: "HEAD",    color: "#B8B9B6", bg: "#2E2E2E" },
  { label: "OPTIONS", color: "#B8B9B6", bg: "#2E2E2E" },
]
for (const m of methods) {
  const pill = Insert(badge, {
    type: "frame", name: `badge-${m.label}`,
    layout: "horizontal", alignItems: "center", justifyContent: "center",
    cornerRadius: 4, fill: m.bg, padding: [2, 6]
  })
  Insert(pill, {
    type: "text", name: "label", content: m.label,
    fontFamily: "Geist", fontSize: 11, fontWeight: "700",
    fill: m.color
  })
}

const soapPill = Insert(badge, {
  type: "frame", name: "badge-SOAP",
  layout: "horizontal", alignItems: "center", justifyContent: "center",
  cornerRadius: 4, fill: "#1C1530", padding: [2, 6], gap: 4
})
Insert(soapPill, {
  type: "text", name: "hex", content: "⬢",
  fontFamily: "Geist", fontSize: 11, fill: "#A371F7"
})
Insert(soapPill, {
  type: "text", name: "label", content: "SOAP",
  fontFamily: "Geist", fontSize: 11, fontWeight: "700", fill: "#A371F7"
})

Update(badge, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- Todas as 8 variantes visíveis
- Cores corretas por método
- SOAP com ⬢ e fundo violeta escuro
- Texto legível e contrastante

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add MethodBadge reusable component"
```

---

### Task 2: SendButton

**Arquivo:** `index.pen` — novo componente reusável

Estados: `idle` (fundo `--primary`, texto `--primary-foreground`) e `loading` (spinner icon, fundo levemente opaco).

- [ ] **Step 1: Criar o componente SendButton**

```js
const pos = FindEmptySpace({ width: 260, height: 60, direction: "bottom", padding: 40, nodeId: badge })
sendBtn = Insert(document, {
  type: "frame", name: "SendButton", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "horizontal", gap: 12, alignItems: "center",
  fill: "$--card", padding: 8
})

const btnIdle = Insert(sendBtn, {
  type: "frame", name: "Send — Idle",
  layout: "horizontal", alignItems: "center", justifyContent: "center",
  cornerRadius: 6, fill: "$--primary", padding: [8, 16], gap: 8
})
Insert(btnIdle, {
  type: "icon", name: "icon", library: "lucide", icon: "send",
  width: 14, height: 14, fill: "#111111"
})
Insert(btnIdle, {
  type: "text", name: "label", content: "Send",
  fontFamily: "Geist", fontSize: 13, fontWeight: "600", fill: "#111111"
})

const btnLoading = Insert(sendBtn, {
  type: "frame", name: "Send — Loading",
  layout: "horizontal", alignItems: "center", justifyContent: "center",
  cornerRadius: 6, fill: "#CC6A00", padding: [8, 16], gap: 8, opacity: 0.8
})
Insert(btnLoading, {
  type: "icon", name: "icon", library: "lucide", icon: "loader-circle",
  width: 14, height: 14, fill: "#111111"
})
Insert(btnLoading, {
  type: "text", name: "label", content: "Sending…",
  fontFamily: "Geist", fontSize: 13, fontWeight: "600", fill: "#111111"
})

Update(sendBtn, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- Idle: laranja `#FF8400`, ícone send + "Send"
- Loading: levemente escurecido, ícone loader + "Sending…"
- Texto sempre `#111111` sobre laranja

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add SendButton reusable component"
```

---

### Task 3: UrlBar

**Arquivo:** `index.pen` — novo componente reusável

Duas variantes: REST (method badge dropdown + URL input + Send) e SOAP (endpoint label readonly + Send).

- [ ] **Step 1: Criar o componente UrlBar**

```js
const pos = FindEmptySpace({ width: 900, height: 120, direction: "bottom", padding: 40, nodeId: sendBtn })
urlBar = Insert(document, {
  type: "frame", name: "UrlBar", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "vertical", gap: 8, fill: "$--card", padding: 8
})

// — REST variant
const restBar = Insert(urlBar, {
  type: "frame", name: "UrlBar — REST",
  layout: "horizontal", alignItems: "center", gap: 8,
  fill: "$--background", cornerRadius: 6,
  stroke: "$--border", strokeWidth: 1, padding: [8, 12],
  width: 860
})
const methodBtn = Insert(restBar, {
  type: "frame", name: "Method Selector",
  layout: "horizontal", alignItems: "center", gap: 6,
  cornerRadius: 4, fill: "#0D2B12", padding: [4, 8]
})
Insert(methodBtn, {
  type: "text", name: "method", content: "GET",
  fontFamily: "Geist", fontSize: 12, fontWeight: "700", fill: "#3FB950"
})
Insert(methodBtn, {
  type: "icon", name: "chev", library: "lucide", icon: "chevron-down",
  width: 12, height: 12, fill: "#3FB950"
})
Insert(restBar, {
  type: "frame", name: "Divider",
  width: 1, height: 20, fill: "$--border"
})
Insert(restBar, {
  type: "text", name: "URL Input",
  content: "https://api.example.com/users",
  fontFamily: "JetBrains Mono", fontSize: 13,
  fill: "$--foreground", width: "fill_container",
  textGrowth: "fixed-width"
})
const sendRef = Insert(restBar, {
  type: "ref", ref: sendBtn, name: "Send"
})

// — SOAP variant
const soapBar = Insert(urlBar, {
  type: "frame", name: "UrlBar — SOAP",
  layout: "horizontal", alignItems: "center", gap: 8,
  fill: "$--background", cornerRadius: 6,
  stroke: "$--border", strokeWidth: 1, padding: [8, 12],
  width: 860
})
Insert(soapBar, {
  type: "text", name: "Endpoint",
  content: "https://ws.example.com/FGTSService",
  fontFamily: "JetBrains Mono", fontSize: 13,
  fill: "$--muted-foreground", width: "fill_container",
  textGrowth: "fixed-width"
})
Insert(soapBar, {
  type: "ref", ref: sendBtn, name: "Send"
})

Update(urlBar, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- REST: method badge verde + divider + URL mono + Send laranja
- SOAP: endpoint muted (readonly) + Send laranja
- Alinhamento vertical consistente entre as duas variantes

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add UrlBar reusable component"
```

---

### Task 4: RequestTab

**Arquivo:** `index.pen` — novo componente reusável

Tab item único. Estados: `active` (foreground bold + border-bottom primary) e `inactive` (muted, sem borda).

- [ ] **Step 1: Criar o componente RequestTab**

```js
const pos = FindEmptySpace({ width: 300, height: 60, direction: "bottom", padding: 40, nodeId: urlBar })
reqTab = Insert(document, {
  type: "frame", name: "RequestTab", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "horizontal", gap: 12, alignItems: "center",
  fill: "$--card", padding: 8
})

const tabActive = Insert(reqTab, {
  type: "frame", name: "Tab — Active",
  layout: "horizontal", alignItems: "center", justifyContent: "center",
  padding: [10, 12],
  stroke: "$--primary", strokeWidth: { bottom: 2 }
})
Insert(tabActive, {
  type: "text", name: "label", content: "Body",
  fontFamily: "Geist", fontSize: 13, fontWeight: "600",
  fill: "$--foreground"
})

const tabInactive = Insert(reqTab, {
  type: "frame", name: "Tab — Inactive",
  layout: "horizontal", alignItems: "center", justifyContent: "center",
  padding: [10, 12]
})
Insert(tabInactive, {
  type: "text", name: "label", content: "Headers",
  fontFamily: "Geist", fontSize: 13, fontWeight: "500",
  fill: "$--muted-foreground"
})

Update(reqTab, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- Active: texto branco bold, borda inferior `#FF8400`
- Inactive: texto muted, sem borda
- Padding consistente entre os dois

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add RequestTab reusable component"
```

---

### Task 5: RequestTabStrip

**Arquivo:** `index.pen` — novo componente reusável

Duas variantes: REST (`Params · Body · Headers · Auth`) e SOAP (`Body · Headers · Auth`).

- [ ] **Step 1: Criar o componente RequestTabStrip**

```js
const pos = FindEmptySpace({ width: 900, height: 120, direction: "bottom", padding: 40, nodeId: reqTab })
tabStrip = Insert(document, {
  type: "frame", name: "RequestTabStrip", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "vertical", gap: 8, fill: "$--card", padding: 8
})

// REST strip
const restStrip = Insert(tabStrip, {
  type: "frame", name: "TabStrip — REST",
  layout: "horizontal", alignItems: "center", gap: 4,
  padding: [0, 12], stroke: "$--border", strokeWidth: { bottom: 1 },
  width: 860
})
const restTabs = [
  { label: "Params", active: false },
  { label: "Body",   active: true },
  { label: "Headers",active: false },
  { label: "Auth",   active: false },
]
for (const t of restTabs) {
  Insert(restStrip, {
    type: "ref", ref: reqTab, name: `Tab ${t.label}`,
    descendants: {
      "Tab — Active":   { enabled: t.active },
      "Tab — Inactive": { enabled: !t.active },
    }
  })
}

// SOAP strip
const soapStrip = Insert(tabStrip, {
  type: "frame", name: "TabStrip — SOAP",
  layout: "horizontal", alignItems: "center", gap: 4,
  padding: [0, 12], stroke: "$--border", strokeWidth: { bottom: 1 },
  width: 860
})
const soapTabs = [
  { label: "Body",    active: true },
  { label: "Headers", active: false },
  { label: "Auth",    active: false },
]
for (const t of soapTabs) {
  Insert(soapStrip, {
    type: "ref", ref: reqTab, name: `Tab ${t.label}`,
    descendants: {
      "Tab — Active":   { enabled: t.active },
      "Tab — Inactive": { enabled: !t.active },
    }
  })
}

Update(tabStrip, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- REST: 4 tabs, "Body" ativo
- SOAP: 3 tabs, "Body" ativo
- Borda inferior `--border` ao longo de toda a largura

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add RequestTabStrip reusable component"
```

---

### Task 6: KeyValueRow

**Arquivo:** `index.pen` — novo componente reusável

Linha de chave/valor para Headers e Params. Estados: `enabled` e `disabled` (checkbox apagado, texto muted).

- [ ] **Step 1: Criar o componente KeyValueRow**

```js
const pos = FindEmptySpace({ width: 700, height: 100, direction: "bottom", padding: 40, nodeId: tabStrip })
kvRow = Insert(document, {
  type: "frame", name: "KeyValueRow", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "vertical", gap: 6, fill: "$--card", padding: 8
})

const makeRow = (name, enabled) => {
  const row = Insert(kvRow, {
    type: "frame", name,
    layout: "horizontal", alignItems: "center", gap: 8,
    padding: [4, 8], width: 660
  })
  // checkbox
  Insert(row, {
    type: "rectangle", name: "Checkbox",
    width: 14, height: 14, cornerRadius: 3,
    fill: enabled ? "$--primary" : "#00000000",
    stroke: enabled ? "$--primary" : "$--border",
    strokeWidth: 1
  })
  // key input
  Insert(row, {
    type: "frame", name: "Key",
    layout: "horizontal", alignItems: "center",
    cornerRadius: 4, fill: "$--background",
    stroke: "$--border", strokeWidth: 1,
    padding: [5, 8], width: 200
  })
  Insert(row.id ? row : row, {  // placeholder trick — use last Insert id via variable
    type: "text", name: "key-text", content: enabled ? "Content-Type" : "X-Custom-Header",
    fontFamily: "JetBrains Mono", fontSize: 12,
    fill: enabled ? "$--foreground" : "$--muted-foreground"
  })
  return row
}
```

> **Nota:** Como `batch_design` não persiste variáveis entre chamadas, criar os dois estados em uma única chamada, inserindo manualmente:

```js
const pos = FindEmptySpace({ width: 700, height: 140, direction: "bottom", padding: 40, nodeId: tabStrip })
kvRow = Insert(document, {
  type: "frame", name: "KeyValueRow", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "vertical", gap: 8, fill: "$--card", padding: 8
})

for (const [label, enabled] of [["Row — Enabled", true], ["Row — Disabled", false]]) {
  const row = Insert(kvRow, {
    type: "frame", name: label,
    layout: "horizontal", alignItems: "center", gap: 8,
    padding: [4, 8], width: 660
  })
  Insert(row, {
    type: "rectangle", name: "Checkbox",
    width: 14, height: 14, cornerRadius: 3,
    fill: enabled ? "$--primary" : "#00000000",
    stroke: enabled ? "$--primary" : "$--border", strokeWidth: 1
  })
  const keyCell = Insert(row, {
    type: "frame", name: "Key",
    layout: "horizontal", alignItems: "center",
    cornerRadius: 4, fill: "$--background",
    stroke: "$--border", strokeWidth: 1,
    padding: [5, 8], width: 200
  })
  Insert(keyCell, {
    type: "text", name: "key-text",
    content: enabled ? "Content-Type" : "X-Custom-Header",
    fontFamily: "JetBrains Mono", fontSize: 12,
    fill: enabled ? "$--foreground" : "$--muted-foreground"
  })
  const valCell = Insert(row, {
    type: "frame", name: "Value",
    layout: "horizontal", alignItems: "center",
    cornerRadius: 4, fill: "$--background",
    stroke: "$--border", strokeWidth: 1,
    padding: [5, 8], width: "fill_container"
  })
  Insert(valCell, {
    type: "text", name: "val-text",
    content: enabled ? "application/json" : "",
    fontFamily: "JetBrains Mono", fontSize: 12,
    fill: enabled ? "$--foreground" : "$--muted-foreground"
  })
  Insert(row, {
    type: "icon", name: "delete", library: "lucide", icon: "x",
    width: 14, height: 14,
    fill: enabled ? "$--muted-foreground" : "#2E2E2E"
  })
}

Update(kvRow, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- Enabled: checkbox laranja, textos brancos, ícone delete visível
- Disabled: checkbox borda, textos muted, ícone delete apagado
- Alinhamento horizontal preciso

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add KeyValueRow reusable component"
```

---

### Task 7: AutoMetaBar

**Arquivo:** `index.pen` — novo componente reusável

Barra SOAP-only com `SOAPAction` e `Content-Type` derivados automaticamente do binding. Read-only, fundo levemente diferenciado (`--card`), label muted + valor mono.

- [ ] **Step 1: Criar o componente AutoMetaBar**

```js
const pos = FindEmptySpace({ width: 860, height: 80, direction: "bottom", padding: 40, nodeId: kvRow })
autoMeta = Insert(document, {
  type: "frame", name: "AutoMetaBar", reusable: true, placeholder: true,
  x: pos.x, y: pos.y,
  layout: "horizontal", alignItems: "center", gap: 24,
  fill: "$--card", padding: [8, 12],
  stroke: "$--border", strokeWidth: { bottom: 1 },
  width: 860
})

const fields = [
  { label: "SOAPAction", value: "\"urn:ConsultarSaldo\"" },
  { label: "Content-Type", value: "text/xml; charset=utf-8" },
]
for (const f of fields) {
  const cell = Insert(autoMeta, {
    type: "frame", name: `meta-${f.label}`,
    layout: "horizontal", alignItems: "center", gap: 8
  })
  Insert(cell, {
    type: "text", name: "label", content: f.label,
    fontFamily: "Geist", fontSize: 11, fontWeight: "500",
    fill: "$--muted-foreground"
  })
  Insert(cell, {
    type: "text", name: "value", content: f.value,
    fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: "normal",
    fill: "$--foreground"
  })
}

Insert(autoMeta, {
  type: "frame", name: "Spacer",
  width: "fill_container", height: 1
})

Insert(autoMeta, {
  type: "text", name: "hint", content: "auto • from binding",
  fontFamily: "Geist", fontSize: 11, fill: "$--muted-foreground", opacity: 0.5
})

Update(autoMeta, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- Label muted (Geist sans), valor mono
- Hint "auto · from binding" à direita, bem discreto
- Fundo `--card` distinto do `--background` da área de form abaixo

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add AutoMetaBar reusable component"
```

---

### Task 8: SchemaFormField

**Arquivo:** `index.pen` — novo componente reusável

Campo folha do SchemaForm. Variantes:

- `required` — asterisco `*` vermelho (`--field-required`), input normal
- `optional` — checkbox/toggle para incluir, input dimmed enquanto não incluído
- `enum` — label + dropdown (Select)
- `boolean` — label + toggle pill
- `read-only` — label + input bloqueado (fixed value do schema)

- [ ] **Step 1: Criar o componente SchemaFormField**

```js
const pos = FindEmptySpace({ width: 500, height: 320, direction: "bottom", padding: 40, nodeId: autoMeta })
sff = Insert(document, {
  type: "frame", name: "SchemaFormField", reusable: true, placeholder: true,
  x: pos.x, y: pos.y, layout: "vertical", gap: 6, fill: "$--card", padding: 8
})

const variants = [
  { name: "Field — Required", labelColor: "$--foreground", marker: "*", markerColor: "$--field-required", inputFill: "$--background", inputText: "123.456.789-00", inputColor: "$--foreground", locked: false },
  { name: "Field — Optional (inactive)", labelColor: "$--muted-foreground", marker: null, inputFill: "#00000000", inputText: "", inputColor: "$--muted-foreground", locked: false, dimmed: true },
  { name: "Field — Optional (active)", labelColor: "$--foreground", marker: null, inputFill: "$--background", inputText: "optional value", inputColor: "$--foreground", locked: false },
  { name: "Field — Enum", labelColor: "$--foreground", marker: null, isEnum: true },
  { name: "Field — Boolean", labelColor: "$--foreground", marker: null, isBoolean: true },
  { name: "Field — Read-only", labelColor: "$--muted-foreground", marker: null, inputFill: "$--secondary", inputText: "document", inputColor: "$--muted-foreground", locked: true },
]

for (const v of variants) {
  const row = Insert(sff, {
    type: "frame", name: v.name,
    layout: "horizontal", alignItems: "center", gap: 8,
    padding: [4, 0], width: 480,
    opacity: v.dimmed ? 0.5 : 1
  })

  // label area
  const labelArea = Insert(row, {
    type: "frame", name: "Label Area",
    layout: "horizontal", alignItems: "center", gap: 3,
    width: 160
  })
  Insert(labelArea, {
    type: "text", name: "field-label",
    content: v.isBoolean ? "active" : v.isEnum ? "queryType" : "cpf",
    fontFamily: "Geist", fontSize: 12, fontWeight: "500",
    fill: v.labelColor
  })
  if (v.marker) {
    Insert(labelArea, {
      type: "text", name: "required-marker",
      content: v.marker,
      fontFamily: "Geist", fontSize: 12, fontWeight: "700",
      fill: v.markerColor
    })
  }

  if (v.isEnum) {
    const sel = Insert(row, {
      type: "frame", name: "Select",
      layout: "horizontal", alignItems: "center", justifyContent: "space_between",
      cornerRadius: 4, fill: "$--background",
      stroke: "$--border", strokeWidth: 1,
      padding: [5, 8], width: "fill_container"
    })
    Insert(sel, {
      type: "text", name: "val",
      content: "FULL",
      fontFamily: "JetBrains Mono", fontSize: 12,
      fill: "$--foreground"
    })
    Insert(sel, {
      type: "icon", name: "chev",
      library: "lucide", icon: "chevron-down",
      width: 12, height: 12, fill: "$--muted-foreground"
    })
  } else if (v.isBoolean) {
    // toggle pill
    const toggle = Insert(row, {
      type: "frame", name: "Toggle",
      layout: "horizontal", alignItems: "center",
      cornerRadius: 999, fill: "$--primary",
      padding: [2, 2], width: 36, height: 20
    })
    Insert(toggle, {
      type: "frame", name: "Spacer", width: "fill_container", height: 1
    })
    Insert(toggle, {
      type: "ellipse", name: "Knob",
      width: 16, height: 16, fill: "#111111"
    })
  } else {
    const input = Insert(row, {
      type: "frame", name: "Input",
      layout: "horizontal", alignItems: "center",
      cornerRadius: 4, fill: v.inputFill,
      stroke: v.locked ? "#00000000" : "$--border", strokeWidth: 1,
      padding: [5, 8], width: "fill_container"
    })
    Insert(input, {
      type: "text", name: "val",
      content: v.inputText || (v.dimmed ? "— not included" : ""),
      fontFamily: "JetBrains Mono", fontSize: 12,
      fill: v.inputColor
    })
    if (v.locked) {
      Insert(input, {
        type: "icon", name: "lock",
        library: "lucide", icon: "lock",
        width: 12, height: 12, fill: "$--muted-foreground"
      })
    }
  }
}

Update(sff, { placeholder: false })
```

- [ ] **Step 2: Screenshot e verificar**

Verificar:
- Required: asterisco vermelho visível
- Optional inactive: dimmed a 50%
- Enum: dropdown com chevron
- Boolean: toggle pill laranja com knob branco
- Read-only: input bloqueado com cadeado
- Todos os labels alinhados na mesma coluna (width 160)

- [ ] **Step 3: Commit**

```bash
git add index.pen
git commit -m "design(pencil): add SchemaFormField reusable component"
```

---

## Checklist final de revisão

Após criar todos os componentes:

- [ ] Todos os 8 componentes aparecem na lista de reusáveis do Pencil
- [ ] Nenhum componente usa hex hardcoded onde existe token equivalente
- [ ] Fontes: dados em `JetBrains Mono`, chrome em `Geist`
- [ ] Todas as variantes de estado estão representadas
- [ ] Screenshot geral do canvas para aprovação antes de usar nos app frames

---

## Próximos passos (pós-aprovação)

1. Atualizar os frames `App — REST Request` e `App — SOAP Operation` para usar as instâncias (`ref`) dos novos componentes
2. Só após aprovação visual → implementar em código
