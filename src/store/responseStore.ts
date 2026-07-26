import { create } from "zustand";
import { HttpResponse } from "../lib/response-types";
import { OpenRequest, methodAllowsBody } from "../lib/request-types";
import { api } from "../lib/api";
import { useHistoryStore } from "./historyStore";

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
    // ponytail: path.length === 0 means a scratch request that was never
    // saved to a collection — no id to attach history to.
    const historyId = request.path.length > 0 ? request.id : null;
    const mySeq = (get().seq[id] ?? 0) + 1;
    useHistoryStore.getState().backToLive(id); // a new send outranks a history view
    set((s) => ({
      seq: { ...s.seq, [id]: mySeq },
      responses: { ...s.responses, [id]: { state: "loading" } },
    }));

    let entry: ResponseEntry;
    try {
      const response = request.soap
        ? request.soap.xmlDraft !== null
          ? await api.sendSoapRaw({
              endpoint: request.soap.meta.endpoint,
              envelope: request.soap.xmlDraft,
              soapAction: request.soap.meta.soapAction,
              soapVersion: request.soap.meta.soapVersion,
              requestId: historyId,
            })
          : await api.sendSoap({
              ...request.soap.meta,
              value: request.soap.value,
              requestId: historyId,
            })
        : await api.sendRequest(
            {
              method: request.method,
              url: request.url,
              params: request.params,
              headers: request.headers,
              body: methodAllowsBody(request.method)
                ? request.body
                : { mode: "json", json: "", form: [] },
              auth: request.auth,
            },
            historyId,
          );
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
      // seq is kept and bumped (not deleted) so an in-flight send from before the clear is discarded
      return { seq: { ...s.seq, [id]: (s.seq[id] ?? 0) + 1 }, responses };
    });
  },

  clearAll() {
    set({ responses: {}, seq: {} });
  },
}));
