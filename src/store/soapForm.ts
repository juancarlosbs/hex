// Pure SOAP form-value defaults + immutable leaf updates. No I/O, no store imports.
import type { FormValue, SchemaNode } from "../lib/api";

function isRepeatable(node: SchemaNode): boolean {
  const { max } = node.occurs;
  return max === "unbounded" || max.bounded > 1;
}

/** Builds the default FormValue tree for a SchemaNode.
 * Cardinality (optional/repeatable) is checked before the node's kind: an
 * optional node is "omitted" regardless of what it contains, and a
 * repeatable node starts as an empty `repeated` list regardless of its
 * element kind.
 */
export function defaultFormValue(node: SchemaNode): FormValue {
  if (node.occurs.min === 0) return "omitted";
  if (isRepeatable(node)) return { repeated: [] };

  if (node.kind === "any") return { raw: "" };
  if ("leaf" in node.kind) {
    const { default: def, fixed } = node.kind.leaf;
    return { leaf: fixed ?? def ?? "" };
  }
  if ("sequence" in node.kind) {
    return { sequence: node.kind.sequence.map(defaultFormValue) };
  }
  // choice
  return { choice: { branch: 0, value: defaultFormValue(node.kind.choice[0]) } };
}

/** Immutably sets the leaf text at `path`, descending through sequence
 * children / the active choice value. */
export function setLeafAt(root: FormValue, path: number[], text: string | null): FormValue {
  if (path.length === 0) {
    return { leaf: text };
  }
  const [index, ...rest] = path;
  if (typeof root === "object" && root !== null && "sequence" in root) {
    const sequence = root.sequence.map((child, i) =>
      i === index ? setLeafAt(child, rest, text) : child
    );
    return { sequence };
  }
  if (typeof root === "object" && root !== null && "choice" in root) {
    return { choice: { ...root.choice, value: setLeafAt(root.choice.value, path, text) } };
  }
  return root;
}
