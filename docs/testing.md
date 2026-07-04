# Testing — Hex

> Testing strategy and where each thing is verified. Rule for the agent: push tests to
> the lowest layer possible. Business logic is NOT tested via E2E (slow and brittle) — it goes
> in `cargo test`. E2E covers only the hero flow. See ADR-015 for the rationale behind the pyramid.

Development is on macOS (WebDriver for WKWebView is painful there); the logic lives in the pure domain.
That's why the pyramid is strongly weighted toward the bottom.

```
      /\        E2E — 1 happy-path (hero flow), on CI Linux
     /  \
    /----\      Frontend — Vitest + mockIPC: UI wiring
   /------\
  /--------\    Rust — cargo test: domain + WSDL pipeline + serializer (the majority)
```

---

## 1. Level 1 — Rust (`cargo test`) · where ~80% of tests live

The domain is pure (domain-model.md), so tests are direct, fast, and deterministic. Prioritize:

- **`wsdl::xsd`** — XSD → `SchemaNode`: occurs, choice, enum, nillable, recursion (depth cap).
- **`wsdl::resolve`** — import/include resolution + the FAILURE paths (404, cycle, missing schemaLocation).
- **`engine::serialize`** — pair (SchemaNode, FormValue) → envelope: omitted optional, array, choice, nil, namespaces.
- **`domain::validate`** — required fields, EmptyChoice, correct path on issues.
- **`domain::interpolate`** — `{{var}}`, missing variable.
- **`persistence`** — round-trip of SavedRequest (serde) with tempdir.

### Examples

Serializer (the schema × value pair — the heart):
```rust
#[test]
fn serializes_omitted_optional_and_array() {
    let schema = seq("GetBalance", vec![
        leaf("cpf", XsdType::String, occ(1,1)),
        leaf("note", XsdType::String, occ(0,1)),               // optional
        leaf("period", XsdType::GYearMonth, occ(1, Unbounded)), // array
    ]);
    let values = FormValue::Sequence(vec![
        FormValue::Leaf(Some("123".into())),
        FormValue::Omitted,                                     // should not emit <note>
        FormValue::Repeated(vec![leafv("2026-05"), leafv("2026-06")]),
    ]);
    let xml = serialize(&schema, &values, &mut ns()).unwrap();
    assert!(xml.contains("<ns0:cpf>123</ns0:cpf>"));
    assert!(!xml.contains("note"));                             // omitted
    assert_eq!(xml.matches("<ns0:period>").count(), 2);        // 2 instances
}

#[test]
fn choice_serializes_only_chosen_branch() {
    let schema = choice("Account", vec![ leaf("byNumber", ..), leaf("byHolder", ..) ]);
    let values = FormValue::Choice { branch: 0, value: box_leaf("0001") };
    let xml = serialize(&schema, &values, &mut ns()).unwrap();
    assert!(xml.contains("byNumber"));
    assert!(!xml.contains("byHolder"));
}
```

Import resolution with failure (critical path of F2):
```rust
#[tokio::test]
async fn import_with_missing_external_schema_fails_clearly() {
    let wsdl = wsdl_importing("https://example.test/missing.xsd");
    let err = resolve(wsdl, &fake_fetch_404()).await.unwrap_err();
    assert!(matches!(err, WsdlError::Fetch { url, .. } if url.contains("missing.xsd")));
}
```
> `resolve` receives the fetcher as a parameter (injection) so the test doesn't hit the network —
> keeps parsing testable and isolates I/O (ADR-003 boundary).

Validation:
```rust
#[test]
fn required_empty_generates_issue_with_path() {
    let issues = validate(&schema_get_balance(), &values_without_cpf()).unwrap_err();
    assert!(issues.iter().any(|i|
        i.kind == IssueKind::MissingRequired && i.path == ["GetBalance","cpf"]));
}
```

### Testing the command through the IPC boundary (optional)
To verify payload/state serialization, not the logic (already covered above):
```rust
// Cargo.toml: [dev-dependencies] tauri = { version = "2", features = ["test"] }
#[test]
fn command_create_workspace_via_mock() {
    let app = tauri::test::mock_builder().build(tauri::generate_context!()).unwrap();
    // invoke create_workspace with MockRuntime and check the return/state
}
```
Rule: the bulk of workspace/request logic goes in the pure function; the mock IPC is just for wiring.

