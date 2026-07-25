import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../lib/api", () => ({
  api: { listSendHistory: vi.fn() },
}));
vi.mock("../../store/workspaceStore", () => ({
  useWorkspaceStore: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: "ws1" }),
}));

import { HistoryTab } from "./HistoryTab";
import { api, type HistoryEntry } from "../../lib/api";

const ENTRIES: HistoryEntry[] = [
  { timestampMs: 1700000000000, status: 200, timeMs: 42, sizeBytes: 1536, error: null },
  { timestampMs: 1700000001000, status: null, timeMs: 7, sizeBytes: 0, error: "connection refused" },
];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("HistoryTab", () => {
  it("lists recorded sends with status, duration and size", async () => {
    vi.mocked(api.listSendHistory).mockResolvedValue(ENTRIES);
    render(<HistoryTab requestId="r1" />);
    expect(await screen.findByText("200")).toBeTruthy();
    expect(screen.getByText("42 ms")).toBeTruthy();
    expect(screen.getByText("1.5 kB")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(api.listSendHistory).toHaveBeenCalledWith("ws1", "r1");
  });

  it("shows an empty state when the request was never sent", async () => {
    vi.mocked(api.listSendHistory).mockResolvedValue([]);
    render(<HistoryTab requestId="r1" />);
    expect(await screen.findByText(/No sends yet/)).toBeTruthy();
  });
});
