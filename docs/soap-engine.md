# SOAP Engine & HTTP Engine — Hex

> The I/O adapters at the product's heart: `wsdl/` (WSDL/XSD -> SchemaNode) and `engine/`
> (serialize envelope + instrumented HTTP engine + parse response). Rule for the agent:
> TYPES come from `docs/domain-model.md` (don't redefine them here); this page is the ALGORITHM.
> Subset scope: `docs/product.md` section 6 + ADR-010. No UI logic here.

Modules: `wsdl::{parse, resolve, xsd}` (build `SchemaNode`) · `engine::{serialize, connector, client}` (send and read).

---

## 1. What we read from a WSDL (primer)

WSDL 1.1 is a complete contract. We need 5 sections:

```
<definitions targetNamespace=...>
  <types>      -> one or more <xsd:schema>: the types (XSD lives here)
  <message>    -> named; <part> points to an element/type from the XSD
  <portType>   -> <operation> with <input>/<output>/<fault> -> messages
  <binding>    -> links portType to SOAP: version, style, soapAction per operation
  <service>    -> <port> with <soap:address location=...> = the ENDPOINT
```

Version/style detection (in `<binding>`):
- soap prefix `http://schemas.xmlsoap.org/wsdl/soap/` => **SOAP 1.1**; `.../soap12/` => **SOAP 1.2**.
- `<soap:binding style="document">` + `<soap:body use="literal">` => **doc/literal** (supported).
- `style="rpc"` or `use="encoded"` => **rpc/encoded**: REJECT with a clear error (ADR-010).

---

## 2. Pipeline WSDL -> SchemaNode

### 2.1 Enumerate operations (`wsdl::parse`)

```
1. roxmltree parses the WSDL.
2. <service>/<port>  -> endpoint URL + <binding> name.
3. <binding>         -> soap_version, validate style/use (reject rpc/encoded),
                        and soapAction per operation (<soap:operation soapAction=...>).
4. resolve the portType from the binding. For each <operation>:
     - <input> -> <message> -> <part> -> QName of the wrapper element in XSD.
5. returns Vec<OperationRef{ name, endpoint, soap_action, soap_version, input_element: QName }>.
```

Each `input_element` is the entry point for the XSD traversal (step 2.3).

### 2.2 Resolve schemas (`wsdl::resolve`) — the #1 pain in the real world

The `<types>` section is almost never self-contained; it `import`s/`include`s external schemas.

```
SchemaSet = map (targetNamespace -> Schema) + set of already-fetched URLs (dedup).

resolve(initial_schema):
  queue = [inline schemas from <types>]
  while queue not empty:
    s = queue.pop()
    register s.targetNamespace -> s in SchemaSet
    for each <xsd:import namespace=NS schemaLocation=LOC> and <xsd:include schemaLocation=LOC>:
      url = resolve_relative(current_document_base, LOC)   // relative OR absolute
      if url already fetched: continue                     // cuts cycle
      bytes = FETCH(url)     // <-- I/O; this is what can FAIL
      new = roxmltree.parse(bytes)
      mark url as fetched; push new onto queue
```

- **`import`** = different namespace; **`include`** = same namespace (merge).
- `schemaLocation` can be relative (resolve against current document URL) or absolute.
- **Failure paths (product.md F2)**: 404/timeout on FETCH, invalid XML, missing `schemaLocation`. Each becomes a typed `WsdlError` with WHICH url/schema failed. Never silently import partial results.
- URL dedup prevents mutual include loops.

### 2.3 XSD -> SchemaNode (`wsdl::xsd`)

Recursive traversal starting from `input_element`. Element/type lookup by **QName** in the `SchemaSet`.

```
walk_element(el, path_types) -> SchemaNode:
  occurs   = (el.minOccurs default 1, el.maxOccurs default 1; "unbounded" -> Unbounded)
  nillable = el.nillable == "true"
  doc      = el/xs:annotation/xs:documentation
  type     = inline type (<xs:complexType>/<xs:simpleType>) OR resolve QName from el.type

  match type:
    simpleType/built-in:
      enum_values = xs:enumeration facets (if any)
      kind = Leaf{ xsd_type: map_xsd_type(type), enum_values, default: el.default, fixed: el.fixed }
    complexType with xs:sequence:
      kind = Sequence( children = seq.map(walk_element_with_guard) )
    complexType with xs:choice:
      kind = Choice( branches = choice.map(walk_element_with_guard) )
    xs:any / anyType:
      kind = Any
  attributes = type.xs:attribute.map(-> Attribute)
  return SchemaNode{ name: el.name, namespace: type.targetNamespace, occurs, nillable, doc, attributes, kind }
```

**Recursion guard** (`walk_element_with_guard`): maintains `path_types` = stack of type QNames on the current path. If the child's type is already in `path_types` (direct/transitive cycle), **don't expand**: emit a placeholder node and stop. In MVP:
- depth cap `D` (e.g.: 12); when reached, truncate;
- the placeholder node is marked (via `doc = "recursive: expand on demand"`);
- the UI expands lazily by calling a command `expand_schema_node(type_ref, depth)` that runs one more level. (A dedicated `NodeKind::LazyRef` can be added later; in MVP the `doc` marker is enough.)

`map_xsd_type` covers the subset (string/boolean/integer/decimal/double/date/dateTime/time/gYearMonth/base64Binary); xs: QName outside the list -> `XsdType::Other(name)` (UI treats as String with warning).

---

## 3. Namespaces (to serialize correctly)

When building `SchemaNode`s, collect the distinct `namespace`s from the subtree and assign **deterministic** prefixes (`ns0`, `ns1`, ...). The envelope declares all of them at the root; each element is emitted with its prefix. This is what makes the server accept the envelope — wrong namespace is the #1 cause of SOAP rejections.

```
NsRegistry: uri -> prefix (stable discovery order)
```

---

## 4. Serialize the envelope (`engine::serialize`) — the "inverse"

Walks the **pair (SchemaNode, FormValue)** following the pairing contract from `domain-model.md` §3.
Writes with `quick-xml::Writer`.

```
serialize(op, schema, values, ns) -> Envelope:
  body = write_node(schema, values, ns)     // recursive, see below
  header = header_ws_security(...)           // Option; UI exists, engine is v2
  Envelope{ version, namespaces: ns.all(), header, body }

write_node(node, value, ns, out):
  // cardinality first
  if node.occurs.repeatable():
     expect value == Repeated(items); for item in items: write_one(node, item, ns, out)
  else if node.occurs.optional() and value == Omitted:
     return                                  // don't emit the element
  else:
     write_one(node, value, ns, out)

write_one(node, value, ns, out):
  prefix = ns.prefix_for(node.namespace)
  match (node.kind, value):
    (_, Nil)                         -> <prefix:name xsi:nil="true"/>
    (Leaf, Leaf(Some(s)))            -> <prefix:name attrs>{escape(s)}</prefix:name>
    (Sequence(children), Sequence(vals)) ->
        <prefix:name attrs>
          for (child, v) in zip(children, vals): write_node(child, v, ns, out)
        </prefix:name>
    (Choice(branches), Choice{branch, value}) ->
        write_node(branches[branch], value, ns, out)
    (Any, Raw(xml))                  -> inserts xml verbatim
    _ -> DomainError::ValueMismatch{ path }
```

`attrs` = filled attributes from `node.attributes`. XML escaping always (quick-xml writer handles it). Source of truth = form (raw disables form until reset; ADR-013).

### SOAP 1.1 vs 1.2 (what changes on the wire)

| | SOAP 1.1 | SOAP 1.2 |
|---|---|---|
| envelope ns | `http://schemas.xmlsoap.org/soap/envelope/` | `http://www.w3.org/2003/05/soap-envelope` |
| Content-Type | `text/xml; charset=utf-8` | `application/soap+xml; charset=utf-8` |
| Action | `SOAPAction: "<action>"` header | parameter in Content-Type: `;action="<action>"` |
| Fault | `<faultcode>/<faultstring>` | `<Code>/<Reason>` |

`engine::serialize` produces the correct header/Content-Type from `soap_version` (the user never types this).

---

## 5. Instrumented HTTP engine (`engine::connector` + `engine::client`) — showcase

The waterfall (differentiator #3) requires measuring each phase. reqwest doesn't allow it (ADR-005), so
we drive the connection manually with `hyper::client::conn`, which gives clean phase boundaries.

**MVP: one new connection per request** => all phases always measurable. Pooling is v2
(that's why phase fields in `TimingBreakdown` are `Option` — reused connection zeroes DNS/TCP/TLS).

```
send(prepared) -> ResponseData:
  t0 = Instant::now()

  // 1. DNS (isolated hickory-resolver)
  dns_start = Instant::now()
  ips = hickory.lookup(host).await?               // error -> EngineError::Dns
  dns_ms = elapsed(dns_start)

  // 2. TCP
  tcp_start = Instant::now()
  stream = TcpStream::connect((ip, port)).await?  // error -> EngineError::Connect
  tcp_ms = elapsed(tcp_start)

  // 3. TLS (if https) — tokio-rustls
  tls_ms = None
  io = if https {
     tls_start = Instant::now()
     s = rustls_connector.connect(server_name, stream).await?   // error -> EngineError::Tls
     tls_ms = Some(elapsed(tls_start)); s.into()
  } else { stream.into() }

  // 4. hyper handshake + send
  (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?
  spawn(conn)                                     // drives connection in background
  ttfb_start = Instant::now()
  resp = sender.send_request(req).await?          // error -> EngineError::Send
  ttfb_ms = elapsed(ttfb_start)                   // until headers/1st byte

  // 5. download body
  dl_start = Instant::now()
  body = collect_body(resp).await?                // until last byte
  download_ms = elapsed(dl_start)

  timing = TimingBreakdown{ dns_ms:Some(dns_ms), tcp_ms:Some(tcp_ms), tls_ms,
                            ttfb_ms, download_ms, total_ms: elapsed(t0) }
  ResponseData{ status, status_text, headers, body: parse_body(...), timing, size_bytes }
```

Details:
- **rustls throughout** (ADR-006): `tokio_rustls::TlsConnector` with `rustls-native-certs` store. Never native-tls.
- Redirects/gzip/brotli/chunked that reqwest provided for free become our responsibility — implement only what's needed (ADR-005).
- Study reference for the phase pattern: crate `ttfb`.

---

## 6. Parse response (`engine::client::parse_body`)

```
by Content-Type:
  application/json                      -> serde_json::Value -> ResponseNode (DisplayKind Object/Array/Leaf)
  text/xml | application/soap+xml | */xml -> roxmltree -> ResponseNode
       -> look for soap:Body/soap:Fault (1.1) or env:Body/env:Fault (1.2)
          if found: ResponseBody::Soap{ body, fault: Some(SoapFault{code,reason,detail,actor}) }
          otherwise: ResponseBody::Soap{ body, fault: None } (or Xml if not SOAP)
  other                                 -> ResponseBody::Raw(text)
```

- **SOAP Fault is an ERROR** even with HTTP 200 (product.md F3). Detecting `Fault` in the Body is mandatory; the UI renders it as a structured error, never as green success.
- `ResponseNode.value` isolated per leaf enables **copy-leaf** (differentiator #2): the UI copies only the value, without the tag/prefix.
- Namespace prefixes preserved in `key` (e.g.: `ns2:MainValue`) but rendered dimmed.

---

## 7. Error taxonomy

```rust
// wsdl/error.rs
pub enum WsdlError {
    Fetch { url: String, source: ... },       // 404/timeout resolving import/include
    InvalidXml { url: String, ... },
    UnsupportedStyle,                          // rpc/encoded (ADR-010)
    ElementNotFound { qname: String },
    MissingSchemaLocation,
}
// engine/error.rs
pub enum EngineError { Dns(...), Connect(...), Tls(...), Send(...), Timeout, BodyRead(...) }
```
Shape/value errors live in `DomainError` (domain-model §10). Each layer only knows its own errors.

---

## 8. Agent rules (invariants)

- `wsdl::resolve` is the ONLY place that fetches external schemas (I/O). `wsdl::xsd` is pure over the already-resolved `SchemaSet`.
- Reject rpc/encoded and `use="encoded"` explicitly — do not attempt to serialize them.
- Always serialize by walking the pair (schema, value); the namespace of each element comes from `SchemaNode.namespace`.
- Content-Type/SOAPAction are derived from `soap_version` — never hardcode.
- MVP = one new connection per request (all phases measured). Pooling only in v2.
- Detecting `soap:Fault` is mandatory before marking a response as success.
- Type recursion: depth cap + lazy expansion; never expand infinitely during parse.
