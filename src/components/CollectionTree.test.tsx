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

const folderNode: CollectionNode = {
  type: "folder",
  id: "f1",
  name: "MyFolder",
  children: [],
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

describe("CollectionTree — organize actions", () => {
  it("Duplicate in a request's context menu calls store.duplicate with the path", () => {
    const duplicate = vi.fn();
    useCollectionStore.setState({ collections: [restNode], duplicate });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Duplicate"));

    expect(duplicate).toHaveBeenCalledWith("w1", ["r1"]);
  });

  it("Duplicate in a folder's context menu calls store.duplicate with the path", () => {
    const duplicate = vi.fn();
    useCollectionStore.setState({ collections: [folderNode], duplicate });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("MyFolder"));
    fireEvent.click(screen.getByText("Duplicate"));

    expect(duplicate).toHaveBeenCalledWith("w1", ["f1"]);
  });

  it("Delete opens a confirmation modal and does not delete until confirmed", () => {
    const remove = vi.fn();
    useCollectionStore.setState({ collections: [restNode], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Delete"));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();

    // the context menu is closed now; the only "Delete" left is the modal button
    fireEvent.click(screen.getByText("Delete"));
    expect(remove).toHaveBeenCalledWith("w1", ["r1"]);
  });

  it("Cancel closes the confirmation without deleting", () => {
    const remove = vi.fn();
    useCollectionStore.setState({ collections: [restNode], remove });

    render(<CollectionTree workspaceId="w1" />);
    fireEvent.contextMenu(screen.getByText("GetThing"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
  });
});
