export type ResponseTab = "body" | "headers" | "timing";
export type ResponseBodyView = "tree" | "raw";

export interface TimingBreakdown {
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number;
  downloadMs: number;
  totalMs: number;
}

export interface SoapFault {
  code: string;
  reason: string;
  detail: string | null;
  actor: string | null;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  timing: TimingBreakdown;
  fault?: SoapFault | null;
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
