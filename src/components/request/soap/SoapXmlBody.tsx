import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { api } from "../../../lib/api";
import { useRequestStore } from "../../../store/requestStore";

/** The element name if `line` is a lone start tag (`<a>`, `<ns:Op attr="x">`),
 * else null. Excludes declarations, closing tags, self-closing tags, and
 * one-line `<a>text</a>` pairs. */
function startTagName(line: string): string | null {
  if (!/^<[^/?!]/.test(line)) return null; // closing / <? / <!
  if (/\/>$/.test(line)) return null; // self-closing
  if (/<\/[^>]+>$/.test(line)) return null; // already a one-line pair
  return /^<([^\s/>]+)/.exec(line)?.[1] ?? null;
}

/** Naive pretty-printer for the envelope. ponytail: assumes the well-formed,
 * escaped XML our Rust serializer emits (no comments/CDATA/mixed content) — good
 * enough for seeding the editor. Upgrade to a real formatter if that changes. */
export function formatXml(xml: string): string {
  const PAD = "  ";
  const raw = xml.replace(/>\s*</g, ">\n<").split("\n");
  const out: string[] = [];
  let depth = 0;
  for (let k = 0; k < raw.length; k++) {
    const line = raw[k];
    const name = startTagName(line);
    // Collapse an empty element (`<a></a>`) split across two lines back to one.
    if (name && raw[k + 1] === `</${name}>`) {
      out.push(PAD.repeat(depth) + line + `</${name}>`);
      k++;
      continue;
    }
    if (/^<\/[^>]+>$/.test(line)) depth = Math.max(0, depth - 1);
    out.push(PAD.repeat(depth) + line);
    if (name) depth++;
  }
  return out.join("\n");
}

type TokClass = "tag" | "attr" | "string" | "punct" | "text";
interface Tok {
  text: string;
  cls: TokClass;
}

const TOK_COLOR: Record<TokClass, string> = {
  tag: "var(--color-soap-op)",
  attr: "var(--color-primary)",
  string: "var(--color-status-2xx)",
  punct: "var(--color-muted)",
  text: "var(--color-foreground)",
};

function tokenizeAttrs(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\s+)|([^\s=]+)(?==)|(=)|("[^"]*"|'[^']*')|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) out.push({ text: m[1], cls: "text" });
    else if (m[2]) out.push({ text: m[2], cls: "attr" });
    else if (m[3]) out.push({ text: m[3], cls: "punct" });
    else if (m[4]) out.push({ text: m[4], cls: "string" });
    else out.push({ text: m[5], cls: "text" });
  }
  return out;
}

function tokenizeTag(tag: string): Tok[] {
  const out: Tok[] = [];
  const open = /^<[?!/]?/.exec(tag)![0];
  out.push({ text: open, cls: "punct" });
  let rest = tag.slice(open.length);
  const close = /[?/]?>$/.exec(rest)?.[0] ?? "";
  if (close) rest = rest.slice(0, rest.length - close.length);
  const name = /^\s*([^\s/>]+)/.exec(rest);
  if (name) {
    const lead = name[0].slice(0, name[0].length - name[1].length);
    if (lead) out.push({ text: lead, cls: "text" });
    out.push({ text: name[1], cls: "tag" });
    rest = rest.slice(name[0].length);
  }
  out.push(...tokenizeAttrs(rest));
  if (close) out.push({ text: close, cls: "punct" });
  return out;
}

/** Tokenize XML into colored spans, preserving every character (incl. whitespace)
 * so the highlight layer aligns char-for-char with the textarea. ponytail: no
 * comment/CDATA handling — our envelopes don't use them. */
export function tokenizeXml(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      out.push({ text: src.slice(i), cls: "text" });
      break;
    }
    if (lt > i) out.push({ text: src.slice(i, lt), cls: "text" });
    let j = lt + 1;
    let quote: string | null = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") {
        j++;
        break;
      }
      j++;
    }
    out.push(...tokenizeTag(src.slice(lt, j)));
    i = j;
  }
  return out;
}

