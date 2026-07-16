export type ResponseTab = "body" | "headers" | "timing";
export type ResponseBodyView = "tree" | "raw";

export interface HttpResponse {
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
}

export function statusColorClass(status: number): string {
  if (status < 300) return "text-status-2xx";
  if (status < 400) return "text-status-3xx";
  if (status < 500) return "text-status-4xx";
  return "text-status-5xx";
}

export function statusBgClass(status: number): string {
  if (status < 300) return "bg-status-2xx";
  if (status < 400) return "bg-status-3xx";
  if (status < 500) return "bg-status-4xx";
  return "bg-status-5xx";
}
