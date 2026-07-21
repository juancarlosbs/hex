import { describe, it, expect } from "vitest";
import { defaultFormValue, setLeafAt } from "./soapForm";
import type { SchemaNode } from "../lib/api";

const leaf = (name: string, min = 1, def: string | null = null): SchemaNode => ({
  name, namespace: null, occurs: { min, max: { bounded: 1 } }, nillable: false,
  doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: def, fixed: null } },
});

describe("defaultFormValue", () => {
  it("required leaf → empty string; optional → omitted", () => {
    expect(defaultFormValue(leaf("a"))).toEqual({ leaf: "" });
    expect(defaultFormValue(leaf("b", 0))).toEqual("omitted");
  });
  it("default prefills", () => {
    expect(defaultFormValue(leaf("c", 1, "X"))).toEqual({ leaf: "X" });
  });
  it("fixed prefills over default", () => {
    const node: SchemaNode = {
      ...leaf("d"),
      kind: { leaf: { xsdType: "string", enumValues: [], default: "X", fixed: "Y" } },
    };
    expect(defaultFormValue(node)).toEqual({ leaf: "Y" });
  });
  it("sequence recurses in order", () => {
    const seq: SchemaNode = { ...leaf("Root"), kind: { sequence: [leaf("a"), leaf("b", 0)] } };
    expect(defaultFormValue(seq)).toEqual({ sequence: [{ leaf: "" }, "omitted"] });
  });
  it("repeatable (unbounded) → empty repeated", () => {
    const node: SchemaNode = { ...leaf("r"), occurs: { min: 1, max: "unbounded" } };
    expect(defaultFormValue(node)).toEqual({ repeated: [] });
  });
  it("repeatable (bounded > 1) → empty repeated", () => {
    const node: SchemaNode = { ...leaf("r"), occurs: { min: 1, max: { bounded: 3 } } };
    expect(defaultFormValue(node)).toEqual({ repeated: [] });
  });
  it("choice picks first branch", () => {
    const node: SchemaNode = { ...leaf("Root"), kind: { choice: [leaf("a"), leaf("b")] } };
    expect(defaultFormValue(node)).toEqual({ choice: { branch: 0, value: { leaf: "" } } });
  });
  it("any → raw empty string", () => {
    const node: SchemaNode = { ...leaf("Root"), kind: "any" };
    expect(defaultFormValue(node)).toEqual({ raw: "" });
  });
});

describe("setLeafAt", () => {
  it("sets a leaf inside a sequence immutably", () => {
    const root = { sequence: [{ leaf: "" }, "omitted" as const] };
    const next = setLeafAt(root, [0], "hello");
    expect(next).toEqual({ sequence: [{ leaf: "hello" }, "omitted"] });
    expect(root).toEqual({ sequence: [{ leaf: "" }, "omitted"] }); // unchanged
  });
  it("sets a leaf inside a nested choice value", () => {
    const root = { choice: { branch: 0, value: { sequence: [{ leaf: "" }] } } };
    const next = setLeafAt(root, [0], "hi");
    expect(next).toEqual({ choice: { branch: 0, value: { sequence: [{ leaf: "hi" }] } } });
  });
  it("sets leaf to null", () => {
    const root = { sequence: [{ leaf: "x" }] };
    expect(setLeafAt(root, [0], null)).toEqual({ sequence: [{ leaf: null }] });
  });
});
