// Preview-only {{var}} resolution for the UI. Rust (domain/env.rs) is the
// authority at Send time; here unknown vars stay literal so typing never
// breaks the preview mid-edit.

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

export function hasPlaceholder(text: string): boolean {
  return /\{\{[^{}]+\}\}/.test(text);
}

export function interpolatePreview(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, raw: string) => {
    const key = raw.trim();
    return key in vars ? vars[key] : match;
  });
}
