import { invoke } from "@tauri-apps/api/core";

export type RequestKind =
  | { kind: "rest"; method: string; url: string }
  | { kind: "soap"; wsdlUrl: string; operation: string };

export type CollectionNode =
  | { type: "folder"; id: string; name: string; children: CollectionNode[] }
  | ({ type: "request"; id: string; name: string } & RequestKind);

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
};
