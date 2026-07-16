import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: { sendRequest: vi.fn() },
}));

import { useResponseStore } from "./responseStore";
import { makeEmptyRequest } from "../lib/request-types";
import { HttpResponse } from "../lib/response-types";
import { api } from "../lib/api";

const RESP: HttpResponse = {
  status: 200,
  statusText: "OK",
  timeMs: 5,
  sizeBytes: 2,
  headers: {},
  body: "{}",
};

const request = () => makeEmptyRequest("r1", "R1", "GET", ["c1", "r1"]);

beforeEach(() => {
  useResponseStore.setState({ responses: {}, seq: {} });
  vi.clearAllMocks();
});

describe("send", () => {
  it("sets loading then done with the response", async () => {
    let resolve!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest).mockReturnValue(
      new Promise((res) => { resolve = res; })
    );
    const p = useResponseStore.getState().send(request());
    expect(useResponseStore.getState().responses.r1).toEqual({ state: "loading" });
    resolve(RESP);
    await p;
    expect(useResponseStore.getState().responses.r1).toEqual({ state: "done", response: RESP });
  });

  it("builds the spec from the open request", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    const req = request();
    req.url = "https://api.dev";
    req.method = "POST";
    await useResponseStore.getState().send(req);
    expect(api.sendRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "https://api.dev",
      params: req.params,
      headers: req.headers,
      body: req.body,
      auth: req.auth,
    });
  });

  it("stores the error message on failure", async () => {
    vi.mocked(api.sendRequest).mockRejectedValue("connection refused");
    await useResponseStore.getState().send(request());
    expect(useResponseStore.getState().responses.r1).toEqual({
      state: "error",
      error: "connection refused",
    });
  });

  it("a newer send wins over an older one resolving late", async () => {
    let resolveFirst!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest)
      .mockReturnValueOnce(new Promise((res) => { resolveFirst = res; }))
      .mockResolvedValueOnce({ ...RESP, status: 201 });
    const first = useResponseStore.getState().send(request());
    await useResponseStore.getState().send(request());
    resolveFirst(RESP);
    await first;
    const entry = useResponseStore.getState().responses.r1;
    expect(entry).toEqual({ state: "done", response: { ...RESP, status: 201 } });
  });
});

describe("cancel", () => {
  it("clears the loading entry and discards the late result", async () => {
    let resolve!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest).mockReturnValue(
      new Promise((res) => { resolve = res; })
    );
    const p = useResponseStore.getState().send(request());
    useResponseStore.getState().cancel("r1");
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
    resolve(RESP);
    await p;
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
  });
});

describe("clear", () => {
  it("removes the entry and its sequence", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    await useResponseStore.getState().send(request());
    useResponseStore.getState().clear("r1");
    expect(useResponseStore.getState().responses.r1).toBeUndefined();
    expect(typeof useResponseStore.getState().seq.r1).toBe("number");
  });

  it("bumps the counter to discard in-flight results after clear", async () => {
    let resolveA!: (r: HttpResponse) => void;
    vi.mocked(api.sendRequest)
      .mockReturnValueOnce(new Promise((res) => { resolveA = res; }))
      .mockResolvedValueOnce({ ...RESP, status: 201 });
    const sendA = useResponseStore.getState().send(request());
    useResponseStore.getState().clear("r1");
    const sendB = useResponseStore.getState().send(request());
    resolveA(RESP);
    await sendA;
    await sendB;
    const entry = useResponseStore.getState().responses.r1;
    expect(entry).toEqual({ state: "done", response: { ...RESP, status: 201 } });
  });

  it("clearAll empties the store", async () => {
    vi.mocked(api.sendRequest).mockResolvedValue(RESP);
    await useResponseStore.getState().send(request());
    useResponseStore.getState().clearAll();
    expect(useResponseStore.getState().responses).toEqual({});
    expect(useResponseStore.getState().seq).toEqual({});
  });
});
