import type { FormValue, SchemaNode } from "../../../lib/api";
import { SchemaNodeField } from "./SchemaNodeField";

interface SchemaFormProps {
  schema: SchemaNode;
  value: FormValue;
  onChange: (next: FormValue) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <SchemaNodeField node={schema} value={value} onChange={onChange} />
    </div>
  );
}
