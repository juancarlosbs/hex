import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    fireEvent.click(screen.getByLabelText("Payment branch cash"));
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

  it("toggling an optional+repeatable node on seeds an empty repeated list", () => {
    const onChange = vi.fn();
    const optRepeatable: SchemaNode = {
      name: "tag", namespace: null, occurs: { min: 0, max: "unbounded" }, nillable: false,
      doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
    };
    render(<SchemaForm schema={optRepeatable} value={"omitted"} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("tag present"));
    expect(onChange).toHaveBeenCalledWith({ repeated: [] });
  });

  it("collapsing a complex node hides its children", () => {
    const nested: SchemaNode = {
      name: "Root", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
      doc: null, attributes: [],
      kind: { sequence: [{
        name: "Group", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
        doc: null, attributes: [],
        kind: { sequence: [{
          name: "field", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
          doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
        }] },
      }] },
    };
    render(<SchemaForm schema={nested} value={{ sequence: [{ sequence: [{ leaf: "" }] }] }} onChange={() => {}} />);
    expect(screen.getByLabelText("field")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("toggle Group"));
    expect(screen.queryByLabelText("field")).toBeNull();
  });

  it("shows a recursive badge and expands a lazyRef node on demand", async () => {
    const onChange = vi.fn();
    const onSchemaChange = vi.fn();
    const lazyNext: SchemaNode = {
      name: "next", namespace: null, occurs: { min: 0, max: { bounded: 1 } }, nillable: false,
      doc: "recursive: expand on demand", attributes: [],
      kind: { lazyRef: { namespace: "urn:t", local: "Node" } },
    };
    const schema: SchemaNode = {
      name: "Root", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
      doc: null, attributes: [],
      kind: { sequence: [lazyNext] },
    };
    const expanded: SchemaNode = {
      ...lazyNext,
      doc: null,
      kind: { sequence: [{
        name: "value", namespace: null, occurs: { min: 1, max: { bounded: 1 } }, nillable: false,
        doc: null, attributes: [], kind: { leaf: { xsdType: "string", enumValues: [], default: null, fixed: null } },
      }] },
    };
    const expand = vi.fn().mockResolvedValue(expanded);

    render(
      <SchemaForm
        schema={schema}
        value={{ sequence: ["omitted"] }}
        onChange={onChange}
        onSchemaChange={onSchemaChange}
        expandNode={expand}
      />
    );
    expect(screen.getByText("recursive")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("expand next"));
    await waitFor(() => expect(onSchemaChange).toHaveBeenCalled());
    expect(expand).toHaveBeenCalledWith(lazyNext);
    expect(onSchemaChange).toHaveBeenCalledWith({ ...schema, kind: { sequence: [expanded] } });
    expect(onChange).toHaveBeenCalledWith({ sequence: ["omitted"] }); // min=0 → still omitted until user fills
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
