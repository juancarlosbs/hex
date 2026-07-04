# Settings — Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a aba Environments no SettingsDialog com dois modos: lista full-width e detalhe com toggle Key/Value ↔ JSON, seguindo exatamente o design aprovado no Pencil (frames: "Settings — Environments (List)", "Settings — Environments (Detail)", "Settings — Environments (Detail / JSON)").

**Architecture:** Um único componente `EnvironmentsSection` dentro de `SettingsDialog.tsx` controla tudo via `selectedId: string | null` e `view: "table" | "json"`. Quando `selectedId === null` → modo lista. Quando selecionado → modo detalhe. Nenhum arquivo novo.

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind v4 + CVA, Lucide React, `cn()` de `src/lib/utils.ts`.

---

## File Map

| Arquivo | O que muda |
|---|---|
| `src/store/envStore.ts` | Adicionar `updateVariables` na interface `EnvState` e implementação |
| `src/components/SettingsDialog.tsx` | Adicionar import `useEnvStore`, componente `EnvironmentsSection`, conectar no render |

---

### Task 1: Store — adicionar `updateVariables`

**Files:**
- Modify: `src/store/envStore.ts`

- [ ] **Step 1: Adicionar ao interface `EnvState`**

Em `src/store/envStore.ts`, adicionar `updateVariables` logo após `removeEnv`:

```ts
interface EnvState {
  environments: Environment[];
  activeId: string | null;
  setActive: (id: string | null) => void;
  addEnv: (name: string) => void;
  removeEnv: (id: string) => void;
  updateVariables: (id: string, vars: Record<string, string>) => void;
}
```

- [ ] **Step 2: Implementar no store**

Dentro do `create<EnvState>(...)`, após o método `removeEnv`:

```ts
  updateVariables(id, vars) {
    const environments = get().environments.map((e) =>
      e.id === id ? { ...e, variables: vars } : e
    );
    set({ environments });
    persist(environments, get().activeId);
  },
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: nenhum erro.

- [ ] **Step 4: Commit**

```bash
git add src/store/envStore.ts
git commit -m "feat(env-store): add updateVariables method"
```

---

### Task 2: SettingsDialog — imports e constantes de cor

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

- [ ] **Step 1: Atualizar imports**

Substituir a linha de import de ícones e adicionar o import do store:

```tsx
import { useState } from "react";
import {
  X, Layers, Globe, Palette, Keyboard, Settings,
  Plus, Pencil, Trash2, Check, ChevronLeft,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useWorkspaceStore, type Workspace } from "../store/workspaceStore";
import { useEnvStore } from "../store/envStore";
```

- [ ] **Step 2: Adicionar mapa de cores de env**

Logo após os imports, antes da interface `Props`:

```ts
const ENV_DOT_COLORS: Record<string, string> = {
  Development: "#28C840",
  Staging:     "#FEBC2E",
  Production:  "#FF5F57",
};

