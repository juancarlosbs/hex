# Environment Variables — Design Spec

Date: 2026-07-25
Status: approved design, pre-implementation
Scope: the 🟢⭐ MVP items "Environment variables `{{var}}` interpolated" and "Environment manager (dev/staging/prod)" plus flow F4 (docs/product.md).

## Decisions (agreed in brainstorm)

1. **Full flow in one feature**: Rust-side authoritative interpolation + environment manager CRUD + working titlebar `EnvSelector` (F4).
2. **Storage**: one TOML file per environment at `workspaces/<ws>/environments/<id>.toml` — git-friendly, consistent with ADR-011 and differentiator #4.
3. **Interpolation coverage**: everything that leaves in the request — URL, query params, headers, REST body, auth fields, SOAP form leaves, SOAPAction, raw-edited envelope. Rule: "if it goes on the wire, `{{var}}` works".
4. **Active environment is per workspace**, with an explicit "No environment" state. A send containing `{{var}}` with no active environment fails; nothing ever passes through as a literal.
5. **Send contract (approach B)**: `send_*` commands receive `environment_id: Option<String>` and Rust loads the environment from disk on every send — disk is the source of truth even if the frontend is stale.

## Architecture

### Rust

- `domain/env.rs` (pure, per docs/domain-model.md §6):
  `Environment { id, name, vars: BTreeMap<String, String> }` and
  `interpolate(template: &str, env: &Environment) -> Result<String, DomainError>`.
  No I/O. `DomainError::UnknownVar` already exists in the domain error enum.
- `persistence/environment.rs`: `list / save / delete` of per-environment TOML files, reusing the existing id validation (path traversal guard). The active environment id is per-workspace UI state kept in the frontend plugin-store (`activeEnv:<workspaceId>` in `hex.json`) — workspace metadata itself lives there today, not in Rust; the authoritative environment *content* always comes from disk at send time.
- `commands/`: thin `list_environments`, `save_environment`, `delete_environment`. Existing `send_*` commands gain `environment_id: Option<String>`; with an id, the command loads the TOML and interpolates all outgoing fields before building `PreparedRequest`. Unknown id → send error, no network call.
- `src/bindings.ts` regenerated with tauri-specta (`cargo test export_bindings`); never hand-edited.

### Frontend

- `envStore` rewritten over the new commands through `lib/api.ts` wrappers (drops tauri-plugin-store; its init was never called). Loads per workspace; reloads on workspace switch.
- `EnvSelector` (titlebar): lists environments + "No environment"; switching updates the per-workspace active id in the plugin-store and re-interpolates the preview of the visible request (F4). Preview is UX only — Rust re-resolves at send.
- "Environment manager" modal (per the product.md modals table): CRUD of environments and name/value variables. No secret masking (v2).

### Send data flow

```
frontend → send_*(request, environment_id?)
         → Rust loads env from disk
         → interpolate (pure domain)
         → validate → PreparedRequest → engine
```

## Interpolation semantics

- `{{name}}` resolves from the active environment's `vars`; whitespace inside braces is trimmed (`{{ host }}` ≡ `{{host}}`).
- Unknown variable → `DomainError::UnknownVar(name)`; the send fails before any network activity.
- `{{var}}` present but no active environment → same `UnknownVar` failure; the UI message suggests selecting an environment.
- Unclosed `{{` and empty `{{}}` are not valid references and pass through as literals.

## Error handling

All failures stop the send before the network, with a message pointing at the problem:

| Case | Behavior |
|---|---|
| Unknown `{{var}}` | `UnknownVar` error naming the variable and the field it appeared in |
| `{{var}}` with no active env | Same error; message suggests selecting an environment |
| `environment_id` missing on disk | "environment not found" send error; frontend reloads the env list |
| Corrupt TOML in `environments/` | `list_environments` reports the offending file and loads the rest — never silent, never partial without saying so (F2 spirit) |

## Testing

- **Rust (bulk of coverage)**: unit tests for pure `interpolate` (mid-string, multiple vars, unknown var, empty/unclosed braces, trimmed spaces); tempdir tests for persistence (save/list/delete, invalid id, corrupt TOML); send-path tests covering interpolation of URL, query, headers, REST body, auth, SOAP leaves, SOAPAction, raw envelope, and the unknown-id case.
- **Frontend (Vitest)**: envStore over mocked wrappers (CRUD, workspace switch), EnvSelector ("No environment" option, switch persists the per-workspace active id), F4 preview re-interpolation.
- `cargo fmt`, `cargo clippy`, `tsc --noEmit` clean.

## Out of scope (v2, per docs/product.md)

- Scoped variables (global/env/collection).
- Secret masking in the manager.
- OAuth2 and anything auth-flow related beyond interpolating the existing auth fields.
