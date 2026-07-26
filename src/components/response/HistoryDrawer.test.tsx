import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../lib/api", () => ({
  api: { listHistory: vi.fn(), getHistoryEntry: vi.fn(), clearHistory: vi.fn() },
}));

import { HistoryDrawer } from "./HistoryDrawer";
import { useHistoryStore } from "../../store/historyStore";
import type { HistoryEntrySummary } from "../../lib/api";

const ENTRIES: HistoryEntrySummary[] = [
  { id: 2, executedAtMs: Date.now() - 60_000, method: "GET", status: 200, durationMs: 12, sizeBytes: 5, error: null },
  { id: 1, executedAtMs: Date.now() - 120_000, method: "GET", status: null, durationMs: null, sizeBytes: null, error: "dns failure" },
];

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  useHistoryStore.setState({ openFor: "r1", entries: ENTRIES, loading: false, viewing: {} });
});

describe("HistoryDrawer", () => {
  it("renders one row per entry with status and error badges", () => {
    render(<HistoryDrawer />);
    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    useHistoryStore.setState({ openFor: null });
    const { container } = render(<HistoryDrawer />);
    expect(container.firstChild).toBeNull();
  });

  it("clicking a row views that entry", () => {
    const view = vi.fn();
    useHistoryStore.setState({ view } as never);
    render(<HistoryDrawer />);
    fireEvent.click(screen.getByText("200"));
    expect(view).toHaveBeenCalledWith("r1", 2);
  });

  it("shows an empty state when there are no entries", () => {
    useHistoryStore.setState({ entries: [] });
    render(<HistoryDrawer />);
    expect(screen.getByText(/no sends yet/i)).toBeTruthy();
  });
});