function caretPos(el: HTMLTextAreaElement): { line: number; col: number } {
  const upto = el.value.slice(0, el.selectionStart).split("\n");
  return { line: upto.length, col: upto[upto.length - 1].length + 1 };
}

const EDITOR_TEXT = "text-[12px] leading-[20px] px-[12px] py-[14px] whitespace-pre";

export function SoapXmlBody({ requestId }: { requestId: string }) {
  const soap = useRequestStore((s) => s.openRequests[requestId]?.soap);
  const setSoapXmlDraft = useRequestStore((s) => s.setSoapXmlDraft);

  const [generated, setGenerated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState({ line: 1, col: 1 });
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const schema = soap?.schema ?? null;
  const value = soap?.value;
  const draft = soap?.xmlDraft ?? null;
  const soapAction = soap?.meta.soapAction ?? "";
  const soapVersion = soap?.meta.soapVersion ?? "1.1";

  useEffect(() => {
    if (draft !== null || !schema || value === undefined) return;
    let cancelled = false;
    setError(null);
    api
      .buildSoapEnvelope({ schema, soapAction, soapVersion, value })
      .then((out) => !cancelled && setGenerated(formatXml(out)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [draft, schema, value, soapAction, soapVersion]);

  const content = draft ?? generated;
  const tokens = useMemo(() => (content === null ? [] : tokenizeXml(content)), [content]);

  if (error) {
    return <div className="p-3 text-[12px] text-destructive font-mono">{error}</div>;
  }
  if (content === null) {
    return <div className="p-3 text-[12px] text-muted">Building envelope…</div>;
  }

  const lines = content.length === 0 ? 1 : content.split("\n").length;
  const syncPos = () => taRef.current && setPos(caretPos(taRef.current));
  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="shrink-0 overflow-hidden bg-card">
          <div ref={gutterRef} className="flex flex-col items-end pt-[14px] pl-[14px] pr-[10px]">
            {Array.from({ length: lines }, (_, i) => (
              <span
                key={i}
                className={`text-[12px] leading-[20px] ${i + 1 === pos.line ? "text-foreground" : "text-muted"}`}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>

        <div className="relative flex-1 min-w-0">
          <pre
            ref={preRef}
            aria-hidden
            className={`absolute inset-0 m-0 overflow-hidden pointer-events-none ${EDITOR_TEXT}`}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {tokens.map((t, i) => (
              <span key={i} style={{ color: TOK_COLOR[t.cls] }}>
                {t.text}
              </span>
            ))}
          </pre>
          <textarea
            ref={taRef}
            aria-label="SOAP envelope XML"
            value={content}
            wrap="off"
            spellCheck={false}
            onChange={(e) => {
              setSoapXmlDraft(requestId, e.target.value);
              syncPos();
              syncScroll();
            }}
            onScroll={syncScroll}
            onKeyUp={syncPos}
            onClick={syncPos}
            onSelect={syncPos}
            className={`absolute inset-0 resize-none border-0 outline-none overflow-auto bg-transparent text-transparent ${EDITOR_TEXT}`}
            style={{ fontFamily: "var(--font-mono)", caretColor: "var(--color-foreground)" }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-[6px] bg-card border-t border-border shrink-0">
        <div className="flex items-center gap-2 text-[11px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
          <span>SOAP {soapVersion}</span>
          <span className="w-px h-3 bg-border" />
          <span>UTF-8</span>
          <span>LF</span>
        </div>
        <div className="flex items-center gap-[10px]">
          <span className="text-[11px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
            Ln {pos.line}, Col {pos.col}
          </span>
          <span
            className="flex items-center gap-[5px] px-[8px] py-[3px] rounded-[4px]"
            style={{ background: "var(--color-soap-op-surface)" }}
          >
            <Pencil size={11} style={{ color: "var(--color-soap-op)" }} />
            <span className="text-[10px] font-semibold" style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-sans)" }}>
              Editable
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
