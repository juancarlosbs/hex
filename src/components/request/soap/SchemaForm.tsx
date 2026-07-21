import type { FormValue, SchemaNode } from "../../../lib/api";
import { SchemaNodeField } from "./SchemaNodeField";

interface SchemaFormProps {
  schema: SchemaNode;
  value: FormValue;
  onChange: (next: FormValue) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  return (
    <div className="flex flex-col w-full">
      <SchemaNodeField node={schema} value={value} onChange={onChange} depth={0} root />
    </div>
  );
}
