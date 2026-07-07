// src/store/requestStore.ts
import { create } from "zustand";
import {
  AuthConfig,
  BodyMode,
  HttpMethod,
  KeyValue,
  OpenRequest,
  RequestTab,
  makeEmptyRequest,
} from "../lib/request-types";

interface RequestState {
  openRequests: Record<string, OpenRequest>;
  order: string[]; // tab order in titlebar
  activeId: string | null;

  openRequest(id: string, name: string, method?: HttpMethod): void;
  closeRequest(id: string): void;
  setActive(id: string | null): void;

  setUrl(id: string, url: string): void;
  setMethod(id: string, method: HttpMethod): void;
  setActiveTab(id: string, tab: RequestTab): void;

  setKV(id: string, section: "params" | "headers", row: KeyValue): void;
  addKV(id: string, section: "params" | "headers"): void;
  removeKV(id: string, section: "params" | "headers", rowId: string): void;

  setBodyMode(id: string, mode: BodyMode): void;
  setBodyJson(id: string, json: string): void;
  setFormRow(id: string, row: KeyValue): void;
  addFormRow(id: string): void;
  removeFormRow(id: string, rowId: string): void;

  setAuth(id: string, auth: AuthConfig): void;
}

const uid = () => crypto.randomUUID();

export const useRequestStore = create<RequestState>((set) => ({
  openRequests: {},
  order: [],
  activeId: null,

  openRequest(id, name, method = "GET") {
    set((s) => {
      if (s.openRequests[id]) return { ...s, activeId: id };
      return {
        openRequests: { ...s.openRequests, [id]: makeEmptyRequest(id, name, method) },
        order: [...s.order, id],
        activeId: id,
      };
    });
  },

  closeRequest(id) {
    set((s) => {
      const { [id]: _removed, ...rest } = s.openRequests;
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? (order[order.length - 1] ?? null) : s.activeId;
      return { openRequests: rest, order, activeId };
    });
  },

  setActive(id) { set({ activeId: id }); },

  setUrl(id, url) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { url }) }));
  },
  setMethod(id, method) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { method }) }));
  },
  setActiveTab(id, activeTab) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { activeTab }) }));
  },

  setKV(id, section, row) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = r[section].map((x) => (x.id === row.id ? row : x));
      return { openRequests: patch(s.openRequests, id, { [section]: list }) };
    });
  },
  addKV(id, section) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = [...r[section], { id: uid(), key: "", value: "", enabled: true }];
      return { openRequests: patch(s.openRequests, id, { [section]: list }) };
    });
  },
  removeKV(id, section, rowId) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = r[section].filter((x) => x.id !== rowId);
      return { openRequests: patch(s.openRequests, id, { [section]: list }) };
    });
  },

  setBodyMode(id, mode) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, mode } }) };
    });
  },
  setBodyJson(id, json) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, json } }) };
    });
  },
  setFormRow(id, row) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = r.body.form.map((x) => (x.id === row.id ? row : x));
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form } }) };
    });
  },
  addFormRow(id) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = [
        ...r.body.form,
        { id: uid(), key: "", value: "", enabled: true, type: "text" as const },
      ];
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form } }) };
    });
  },
  removeFormRow(id, rowId) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = r.body.form.filter((x) => x.id !== rowId);
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form } }) };
    });
  },

  setAuth(id, auth) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { auth }) }));
  },
}));

function patch(
  map: Record<string, OpenRequest>,
  id: string,
  fields: Partial<OpenRequest>,
): Record<string, OpenRequest> {
  const cur = map[id];
  if (!cur) return map;
  return { ...map, [id]: { ...cur, ...fields } };
}
