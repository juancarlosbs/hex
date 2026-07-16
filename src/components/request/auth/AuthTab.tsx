import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, KeyRound, LockOpen } from "lucide-react";
import { AuthConfig, AuthType } from "../../../lib/request-types";
import { useRequestStore } from "../../../store/requestStore";

const AUTH_LABELS: Record<AuthType, string> = {
  none: "No Auth",
  basic: "Basic Auth",
  bearer: "Bearer Token",
  apikey: "API Key",
};

interface AuthTabProps {
  requestId: string;
}

export function AuthTab({ requestId }: AuthTabProps) {
  const auth = useRequestStore((s) => s.openRequests[requestId]?.auth);
  const setAuth = useRequestStore((s) => s.setAuth);
  if (!auth) return null;

  const change = (t: AuthType) => setAuth(requestId, defaultForType(t));

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-[10px] font-semibold tracking-[0.6px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
          AUTH TYPE
        </span>
        <div className="flex-1" />
        <AuthTypeSelector value={auth.type} onChange={change} />
      </div>

      {auth.type === "none" && <NoneBody />}
      {auth.type === "basic" && (
        <BasicBody
          auth={auth}
          onChange={(next) => setAuth(requestId, next)}
        />
      )}
      {auth.type === "bearer" && (
        <BearerBody
          auth={auth}
          onChange={(next) => setAuth(requestId, next)}
        />
      )}
      {auth.type === "apikey" && (
        <ApiKeyBody
          auth={auth}
          onChange={(next) => setAuth(requestId, next)}
        />
      )}
    </div>
  );
}

function defaultForType(t: AuthType): AuthConfig {
  switch (t) {
    case "none":   return { type: "none" };
    case "basic":  return { type: "basic", username: "", password: "" };
    case "bearer": return { type: "bearer", token: "" };
    case "apikey": return { type: "apikey", key: "", value: "", addTo: "header" };
  }
}

function AuthTypeSelector({ value, onChange }: { value: AuthType; onChange: (t: AuthType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-card border border-border cursor-pointer hover:bg-secondary"
      >
        <KeyRound size={13} className="text-muted" />
        <span className="text-[12px] font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
          {AUTH_LABELS[value]}
        </span>
        {open ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>
      {open && (
        <ul className="absolute right-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-[6px] bg-card border border-border shadow-lg p-1">
          {(Object.keys(AUTH_LABELS) as AuthType[]).map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => { onChange(t); setOpen(false); }}
                className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                  t === value ? "bg-secondary" : "hover:bg-secondary"
                }`}
              >
                <span className="text-[12px] text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                  {AUTH_LABELS[t]}
                </span>
                {t === value && <Check size={12} className="text-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoneBody() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8">
      <LockOpen size={20} className="text-muted" />
      <span className="text-[12px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
        This request does not use any authentication.
      </span>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  masked?: boolean;
}

function Field({ label, value, placeholder, onChange, masked }: FieldProps) {
  const [visible, setVisible] = useState(!masked);
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      <label
        className="w-[140px] text-[12px] font-medium text-muted"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {label}
      </label>
      <div className="flex-1 min-w-0 flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-background border border-border">
        <input
          type={masked && !visible ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        {masked && (
          <button type="button" onClick={() => setVisible((v) => !v)} className="cursor-pointer text-muted" aria-label="Toggle visibility">
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

function BasicBody(props: { auth: Extract<AuthConfig, { type: "basic" }>; onChange: (a: AuthConfig) => void }) {
  const { auth, onChange } = props;
  return (
    <>
      <Field label="Username" value={auth.username} onChange={(v) => onChange({ ...auth, username: v })} />
      <Field label="Password" value={auth.password} onChange={(v) => onChange({ ...auth, password: v })} masked />
    </>
  );
}

function BearerBody(props: { auth: Extract<AuthConfig, { type: "bearer" }>; onChange: (a: AuthConfig) => void }) {
  const { auth, onChange } = props;
  return (
    <>
      <Field label="Token" value={auth.token} onChange={(v) => onChange({ ...auth, token: v })} masked />
      <div className="flex items-center gap-2 px-4 py-[10px] text-muted">
        <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>
          → Authorization: Bearer {auth.token ? `${auth.token.slice(0, 12)}…` : "<token>"}
        </span>
      </div>
    </>
  );
}

function ApiKeyBody(props: { auth: Extract<AuthConfig, { type: "apikey" }>; onChange: (a: AuthConfig) => void }) {
  const { auth, onChange } = props;
  return (
    <>
      <Field label="Key" value={auth.key} onChange={(v) => onChange({ ...auth, key: v })} placeholder="X-API-Key" />
      <Field label="Value" value={auth.value} onChange={(v) => onChange({ ...auth, value: v })} masked />
      <div className="flex items-center gap-3 px-4 py-3">
        <label className="w-[140px] text-[12px] font-medium text-muted" style={{ fontFamily: "var(--font-sans)" }}>Add to</label>
        <div className="inline-flex items-center gap-[2px] p-[2px] rounded-[6px] bg-card border border-border">
          {(["header", "query"] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => onChange({ ...auth, addTo: loc })}
              className={`px-3 py-1 rounded-[4px] cursor-pointer text-[11px] font-semibold ${
                auth.addTo === loc ? "bg-secondary text-foreground" : "text-muted"
              }`}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {loc === "header" ? "Header" : "Query"}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
