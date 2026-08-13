import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { RequestTabsBar } from "./RequestTabsBar";
import { useRequestStore } from "../../store/requestStore";
import { useCollectionStore } from "../../store/collectionStore";
import { makeEmptyRequest } from "../../lib/request-types";

function openTwo(dirtySecond = false) {
  const a = makeEmptyRequest("r1", "Get Users", "GET");
  const b = { ...makeEmptyRequest("r2", "Create Order", "POST"), dirty: dirtySecond };
  useRequestStore.setState({
    openRequests: { r1: a, r2: b },
    order: ["r1", "r2"],
    activeId: "r1",
  });
}

afterEach(cleanup);
beforeEach(() => {
  useRequestStore.setState({ openRequests: {}, order: [], activeId: null });
  useCollectionStore.setState({ activeRequestId: null });
});

describe("RequestTabsBar", () => {
  it("renders one tab per open request with method and name", () => {
    openTwo();
    render(<RequestTabsBar />);
    expect(screen.getByText("GET")).toBeTruthy();
    expect(screen.getByText("Get Users")).toBeTruthy();
    expect(screen.getByText("POST")).toBeTruthy();
    expect(screen.getByText("Create Order")).toBeTruthy();
  });

  it("activates a tab on click", () => {
    openTwo();
    render(<RequestTabsBar />);
    fireEvent.click(screen.getByText("Create Order"));
    expect(useRequestStore.getState().activeId).toBe("r2");
    expect(useCollectionStore.getState().activeRequestId).toBe("r2");
  });

  it("closes a clean tab immediately on X", () => {
    openTwo();
    const { container } = render(<RequestTabsBar />);
    const closeIcons = container.querySelectorAll("svg.lucide-x");
    fireEvent.click(closeIcons[1]);
    expect(useRequestStore.getState().order).toEqual(["r1"]);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("confirms before closing a dirty tab", () => {
    openTwo(true);
    const { container } = render(<RequestTabsBar />);
    const closeIcons = container.querySelectorAll("svg.lucide-x");

    fireEvent.click(closeIcons[1]);
    expect(screen.getByText("Discard changes?")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(useRequestStore.getState().order).toEqual(["r1", "r2"]);

    fireEvent.click(container.querySelectorAll("svg.lucide-x")[1]);
    fireEvent.click(screen.getByText("Discard"));
    expect(useRequestStore.getState().order).toEqual(["r1"]);
  });

  it("renders a hexagon instead of the method for SOAP tabs", () => {
    const soap = {
      ...makeEmptyRequest("s1", "GetBalance", "POST"),
      soap: {
        meta: { wsdlUrl: "", inputElement: { namespace: "", local: "" }, endpoint: "", soapAction: "", soapVersion: "1.1" },
        schema: null,
        value: "omitted" as const,
        xmlDraft: null,
      },
    };
    useRequestStore.setState({ openRequests: { s1: soap }, order: ["s1"], activeId: "s1" });
    const { container } = render(<RequestTabsBar />);
    expect(container.querySelector("svg.lucide-hexagon")).toBeTruthy();
    expect(screen.queryByText("POST")).toBeNull();
  });

  it("renders nothing when no requests are open", () => {
    const { container } = render(<RequestTabsBar />);
    expect(container.firstChild).toBeNull();
  });
});