function envDotColor(name: string): string {
  return ENV_DOT_COLORS[name] ?? "#B8B9B6";
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: nenhum erro.

---

### Task 3: EnvironmentsSection — modo lista

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

Adicionar o componente `EnvironmentsSection` antes da função `SettingsDialog`. Começar com o modo lista; o modo detalhe vem na próxima task.

- [ ] **Step 1: Esqueleto do componente com modo lista**

```tsx
function EnvironmentsSection() {
  const { environments, addEnv, removeEnv, updateVariables } = useEnvStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "json">("table");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState(false);

  const selected = environments.find((e) => e.id === selectedId) ?? null;

  function openEnv(id: string) {
    const env = environments.find((e) => e.id === id)!;
    setSelectedId(id);
    setJsonText(JSON.stringify(env.variables, null, 2));
    setJsonError(false);
    setView("table");
  }

  function backToList() {
    setSelectedId(null);
    setAddOpen(false);
  }

  function handleAdd() {
    if (!newName.trim()) return;
    addEnv(newName.trim());
    setNewName("");
    setAddOpen(false);
  }

  // placeholder: modo detalhe adicionado na Task 4
  if (selected) {
    return <div className="p-5 text-muted text-[13px]">detail — coming in Task 4</div>;
  }

  // ── Modo lista ──
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-foreground">Environments</span>
        <button
          className="flex items-center gap-[6px] px-3 py-[6px] rounded-[4px] border border-border text-[12px] text-muted hover:text-foreground cursor-pointer"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={13} />
          New
        </button>
      </div>

      {addOpen && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className="flex-1 rounded-[4px] bg-background border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring"
            placeholder="Environment name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setAddOpen(false); setNewName(""); }
            }}
          />
          <button
            className="px-3 py-[6px] text-[12px] font-medium rounded-[4px] border border-border text-foreground cursor-pointer disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim()}
          >
            Create
          </button>
          <button
            className="text-[12px] text-muted cursor-pointer hover:text-foreground"
            onClick={() => { setAddOpen(false); setNewName(""); }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex flex-col gap-[2px]">
        {environments.map((env) => {
          const varCount = Object.keys(env.variables).length;
          return (
            <div
              key={env.id}
              className="flex items-center gap-3 px-3 py-[10px] rounded-[6px] hover:bg-secondary cursor-pointer group"
              onClick={() => openEnv(env.id)}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: envDotColor(env.name) }}
              />
              <span className="flex-1 text-[13px] font-medium text-foreground">{env.name}</span>
              <span className="text-[11px] text-muted">
                {varCount} var{varCount !== 1 ? "s" : ""}
              </span>
              <div
                className="flex items-center gap-1 opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <Trash2
                  size={13}
                  className={cn(
                    "cursor-pointer",
                    environments.length === 1
                      ? "text-muted/30 cursor-not-allowed"
                      : "text-muted hover:text-red-400"
                  )}
                  onClick={() => environments.length > 1 && removeEnv(env.id)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Conectar no render do SettingsDialog**

Localizar o bloco de render do content (onde está "coming soon") e substituir:

```tsx
{section === "workspaces" ? (
  <WorkspacesSection />
) : section === "environments" ? (
  <EnvironmentsSection />
) : (
  <div className="flex items-center justify-center h-full text-muted text-[13px]">
    {NAV.find((n) => n.id === section)?.label} — coming soon
  </div>
)}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: nenhum erro.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsDialog.tsx
git commit -m "feat(settings): environments list mode"
```

---

### Task 4: EnvironmentsSection — modo detalhe (Key/Value)

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

Substituir o placeholder `if (selected)` pelo modo detalhe completo.

- [ ] **Step 1: Adicionar helpers de variáveis**

Logo antes do `if (selected)` (ainda dentro de `EnvironmentsSection`), adicionar as funções de mutação:

```tsx
  function handleVarValueChange(key: string, value: string) {
    if (!selected) return;
    const vars = { ...selected.variables, [key]: value };
    updateVariables(selected.id, vars);
    setJsonText(JSON.stringify(vars, null, 2));
  }

  function handleVarKeyRename(oldKey: string, newKey: string) {
    if (!selected || !newKey.trim() || newKey === oldKey) return;
    const entries = Object.entries(selected.variables).map(([k, v]) =>
      k === oldKey ? [newKey.trim(), v] : [k, v]
    );
    const vars = Object.fromEntries(entries);
    updateVariables(selected.id, vars);
    setJsonText(JSON.stringify(vars, null, 2));
  }

  function handleVarDelete(key: string) {
    if (!selected) return;
    const vars = Object.fromEntries(
      Object.entries(selected.variables).filter(([k]) => k !== key)
    );
    updateVariables(selected.id, vars);
    setJsonText(JSON.stringify(vars, null, 2));
  }

  function handleAddVar() {
    if (!selected) return;
    let key = "NEW_VAR";
    let i = 1;
    while (key in selected.variables) key = `NEW_VAR_${i++}`;
    handleVarValueChange(key, "");
  }

  function handleJsonBlur() {
    if (!selected) return;
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      const vars = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, String(v)])
      );
      updateVariables(selected.id, vars);
      setJsonError(false);
    } catch {
      setJsonError(true);
    }
  }

  function switchToJson() {
    if (selected) setJsonText(JSON.stringify(selected.variables, null, 2));
    setView("json");
    setJsonError(false);
  }
