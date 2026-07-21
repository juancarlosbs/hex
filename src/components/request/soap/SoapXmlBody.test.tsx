import { describe, it, expect } from "vitest";
import { formatXml, tokenizeXml } from "./SoapXmlBody";

describe("tokenizeXml", () => {
  it("classifies tags, attributes, strings, punctuation and text", () => {
    const toks = tokenizeXml('<pay:Id x="1">A1</pay:Id>');
    expect(toks).toEqual([
      { text: "<", cls: "punct" },
      { text: "pay:Id", cls: "tag" },
      { text: " ", cls: "text" },
      { text: "x", cls: "attr" },
      { text: "=", cls: "punct" },
      { text: '"1"', cls: "string" },
      { text: ">", cls: "punct" },
      { text: "A1", cls: "text" },
      { text: "</", cls: "punct" },
      { text: "pay:Id", cls: "tag" },
      { text: ">", cls: "punct" },
    ]);
  });

  it("preserves every character (round-trips the source)", () => {
    const src = '<?xml version="1.0"?>\n<a>\n  <b/>\n</a>';
    expect(tokenizeXml(src).map((t) => t.text).join("")).toBe(src);
  });
});

describe("formatXml", () => {
  it("indents nested elements and keeps leaf text on one line", () => {
    const out = formatXml(
      '<Envelope><Body><Op><Id>A1</Id></Op></Body></Envelope>',
    );
    expect(out).toBe(
      [
        "<Envelope>",
        "  <Body>",
        "    <Op>",
        "      <Id>A1</Id>",
        "    </Op>",
        "  </Body>",
        "</Envelope>",
      ].join("\n"),
    );
  });

  it("keeps empty short-named elements one-line and correctly nested", () => {
    const out = formatXml(
      '<soapenv:Body><ns0:AddRequest><a></a><b></b></ns0:AddRequest></soapenv:Body>',
    );
    expect(out).toBe(
      [
        "<soapenv:Body>",
        "  <ns0:AddRequest>",
        "    <a></a>",
        "    <b></b>",
        "  </ns0:AddRequest>",
        "</soapenv:Body>",
      ].join("\n"),
    );
  });
});
