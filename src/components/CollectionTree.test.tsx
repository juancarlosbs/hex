import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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

describe("CollectionTree — organize (flow F5)", () => {
  it("deleting a request requires confirmation (anti-SoapUI: never lose a request)", () => {
    const remove = vi.fn();
    useCollectionStore.setState({ collections: [restNode], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Delete"));

    // nothing deleted yet — the confirmation modal is up
    expect(remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Delete"));

    expect(remove).toHaveBeenCalledWith("w1", ["r1"]);
  });

  it("cancelling the delete confirmation keeps the request", () => {
    const remove = vi.fn();
    useCollectionStore.setState({ collections: [restNode], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Cancel"));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deleting a folder also requires confirmation", () => {
    const remove = vi.fn();
    const folder: CollectionNode = { type: "folder", id: "f1", name: "My API", children: [] };
    useCollectionStore.setState({ collections: [folder], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("My API"));
    fireEvent.click(screen.getByText("Delete"));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Delete"));

    expect(remove).toHaveBeenCalledWith("w1", ["f1"]);
  });

  it("duplicates a request from the context menu", () => {
    const duplicate = vi.fn();
    useCollectionStore.setState({ collections: [restNode], duplicate });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Duplicate"));

    expect(duplicate).toHaveBeenCalledWith("w1", ["r1"]);
  });

  it("moves a request to another collection through the Move to modal", () => {
    const move = vi.fn().mockResolvedValue(true);
    const collections: CollectionNode[] = [
      { type: "folder", id: "colA", name: "API A", children: [restNode] },
      { type: "folder", id: "colB", name: "API B", children: [] },
    ];
    useCollectionStore.setState({ collections, move });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Move to…"));

    const dialog = screen.getByRole("dialog");
    // current parent is offered but disabled
    expect((within(dialog).getByText("API A").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByText("API B"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    expect(move).toHaveBeenCalledWith("w1", ["colA", "r1"], ["colB"]);
  });
});
