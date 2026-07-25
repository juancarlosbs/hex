// Thin typed wrappers over the generated bindings (src/bindings.ts, tauri-specta).
// Components never call invoke directly — and never import bindings directly either.
import { commands, type Result } from "../bindings";
import type {
  FormValue,
  QName,
  RequestContent,
  RequestKind,
  SchemaNode,
  SendSpec,
  WsdlImportPreview,
} from "../bindings";

// Re-export the generated types under the names the app already uses.
export type {
  Attribute,
  CollectionNode,
  FormValue,
  HttpResponse,
  MaxOccurs,
  NodeKind,
  Occurs,
  RequestContent,
  RequestKind,
  SchemaNode,
  SendSpec,
  WsdlImportPreview,
  XsdType,
} from "../bindings";
export type {
  QName as WsdlQName,
  OperationRef as WsdlOperation,
  RequestFile as RequestFileData,
} from "../bindings";

/** invoke() rejects with the raw error string — keep that contract for callers. */
async function unwrap<T>(result: Promise<Result<T, string>>): Promise<T> {
  const r = await result;
  if (r.status === "error") throw r.error;
  return r.data;
}

export const api = {
  listCollections: (workspaceId: string) => unwrap(commands.listCollections(workspaceId)),

  createCollection: (workspaceId: string, name: string) =>
    unwrap(commands.createCollection(workspaceId, name)),

  createFolder: (workspaceId: string, parentPath: string[], name: string) =>
    unwrap(commands.createFolder(workspaceId, parentPath, name)),

  createRequest: (workspaceId: string, parentPath: string[], name: string, kind: RequestKind) =>
    unwrap(commands.createRequest(workspaceId, parentPath, name, kind)),

  renameNode: (workspaceId: string, path: string[], name: string) =>
    unwrap(commands.renameNode(workspaceId, path, name)),

  deleteNode: (workspaceId: string, path: string[]) =>
    unwrap(commands.deleteNode(workspaceId, path)),

  reorderChildren: (workspaceId: string, parentPath: string[], orderedIds: string[]) =>
    unwrap(commands.reorderChildren(workspaceId, parentPath, orderedIds)),

  getRequest: (workspaceId: string, path: string[]) =>
    unwrap(commands.getRequest(workspaceId, path)),

  updateRequest: (workspaceId: string, path: string[], content: RequestContent) =>
    unwrap(commands.updateRequest(workspaceId, path, content)),

  sendRequest: (spec: SendSpec) => unwrap(commands.sendRequest(spec)),

  importWsdl: (url: string) => unwrap(commands.importWsdl(url)),

  confirmWsdlImport: (workspaceId: string, preview: WsdlImportPreview) =>
    unwrap(commands.confirmWsdlImport(workspaceId, preview)),

  getOperationSchema: (wsdlUrl: string, inputElement: QName) =>
    unwrap(commands.getOperationSchema(wsdlUrl, inputElement)),

  /** Expand one level of a recursive (lazyRef) schema node on demand. */
  expandSchemaNode: (wsdlUrl: string, node: SchemaNode) =>
    unwrap(commands.expandSchemaNode(wsdlUrl, node)),

  sendSoap: (spec: {
    schema: SchemaNode;
    endpoint: string;
    soapAction: string;
    soapVersion: string;
    value: FormValue;
  }) =>
    unwrap(
      commands.sendSoap(spec.schema, spec.endpoint, spec.soapAction, spec.soapVersion, spec.value),
    ),

  buildSoapEnvelope: (spec: {
    schema: SchemaNode;
    soapAction: string;
    soapVersion: string;
    value: FormValue;
  }) =>
    unwrap(
      commands.buildSoapEnvelope(spec.schema, spec.soapAction, spec.soapVersion, spec.value),
    ),

  sendSoapRaw: (spec: {
    endpoint: string;
    envelope: string;
    soapAction: string;
    soapVersion: string;
  }) =>
    unwrap(commands.sendSoapRaw(spec.endpoint, spec.envelope, spec.soapAction, spec.soapVersion)),

  parseSoapEnvelope: (spec: { envelope: string; schema: SchemaNode }) =>
    unwrap(commands.parseEnvelope(spec.envelope, spec.schema)),
};
