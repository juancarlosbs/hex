import { invoke } from "@tauri-apps/api/core";
import { KeyValue, RestBody, AuthConfig } from "./request-types";
import { HttpResponse } from "./response-types";

export interface WsdlQName {
  namespace: string;
  local: string;
}

export type RequestKind =
  | { kind: "rest"; method: string; url: string }
  | {
      kind: "soap";
      wsdlUrl: string;
      operation: string;
      endpoint?: string;
      soapAction?: string;
      soapVersion?: "1.1" | "1.2";
      inputElement?: WsdlQName;
    };

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

export interface SendSpec {
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
  wsdlUrl?: string;
  operation?: string;
  endpoint?: string;
  soapAction?: string;
  soapVersion?: "1.1" | "1.2";
  inputElement?: WsdlQName;
}

export interface WsdlOperation {
  name: string;
  endpoint: string;
  soapAction: string;
  soapVersion: "1.1" | "1.2";
  inputElement: WsdlQName;
}

export interface WsdlImportPreview {
  serviceName: string;
  wsdlUrl: string;
  operations: WsdlOperation[];
}

export type MaxOccurs = { bounded: number } | "unbounded";
export interface Occurs {
  min: number;
  max: MaxOccurs;
}
export type XsdType =
  | "string"
  | "boolean"
  | "integer"
  | "decimal"
  | "double"
  | "date"
  | "dateTime"
  | "time"
  | "gYearMonth"
  | "base64Binary"
  | { other: string };
export interface Attribute {
  name: string;
  xsdType: XsdType;
  required: boolean;
  enumValues: string[];
  default: string | null;
}
export type NodeKind =
  | { leaf: { xsdType: XsdType; enumValues: string[]; default: string | null; fixed: string | null } }
  | { sequence: SchemaNode[] }
  | { choice: SchemaNode[] }
  | "any";
export interface SchemaNode {
  name: string;
  namespace: string | null;
  occurs: Occurs;
  nillable: boolean;
  doc: string | null;
  attributes: Attribute[];
  kind: NodeKind;
}
export type FormValue =
  | { leaf: string | null }
  | { sequence: FormValue[] }
  | { choice: { branch: number; value: FormValue } }
  | { repeated: FormValue[] }
  | "nil"
  | "omitted"
  | { raw: string };

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

  sendRequest: (spec: SendSpec) =>
    invoke<HttpResponse>("send_request", { spec }),

  importWsdl: (url: string) =>
    invoke<WsdlImportPreview>("import_wsdl", { url }),

  confirmWsdlImport: (workspaceId: string, preview: WsdlImportPreview) =>
    invoke<void>("confirm_wsdl_import", { workspaceId, preview }),

  getOperationSchema: (wsdlUrl: string, inputElement: WsdlQName) =>
    invoke<SchemaNode>("get_operation_schema", { wsdlUrl, inputElement }),

  sendSoap: (spec: {
    wsdlUrl: string;
    inputElement: WsdlQName;
    endpoint: string;
    soapAction: string;
    soapVersion: string;
    value: FormValue;
  }) => invoke<HttpResponse>("send_soap", spec),
};
