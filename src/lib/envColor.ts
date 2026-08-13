const ENV_DOT_CLASS: Record<string, string> = {
  Development: "bg-env-development",
  Staging: "bg-env-staging",
  Production: "bg-env-production",
};

export function envDotClass(name: string): string {
  return ENV_DOT_CLASS[name] ?? "bg-env-neutral";
}