---

## 2. Level 2 — Frontend (Vitest + `mockIPC`) · UI wiring

Renders the component, simulates interaction, verifies that the right `invoke` was called and the store
updated. Rust **mocked** → runs on Mac without building. Good for: SchemaForm (rendering a
`SchemaNode` → correct widgets), modals, tree selection, copy-leaf.

```ts
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
afterEach(clearMocks);

it("SchemaForm renders enum as dropdown and required field with marker", () => {
  render(<SchemaForm node={leafEnum("queryType", ["FULL","SUMMARY"])} />);
  expect(screen.getByRole("combobox")).toBeInTheDocument();
});

it("blocks Send with empty required field", async () => {
  const calls: any[] = [];
  mockIPC((cmd, args) => { calls.push({ cmd, args });
    if (cmd === "send_request") throw { Validation: [{ path:["GetBalance","cpf"], kind:"MissingRequired" }] };
  });
  render(<RequestPanel operation={getBalance} />);
  await userEvent.click(screen.getByText("Send"));
  expect(screen.getByText(/cpf/i)).toHaveClass(/field-required/);  // field highlighted
});

it("copy-leaf copies only the value, without the tag", async () => {
  const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<ResponseTree node={leaf("ns2:MainValue","1234.50")} />);
  await userEvent.click(screen.getByLabelText("copy value"));
  expect(spy).toHaveBeenCalledWith("1234.50");                     // not "ns2:MainValue: 1234.50"
});
```
Since `invoke` args come from generated bindings (tauri-specta), the test already catches type mismatches.

---

## 3. Level 3 — E2E · hero flow end to end

Real built app: Rust creates/sends for real, UI is clicked through. **Happy-path only** (F1 from
product.md): import WSDL → operation → form → Send → response + waterfall.

macOS: the official `tauri-driver` only covers Windows/Linux (Apple doesn't provide WebDriver for WKWebView).
Solution: `tauri-plugin-webdriver` (open-source, cross-platform, embeds W3C server in the app) as a
**debug-only** dep; or run E2E only on **CI Linux** (recommended — develop on Mac, e2e in CI).

```ts
// wdio: hero flow
it("imports WSDL, sends operation and shows response", async () => {
  await $("button=Import WSDL").click();
  await $('input[name="wsdl-url"]').setValue(TEST_WSDL);      // public SOAP test service
  await $("button=Import").click();
  await $("aside").$("=GetBalance").click();                   // operation in sidebar
  await $('input[name="cpf"]').setValue("12345678900");
  await $("button=Send").click();
  await expect($('[data-testid="response-status"]')).toHaveText(/200/);
  await expect($('[data-testid="timing-waterfall"]')).toBeDisplayed();
});
```

---

## 4. CI (GitHub Actions)

Two jobs: fast (runs on everything) and E2E (Linux only).

```yaml
name: ci
on: [push, pull_request]
jobs:
  rust-and-front:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: cargo fmt --check && cargo clippy -- -D warnings
        working-directory: src-tauri
      - run: cargo test
        working-directory: src-tauri
      - run: pnpm test            # Vitest

  e2e-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v4
      # Tauri system deps + webkit driver for E2E
      - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev webkit2gtk-driver xvfb
      - run: pnpm install
      - run: pnpm tauri build --debug
      - run: xvfb-run pnpm test:e2e
```

---

## 5. Conventions

- Test name describes behavior, not the function (`required_empty_generates_issue`, not `test_validate`).
- Real, small WSDL/XSD fixtures in `src-tauri/tests/fixtures/` (incl. one with external import and one with recursion).
- `resolve`/network always with injected fetcher in tests — never hit a real host in `cargo test`.
- `data-testid` on anchor elements of the hero flow (status, waterfall, operation) so E2E doesn't depend on text.
- CI green = `fmt` + `clippy -D warnings` + `cargo test` + `pnpm test`; E2E can be required only on merge to main.

---

## 6. Definition of "covered" (linked to product.md §7)

- Serializer: optional/array/choice/nil/namespace each with a test.
- `resolve`: success + the 3 failure paths (404, cycle, missing location).
- Fault: response with `soap:Fault` becomes an error (never a green 200) — parse test.
- Hero flow: 1 green E2E on CI Linux.
- Validation: required/choice with correct `path`.
