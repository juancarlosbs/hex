import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../lib/api", () => ({
  api: {
    previewDefinitionUpdate: vi.fn(),
    applyDefinitionUpdate: vi.fn(),
    listCollections: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../lib/storage", () => ({
  getStore: vi.fn().mockResolvedValue({ set: vi.fn(), get: vi.fn() }),
}));

import { UpdateDefinitionModal } from "./UpdateDefinitionModal";
import { useUpdateDefinitionStore } from "../store/updateDefinitionStore";
import { DefinitionUpdatePreview } from "../lib/api";

const OP = {
  name: "Mul",
  endpoint: "http://x/svc",
  soapAction: "http://x/Mul",
  soapVersion: "1.1" as const,
  inputElement: { namespace: "http://x/ns", local: "Mul" },
};

const PREVIEW: DefinitionUpdatePreview = {
  serviceName: "CalcService",
  wsdlUrl: "http://x/svc?wsdl",
  diff: { new: [OP], changed: [{ ...OP, name: "Add" }], removed: ["Sub"], unchanged: 1 },
};

afterEach(cleanup);
beforeEach(() => {
  useUpdateDefinitionStore.setState({ phase: { state: "idle" } });
});

describe("UpdateDefinitionModal", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<UpdateDefinitionModal />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the three diff sections in preview", () => {
    useUpdateDefinitionStore.setState({
      phase: { state: "preview", collectionId: "c1", preview: PREVIEW },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText("Mul")).toBeTruthy();
    expect(screen.getByText("Add")).toBeTruthy();
    expect(screen.getByText("Sub")).toBeTruthy();
    expect(screen.getByText("Apply Changes")).toBeTruthy();
  });

  it("shows an up-to-date message for an empty diff", () => {
    useUpdateDefinitionStore.setState({
      phase: {
        state: "preview",
        collectionId: "c1",
        preview: { ...PREVIEW, diff: { new: [], changed: [], removed: [], unchanged: 2 } },
      },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText(/up to date/i)).toBeTruthy();
    expect(screen.queryByText("Apply Changes")).toBeNull();
  });

  it("shows the summary in done state and resets on OK", () => {
    useUpdateDefinitionStore.setState({
      phase: { state: "done", summary: "Applied: 1 new, 1 changed, 1 orphaned" },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText("Applied: 1 new, 1 changed, 1 orphaned")).toBeTruthy();
    fireEvent.click(screen.getByText("OK"));
    expect(useUpdateDefinitionStore.getState().phase.state).toBe("idle");
  });

  it("shows the error message", () => {
    useUpdateDefinitionStore.setState({
      phase: { state: "error", message: "fetch http://x failed: HTTP 404" },
    });
    render(<UpdateDefinitionModal />);
    expect(screen.getByText("fetch http://x failed: HTTP 404")).toBeTruthy();
  });
});
