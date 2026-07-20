import { ResponseBodyView as ViewMode } from "../../../lib/response-types";
import { JsonTree } from "./JsonTree";
import { XmlTree } from "./XmlTree";

interface ResponseBodyViewProps {
  view: ViewMode;
  body: string;
}

export function ResponseBodyView({ view, body }: ResponseBodyViewProps) {
  if (view === "raw") {
    return (
      <textarea
        readOnly
        value={body}
        className="w-full h-full resize-none bg-background text-foreground p-3 text-[12px] outline-none border-0"
        style={{ fontFamily: "var(--font-mono)" }}
      />
    );
  }

  if (body.trim().startsWith("<")) {
    return <XmlTree xml={body} />;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return (
      <textarea
        readOnly
        value={body}
        className="w-full h-full resize-none bg-background text-foreground p-3 text-[12px] outline-none border-0"
        style={{ fontFamily: "var(--font-mono)" }}
      />
    );
  }

  return <JsonTree value={parsed} />;
}
