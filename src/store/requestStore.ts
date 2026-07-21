// src/store/requestStore.ts
import { create } from "zustand";
import {
  AuthConfig,
  BodyMode,
  HTTP_METHODS,
  HttpMethod,
  KeyValue,
  OpenRequest,
  RequestTab,
  makeEmptyRequest,
} from "../lib/request-types";
import { api, FormValue, RequestFileData } from "../lib/api";
import { useWorkspaceStore } from "./workspaceStore";
import { useCollectionStore } from "./collectionStore";
import { useResponseStore } from "./responseStore";
import { defaultFormValue } from "./soapForm";

interface RequestState {
  openRequests: Record<string, OpenRequest>;
  order: string[]; // tab order in titlebar
  activeId: string | null;

  openRequest(id: string, name: string, path: string[]): Promise<void>;
  saveRequest(id: string): Promise<void>;
  closeRequest(id: string): void;
  closeRequestsUnder(prefix: string[]): void;
  closeAll(): void;
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

  setSoapValue(id: string, next: FormValue): void;
  setSoapEndpoint(id: string, endpoint: string): void;
  setSoapVersion(id: string, soapVersion: string): void;
  setSoapXmlDraft(id: string, xmlDraft: string | null): void;
  /** Parse the XML draft back into the form. Returns null on success (form is
   * source again), or an error message when the XML doesn't conform (draft kept,
   * request stays in raw mode). */
  commitSoapXml(id: string): Promise<string | null>;
}

const uid = () => crypto.randomUUID();

