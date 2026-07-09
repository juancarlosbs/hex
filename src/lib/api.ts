import { invoke } from "@tauri-apps/api/core";
import { KeyValue, RestBody, AuthConfig } from "./request-types";

export type RequestKind =
  | { kind: "rest"; method: string; url: string }
  | { kind: "soap"; wsdlUrl: string; operation: string };

export type CollectionNode =
  | { type: "folder"; id: string; name: string; children: CollectionNode[] }
  | ({ type: "request"; id: string; name: string } & RequestKind);

export interface RequestContent {
  kind: "rest";
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RestBody;
  auth: AuthConfig;
}

export interface RequestFileData {
  id: string;
  name: string;
  kind: "rest" | "soap";
  method?: string;
  url?: string;
  params?: KeyValue[];
  headers?: KeyValue[];
  body?: RestBody;
  auth?: AuthConfig;
}

export const api = {
  listCollections: (workspaceId: string) =>
    invoke<CollectionNode[]>("list_collections", { workspaceId }),

  createCollection: (workspaceId: string, name: string) =>
    invoke<CollectionNode>("create_collection", { workspaceId, name }),

  createFolder: (workspaceId: string, parentPath: string[], name: string) =>
    invoke<CollectionNode>("create_folder", { workspaceId, parentPath, name }),

  createRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) =>
    invoke<CollectionNode>("create_request", { workspaceId, parentPath, name, kind }),

  renameNode: (workspaceId: string, path: string[], name: string) =>
    invoke<void>("rename_node", { workspaceId, path, name }),

  deleteNode: (workspaceId: string, path: string[]) =>
    invoke<void>("delete_node", { workspaceId, path }),

  reorderChildren: (workspaceId: string, parentPath: string[], orderedIds: string[]) =>
    invoke<void>("reorder_children", { workspaceId, parentPath, orderedIds }),

  getRequest: (workspaceId: string, path: string[]) =>
    invoke<RequestFileData>("get_request", { workspaceId, path }),

  updateRequest: (workspaceId: string, path: string[], content: RequestContent) =>
    invoke<void>("update_request", { workspaceId, path, content }),
};
