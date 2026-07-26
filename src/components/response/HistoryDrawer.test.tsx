import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", () => ({
  api: { listHistory: vi.fn(), getHistoryEntry: vi.fn(), clearHistory: vi.fn() },
}));
vi.mock("../../store/requestStore", () => ({
  useRequestStore: Object.assign(vi.fn(), { setState: vi.fn(), getState: vi.fn() }),
}));

import { HistoryDrawer } from "./HistoryDrawer";
import { useHistoryStore } from "../../store/historyStore";
import { useRequestStore } from "../../store/requestStore";
import type { HistoryEntry, HistoryEntrySummary } from "../../lib/api";
import { api } from "../../lib/api";

const ENTRIES: HistoryEntrySummary[] = [
  { id: 2, executedAtMs: Date.now() - 60_000, method: "GET", status: 200, durationMs: 12, sizeBytes: 5, error: null },
  { id: 1, executedAtMs: Date.now() - 120_000, method: "GET", status: null, durationMs: null, sizeBytes: null, error: "dns failure" },
];

const HISTORY_ENTRY: HistoryEntry = {
  id: 2,
  executedAtMs: Date.now(),
  spec: {
    kind: "rest",
    spec: {
      method: "GET",
      url: "https://x.dev",
      params: [],
      headers: [],
      body: { mode: "json", json: "", form: [] },
      auth: { type: "none" },
    },
  },
  response: null,
  error: null,
};

let applyHistorySpec: ReturnType<typeof vi.fn>;
let dirty: boolean;

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  useHistoryStore.setState({ openFor: "r1", entries: ENTRIES, loading: false, viewing: {} });
  applyHistorySpec = vi.fn();
  dirty = false;
  vi.mocked(useRequestStore).mockImplementation((selector) =>
    selector({
      applyHistorySpec,
      openRequests: { r1: { dirty } },
    } as never)
  );
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

  it("restoring over a dirty draft requires a second click", async () => {
    dirty = true;
    vi.mocked(api.getHistoryEntry).mockResolvedValue(HISTORY_ENTRY);
    render(<HistoryDrawer />);

    const [restoreBtn] = screen.getAllByTitle("Restore this request into the editor");
    fireEvent.click(restoreBtn);
    expect(api.getHistoryEntry).not.toHaveBeenCalled();
    expect(applyHistorySpec).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Overwrite?"));
    await waitFor(() => expect(applyHistorySpec).toHaveBeenCalledWith("r1", HISTORY_ENTRY.spec));
  });

  it("restoring over a clean draft applies on the first click", async () => {
    dirty = false;
    vi.mocked(api.getHistoryEntry).mockResolvedValue(HISTORY_ENTRY);
    render(<HistoryDrawer />);

    const [restoreBtn] = screen.getAllByTitle("Restore this request into the editor");
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(applyHistorySpec).toHaveBeenCalledWith("r1", HISTORY_ENTRY.spec));
  });

  it("restore failure refreshes the list instead of applying", async () => {
    dirty = false;
    vi.mocked(api.getHistoryEntry).mockRejectedValue(new Error("not found"));
    vi.mocked(api.listHistory).mockResolvedValue([]);
    render(<HistoryDrawer />);

    const [restoreBtn] = screen.getAllByTitle("Restore this request into the editor");
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(api.listHistory).toHaveBeenCalledWith("r1"));
    expect(applyHistorySpec).not.toHaveBeenCalled();
  });

  it("clearing history requires a second click", () => {
    const clear = vi.fn();
    useHistoryStore.setState({ clear } as never);
    render(<HistoryDrawer />);

    fireEvent.click(screen.getByText("Clear history"));
    expect(clear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Really clear?"));
    expect(clear).toHaveBeenCalledWith("r1");
  });
});