export const useRequestStore = create<RequestState>((set, get) => ({
  openRequests: {},
  order: [],
  activeId: null,

  async openRequest(id, name, path) {
    if (get().openRequests[id]) {
      set({ activeId: id });
      return;
    }
    const workspaceId = useWorkspaceStore.getState().activeId;
    let req: OpenRequest;
    try {
      const data = await api.getRequest(workspaceId, path);
      req = fromFile(data, path);
    } catch (e) {
      console.error("getRequest failed:", e);
      req = makeEmptyRequest(id, name, "GET", path);
    }
    set((s) => {
      // re-check after the await: a concurrent openRequest may have landed first
      if (s.openRequests[id]) return { ...s, activeId: id };
      return {
        openRequests: { ...s.openRequests, [id]: req },
        order: s.order.includes(id) ? s.order : [...s.order, id],
        activeId: id,
      };
    });

    const soapMeta = req.soap?.meta;
    if (soapMeta) {
      try {
        const schema = await api.getOperationSchema(soapMeta.wsdlUrl, soapMeta.inputElement);
        set((s) => {
          const r = s.openRequests[id];
          // re-check: the request may have been closed/superseded while the fetch was in flight
          if (!r || !r.soap) return s;
          return {
            openRequests: patch(s.openRequests, id, {
              soap: { ...r.soap, schema, value: defaultFormValue(schema) },
            }),
          };
        });
      } catch (e) {
        console.error("getOperationSchema failed:", e);
      }
    }
  },

  async saveRequest(id) {
    const r = get().openRequests[id];
    if (!r) return;
    if (r.soap) return; // SOAP values are not persisted in this slice
    const workspaceId = useWorkspaceStore.getState().activeId;
    try {
      await api.updateRequest(workspaceId, r.path, {
        kind: "rest",
        method: r.method,
        url: r.url,
        params: r.params,
        headers: r.headers,
        body: r.body,
        auth: r.auth,
      });
      set((s) => {
        // r was edited again while the save was in flight — keep it dirty
        if (s.openRequests[id] !== r) return s;
        return { openRequests: patch(s.openRequests, id, { dirty: false }) };
      });
      useCollectionStore.getState().updateRequestMeta(r.path, r.method, r.url);
    } catch (e) {
      console.error("saveRequest failed:", e);
    }
  },

  closeRequest(id) {
    set((s) => {
      const { [id]: _removed, ...rest } = s.openRequests;
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? (order[order.length - 1] ?? null) : s.activeId;
      return { openRequests: rest, order, activeId };
    });
    useResponseStore.getState().clear(id);
  },

  closeRequestsUnder(prefix) {
    const isUnder = (path: string[]) =>
      path.length >= prefix.length && prefix.every((v, i) => path[i] === v);
    const removedIds = Object.keys(get().openRequests).filter((id) =>
      isUnder(get().openRequests[id].path)
    );
    if (removedIds.length === 0) return;
    const removed = new Set(removedIds);
    set((s) => {
      const openRequests = Object.fromEntries(
        Object.entries(s.openRequests).filter(([id]) => !removed.has(id))
      );
      const order = s.order.filter((id) => !removed.has(id));
      const activeId = s.activeId && removed.has(s.activeId) ? (order[order.length - 1] ?? null) : s.activeId;
      return { openRequests, order, activeId };
    });
    removedIds.forEach((rid) => useResponseStore.getState().clear(rid));
  },

  closeAll() {
    set({ openRequests: {}, order: [], activeId: null });
    useResponseStore.getState().clearAll();
  },

  setActive(id) { set({ activeId: id }); },

  setUrl(id, url) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { url, dirty: true }) }));
  },
  setMethod(id, method) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { method, dirty: true }) }));
  },
  setActiveTab(id, activeTab) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { activeTab }) }));
  },

  setKV(id, section, row) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = r[section].map((x) => (x.id === row.id ? row : x));
      return { openRequests: patch(s.openRequests, id, { [section]: list, dirty: true }) };
    });
  },
  addKV(id, section) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = [...r[section], { id: uid(), key: "", value: "", enabled: true }];
      return { openRequests: patch(s.openRequests, id, { [section]: list, dirty: true }) };
    });
  },
  removeKV(id, section, rowId) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const list = r[section].filter((x) => x.id !== rowId);
      return { openRequests: patch(s.openRequests, id, { [section]: list, dirty: true }) };
    });
  },

  setBodyMode(id, mode) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, mode }, dirty: true }) };
    });
  },
  setBodyJson(id, json) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, json }, dirty: true }) };
    });
  },
  setFormRow(id, row) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = r.body.form.map((x) => (x.id === row.id ? row : x));
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form }, dirty: true }) };
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
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form }, dirty: true }) };
    });
  },
  removeFormRow(id, rowId) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r) return s;
      const form = r.body.form.filter((x) => x.id !== rowId);
      return { openRequests: patch(s.openRequests, id, { body: { ...r.body, form }, dirty: true }) };
    });
  },

  setAuth(id, auth) {
    set((s) => ({ openRequests: patch(s.openRequests, id, { auth, dirty: true }) }));
  },

  setSoapValue(id, next) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r || !r.soap) return s;
      // Editing the form makes it the source of truth again — drop any XML edits.
      return {
        openRequests: patch(s.openRequests, id, {
          soap: { ...r.soap, value: next, xmlDraft: null },
        }),
      };
    });
  },

  setSoapXmlDraft(id, xmlDraft) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r || !r.soap) return s;
      return { openRequests: patch(s.openRequests, id, { soap: { ...r.soap, xmlDraft } }) };
    });
  },

  async commitSoapXml(id) {
    const soap = get().openRequests[id]?.soap;
    if (!soap || soap.xmlDraft === null || soap.schema === null) return null;
    try {
      const value = await api.parseSoapEnvelope({ envelope: soap.xmlDraft, schema: soap.schema });
      get().setSoapValue(id, value); // clears xmlDraft — form is the source again
      return null;
    } catch (e) {
      return String(e); // keep the draft; request stays in raw mode
    }
  },

  setSoapEndpoint(id, endpoint) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r || !r.soap) return s;
      return {
        openRequests: patch(s.openRequests, id, {
          soap: { ...r.soap, meta: { ...r.soap.meta, endpoint } },
        }),
      };
    });
  },

  setSoapVersion(id, soapVersion) {
    set((s) => {
      const r = s.openRequests[id];
      if (!r || !r.soap) return s;
      return {
        openRequests: patch(s.openRequests, id, {
          soap: { ...r.soap, meta: { ...r.soap.meta, soapVersion } },
        }),
      };
    });
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

function fromFile(data: RequestFileData, path: string[]): OpenRequest {
  const method: HttpMethod = (HTTP_METHODS as readonly string[]).includes(data.method ?? "")
    ? (data.method as HttpMethod)
    : "GET";
  return {
    id: data.id,
    name: data.name,
    method,
    url: data.url ?? "",
    activeTab: "params",
    params: data.params ?? [],
    headers: data.headers ?? [],
    // the wire shape omits empty `form` (serde skip_serializing_if) — normalize it
    // here so store consumers never see body.form === undefined
    body: data.body
      ? { ...data.body, form: data.body.form ?? [] }
      : { mode: "json", json: "", form: [] },
    auth: data.auth ?? { type: "none" },
    path,
    dirty: false,
    soap:
      data.kind === "soap"
        ? {
            meta: {
              wsdlUrl: data.wsdlUrl ?? "",
              inputElement: data.inputElement ?? { namespace: "", local: "" },
              endpoint: data.endpoint ?? "",
              soapAction: data.soapAction ?? "",
              soapVersion: data.soapVersion ?? "1.1",
            },
            schema: null,
            value: { sequence: [] },
            xmlDraft: null,
          }
        : undefined,
  };
}

// Close all open tabs when the active workspace changes — tabs belong to the
// workspace they were opened from; keeping them open would save against the wrong workspace.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.activeId !== prev.activeId) useRequestStore.getState().closeAll();
});
