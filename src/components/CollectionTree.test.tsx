import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CollectionTree } from "./CollectionTree";
import { useCollectionStore } from "../store/collectionStore";
import { useRequestStore } from "../store/requestStore";
import type { CollectionNode } from "../lib/api";

const soapNode: CollectionNode = {
  type: "request",
  id: "op1",
  name: "AddOperation",
  kind: "soap",
  wsdlUrl: "http://svc?wsdl",
  operation: "Add",
  inputElement: { namespace: "urn:x", local: "Add" },
};

const restNode: CollectionNode = {
  type: "request",
  id: "r1",
  name: "GetThing",
  kind: "rest",
  method: "GET",
  url: "http://api/thing",
};

afterEach(cleanup);

beforeEach(() => {
  useCollectionStore.setState({ collections: [], activeRequestId: null });
});

describe("CollectionTree — orphaned SOAP operation (F6)", () => {
  it("renders an orphan with strikethrough and explanatory title", () => {
    useCollectionStore.setState({ collections: [{ ...soapNode, orphan: true }] });

    render(<CollectionTree workspaceId="w1" />);

    const name = screen.getByText("AddOperation");
    expect(name.className).toContain("line-through");
    expect(screen.getByTitle("Operation no longer exists in the WSDL")).toBeTruthy();
  });

  it("renders a non-orphan without strikethrough", () => {
    useCollectionStore.setState({ collections: [soapNode] });

    render(<CollectionTree workspaceId="w1" />);

    expect(screen.getByText("AddOperation").className).not.toContain("line-through");
  });
});

describe("CollectionTree — opening a request node", () => {
  it("opens a SOAP operation on click (regression: was gated to kind==='rest')", () => {
    const openRequest = vi.fn();
    useCollectionStore.setState({ collections: [soapNode] });
    useRequestStore.setState({ openRequest });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.click(screen.getByText("AddOperation"));

    expect(openRequest).toHaveBeenCalledWith("op1", "AddOperation", ["op1"]);
  });

  it("still opens a REST request on click", () => {
    const openRequest = vi.fn();
    useCollectionStore.setState({ collections: [restNode] });
    useRequestStore.setState({ openRequest });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.click(screen.getByText("GetThing"));

    expect(openRequest).toHaveBeenCalledWith("r1", "GetThing", ["r1"]);
  });
});