```

- [ ] **Step 2: Substituir o placeholder pelo modo detalhe**

Substituir o bloco `if (selected) { return <div>…</div>; }` por:

```tsx
  if (selected) {
    const entries = Object.entries(selected.variables);
    return (
      <div className="flex flex-col h-full">
        {/* Header colapsado */}
        <div className="flex items-center gap-2 px-5 py-[14px] border-b border-border">
          <button
            className="flex items-center gap-1 px-[6px] py-1 rounded-[4px] bg-secondary text-muted hover:text-foreground cursor-pointer"
            onClick={backToList}
          >
            <ChevronLeft size={13} />
            <span className="text-[11px]">Back</span>
          </button>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: envDotColor(selected.name) }}
          />
          <span className="text-[13px] font-semibold text-foreground">{selected.name}</span>
          <span className="text-[11px] text-muted">
            {entries.length} variable{entries.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Toggle Key/Value | JSON */}
        <div className="flex items-center px-5 py-[10px] border-b border-border">
          <div className="flex rounded-[4px] border border-border overflow-hidden">
            {(["table", "json"] as const).map((v) => (
              <button
                key={v}
                className={cn(
                  "px-3 py-[5px] text-[12px] cursor-pointer",
                  view === v
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted hover:text-foreground"
                )}
                onClick={() => v === "json" ? switchToJson() : setView("table")}
              >
                {v === "table" ? "Key / Value" : "JSON"}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex flex-col flex-1 overflow-y-auto">
          {view === "table" ? (
            <div className="flex flex-col p-5 gap-[6px]">
              {/* Cabeçalho de colunas */}
              <div className="flex gap-2 px-0 pb-1">
                <span className="flex-1 text-[10px] font-semibold text-muted uppercase tracking-[0.5px]">Key</span>
                <span className="flex-1 text-[10px] font-semibold text-muted uppercase tracking-[0.5px]">Value</span>
                <span className="w-[13px]" />
              </div>

              {entries.length === 0 && (
                <span className="text-[12px] text-muted py-2">No variables yet.</span>
              )}

              {entries.map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-[4px] bg-secondary border border-border px-2 py-[6px] text-[12px] font-mono text-foreground outline-none focus:border-ring"
                    defaultValue={key}
                    onBlur={(e) => handleVarKeyRename(key, e.target.value)}
                  />
                  <input
                    className="flex-1 rounded-[4px] bg-secondary border border-border px-2 py-[6px] text-[12px] font-mono text-foreground outline-none focus:border-ring"
                    value={value}
                    onChange={(e) => handleVarValueChange(key, e.target.value)}
                  />
                  <button
                    className="text-muted hover:text-red-400 cursor-pointer shrink-0"
                    onClick={() => handleVarDelete(key)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}

              <button
                className="flex items-center gap-[6px] text-[12px] text-muted hover:text-foreground cursor-pointer mt-1 self-start"
                onClick={handleAddVar}
              >
                <Plus size={13} />
                Add Variable
              </button>
            </div>
          ) : (
            <div className="flex flex-col flex-1 p-5">
              <textarea
                className={cn(
                  "flex-1 w-full rounded-[4px] bg-secondary border px-3 py-2 text-[12px] font-mono text-foreground outline-none resize-none focus:border-ring",
                  jsonError ? "border-red-500" : "border-border"
                )}
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setJsonError(false); }}
                onBlur={handleJsonBlur}
                spellCheck={false}
              />
              {jsonError && (
                <span className="text-[11px] text-red-400 mt-1">Invalid JSON — changes not saved.</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Expected: nenhum erro.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsDialog.tsx
git commit -m "feat(settings): environments detail mode with key-value and json views"
```

---

### Task 5: Verificação visual e commit final

**Files:** nenhum arquivo novo.

- [ ] **Step 1: Iniciar o app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Checklist de verificação visual**

Abrir Settings → Environments e confirmar cada item:

- [ ] Lista ocupa a largura total sem coluna lateral
- [ ] Dots coloridos: Development verde, Staging amarelo, Production vermelho
- [ ] Botão `+ New` visível no modo lista; criar um env funciona
- [ ] Ícone de trash aparece no hover da linha; delete funciona (não permite deletar o último)
- [ ] Clicar num env → modo detalhe: header com `← Back` + dot + nome, **sem** botão `+ New`
- [ ] Toggle `Key / Value` ativo por padrão
- [ ] Editar valor de variável → persiste ao fechar e reabrir Settings
- [ ] Renomear chave (blur no input de key) → persiste
- [ ] `+ Add Variable` cria linha nova com chave `NEW_VAR`
- [ ] Trocar para tab `JSON` → mostra JSON com indentação
- [ ] Editar JSON válido → blur → trocar para Key/Value → rows refletem mudança
- [ ] Editar JSON inválido → blur → borda vermelha + mensagem, sem salvar
- [ ] `← Back` volta para lista; contagem de vars na linha atualizada
- [ ] Fechar e reabrir app → variáveis persistidas via tauri-plugin-store

- [ ] **Step 3: Commit final**

```bash
git add -p
git commit -m "feat(settings): environments section complete"
```
