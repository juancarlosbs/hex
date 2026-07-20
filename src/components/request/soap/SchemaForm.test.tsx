import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchemaForm } from "./SchemaForm";
import type { SchemaNode } from "../../../lib/api";

const seq: SchemaNode = {
  name: "Order", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
  doc: null, attributes: [],
  kind: { sequence: [{
    name: "id", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
    doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
  }] },
};

describe("SchemaForm", () => {
  it("edits a leaf and emits the updated FormValue tree", () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={seq} value={{ sequence: [{ leaf: "" }] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "A1" } });
    expect(onChange).toHaveBeenCalledWith({ sequence: [{ leaf: "A1" }] });
  });

  it("switches a choice branch and emits the new branch's default value", () => {
    const onChange = vi.fn();
    const choiceSchema: SchemaNode = {
      name: "Payment", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
      doc: null, attributes: [],
      kind: {
        choice: [
          {
            name: "card", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
            doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
          },
          {
            name: "cash", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
            doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: "cashDefault", fixed: null } },
          },
        ],
      },
    };
    render(
      <SchemaForm
        schema={choiceSchema}
        value={{ choice: { branch: 0, value: { leaf: "" } } }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Payment branch"), { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith({
      choice: { branch: 1, value: { leaf: "cashDefault" } },
    });
  });

  it("toggling an optional node off emits omitted", () => {
    const onChange = vi.fn();
    const optionalSchema: SchemaNode = {
      name: "nickname", namespace: null, occurs: { min: 0, max: { bounded: 1 } }, nillable: false,
      doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
    };
    render(<SchemaForm schema={optionalSchema} value={{ leaf: "Bob" }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("nickname present"));
    expect(onChange).toHaveBeenCalledWith("omitted");
  });

  it("repeatable add appends a default item", () => {
    const onChange = vi.fn();
    const repeatableSchema: SchemaNode = {
      name: "tag", namespace: null, occurs: { min: 1, max: "unbounded" }, nillable: false,
      doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
    };
    render(<SchemaForm schema={repeatableSchema} value={{ repeated: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("add tag"));
    expect(onChange).toHaveBeenCalledWith({ repeated: [{ leaf: "" }] });
  });
});
