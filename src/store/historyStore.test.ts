import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    listHistory: vi.fn(),
    getHistoryEntry: vi.fn(),
    clearHistory: vi.fn(),
  },
}));

import { useHistoryStore } from "./historyStore";
import { api } from "../lib/api";
import type { HistoryEntry, HistoryEntrySummary, HttpResponse } from "../lib/api";

const SUMMARY: HistoryEntrySummary = {
  id: 1,
  executedAtMs: 1_753_500_000_000,
  method: "GET",
  status: 200,
  durationMs: 12,
  sizeBytes: 2,
  error: null,
};

const RESPONSE: HttpResponse = {
  status: 200,
  statusText: "OK",
  timeMs: 12,
  sizeBytes: 2,
  headers: {},
  body: "{}",
  timing: { dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: 10, downloadMs: 2, totalMs: 12 },
  fault: null,
  truncated: false,
};

const ENTRY: HistoryEntry = {
  id: 1,
  executedAtMs: 1_753_500_000_000,
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
  response: RESPONSE,
  error: null,
};

const FAILED_ENTRY: HistoryEntry = {
  ...ENTRY,
  id: 2,
  response: null,
  error: "dns failure",
};

beforeEach(() => {
  useHistoryStore.setState({ openFor: null, entries: [], loading: false, viewing: {} });
  vi.clearAllMocks();
});

describe("toggle", () => {
  it("opens for a request and loads its entries", async () => {
    vi.mocked(api.listHistory).mockResolvedValue([SUMMARY]);
    await useHistoryStore.getState().toggle("r1");
    expect(useHistoryStore.getState().openFor).toBe("r1");
    expect(useHistoryStore.getState().entries).toEqual([SUMMARY]);
  });

  it("closes when toggled for the same request", async () => {
    vi.mocked(api.listHistory).mockResolvedValue([]);
    await useHistoryStore.getState().toggle("r1");
    await useHistoryStore.getState().toggle("r1");
    expect(useHistoryStore.getState().openFor).toBeNull();
  });
});

describe("view / backToLive", () => {
  it("loads the entry response for viewing", async () => {
    vi.mocked(api.getHistoryEntry).mockResolvedValue(ENTRY);
    await useHistoryStore.getState().view("r1", 1);
    expect(useHistoryStore.getState().viewing.r1).toEqual({ response: RESPONSE, error: null });
  });

  it("loads the entry error for viewing when the send failed", async () => {
    vi.mocked(api.getHistoryEntry).mockResolvedValue(FAILED_ENTRY);
    await useHistoryStore.getState().view("r1", 2);
    expect(useHistoryStore.getState().viewing.r1).toEqual({ response: null, error: "dns failure" });
  });

  it("backToLive drops the viewed response", async () => {
    vi.mocked(api.getHistoryEntry).mockResolvedValue(ENTRY);
    await useHistoryStore.getState().view("r1", 1);
    useHistoryStore.getState().backToLive("r1");
    expect(useHistoryStore.getState().viewing.r1).toBeUndefined();
  });

  it("does not set viewing and re-fetches the list when the entry fails to load", async () => {
    vi.mocked(api.getHistoryEntry).mockRejectedValue(new Error("not found"));
    vi.mocked(api.listHistory).mockResolvedValue([]);
    useHistoryStore.setState({ openFor: "r1", entries: [SUMMARY], loading: false, viewing: {} });
    await useHistoryStore.getState().view("r1", 1);
    expect(useHistoryStore.getState().viewing.r1).toBeUndefined();
    expect(api.listHistory).toHaveBeenCalledWith("r1");
  });
});

describe("clear", () => {
  it("clears backend history and the list", async () => {
    vi.mocked(api.clearHistory).mockResolvedValue(null);
    useHistoryStore.setState({ openFor: "r1", entries: [SUMMARY], loading: false, viewing: {} });
    await useHistoryStore.getState().clear("r1");
    expect(api.clearHistory).toHaveBeenCalledWith("r1");
    expect(useHistoryStore.getState().entries).toEqual([]);
  });
});
