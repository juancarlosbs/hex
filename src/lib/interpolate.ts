// Preview-only interpolation for the UI (F4). Rust re-interpolates at send and
// is authoritative; unknown vars stay literal here so the preview never hides
// what will fail.
const REF = /\{\{([^{}]*)\}\}/g;

export function previewInterpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(REF, (match, raw: string) => {
    const key = raw.trim();
    if (key === "") return match;
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match;
  });
}

export function hasVarRefs(template: string): boolean {
  return [...template.matchAll(REF)].some((m) => m[1].trim() !== "");
}
