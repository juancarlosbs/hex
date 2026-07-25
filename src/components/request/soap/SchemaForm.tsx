import type { FormValue, SchemaNode } from "../../../lib/api";
import { SchemaNodeField } from "./SchemaNodeField";

interface SchemaFormProps {
  schema: SchemaNode;
  value: FormValue;
  onChange: (next: FormValue) => void;
  /** Replaces the whole schema tree — used when a recursive (lazyRef) node is
   * expanded on demand. */
  onSchemaChange?: (next: SchemaNode) => void;
  /** Expands one level of a recursive (lazyRef) node (backend call). */
  expandNode?: (node: SchemaNode) => Promise<SchemaNode>;
}

export function SchemaForm({ schema, value, onChange, onSchemaChange, expandNode }: SchemaFormProps) {
  return (
    <div className="flex flex-col w-full">
      <SchemaNodeField
        node={schema}
        value={value}
        onChange={onChange}
        onNodeChange={onSchemaChange}
        expand={expandNode}
        depth={0}
        root
      />
    </div>
  );
}
