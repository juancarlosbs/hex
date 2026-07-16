import { create } from "zustand";
import { HttpResponse } from "../lib/response-types";
import { OpenRequest } from "../lib/request-types";
import { api } from "../lib/api";

export type ResponseEntry =
  | { state: "loading" }
  | { state: "done"; response: HttpResponse }
  | { state: "error"; error: string };

interface ResponseState {
  responses: Record<string, ResponseEntry>;
  /** per-request send sequence; a result older than the current seq is discarded */
  seq: Record<string, number>;

  send(request: OpenRequest): Promise<void>;
  cancel(id: string): void;
  clear(id: string): void;
  clearAll(): void;
}

export const useResponseStore = create<ResponseState>((set, get) => ({
  responses: {},
  seq: {},

  async send(request) {
    const id = request.id;
    const mySeq = (get().seq[id] ?? 0) + 1;
    set((s) => ({
      seq: { ...s.seq, [id]: mySeq },
      responses: { ...s.responses, [id]: { state: "loading" } },
    }));

    let entry: ResponseEntry;
    try {
      const response = await api.sendRequest({
        method: request.method,
        url: request.url,
        params: request.params,
        headers: request.headers,
        body: request.body,
        auth: request.auth,
      });
      entry = { state: "done", response };
    } catch (e) {
      entry = { state: "error", error: String(e) };
    }

    if (get().seq[id] !== mySeq) return; // cancelled or superseded
    set((s) => ({ responses: { ...s.responses, [id]: entry } }));
  },

  cancel(id) {
    set((s) => {
      const { [id]: _removed, ...responses } = s.responses;
      return { seq: { ...s.seq, [id]: (s.seq[id] ?? 0) + 1 }, responses };
    });
  },

  clear(id) {
    set((s) => {
      const { [id]: _r, ...responses } = s.responses;
      const { [id]: _q, ...seq } = s.seq;
      return { responses, seq };
    });
  },

  clearAll() {
    set({ responses: {}, seq: {} });
  },
}));
