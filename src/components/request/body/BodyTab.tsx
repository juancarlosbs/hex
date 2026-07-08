import { Plus, WandSparkles } from "lucide-react";
import { ContentTypeDropdown } from "../ContentTypeDropdown";
import { BodyJsonEditor } from "./BodyJsonEditor";
import { BodyFormEditor } from "./BodyFormEditor";
import { useRequestStore } from "../../../store/requestStore";

interface BodyTabProps {
  requestId: string;
}

export function BodyTab({ requestId }: BodyTabProps) {
  const body = useRequestStore((s) => s.openRequests[requestId]?.body);
  const setBodyMode = useRequestStore((s) => s.setBodyMode);
  const setBodyJson = useRequestStore((s) => s.setBodyJson);
  const addFormRow = useRequestStore((s) => s.addFormRow);

  if (!body) return null;

  const isForm = body.mode !== "json";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <ContentTypeDropdown mode={body.mode} onChange={(m) => setBodyMode(requestId, m)} />
        <div className="flex-1" />
        {isForm ? (
          <Plus
            size={14}
            className="text-muted cursor-pointer hover:text-foreground"
            onClick={() => addFormRow(requestId)}
            aria-label="Add row"
          />
        ) : (
          <WandSparkles
            size={14}
            className="text-muted cursor-pointer hover:text-foreground"
            onClick={() => setBodyJson(requestId, tryPrettyJson(body.json))}
            aria-label="Beautify"
          />
        )}
      </div>

      <div className="flex-1 min-h-0">
        {body.mode === "json" && <BodyJsonEditor value={body.json} onChange={(v) => setBodyJson(requestId, v)} />}
        {body.mode === "form-urlencoded" && <BodyFormEditor requestId={requestId} multipart={false} />}
        {body.mode === "form-multipart" && <BodyFormEditor requestId={requestId} multipart={true} />}
      </div>
    </div>
  );
}

function tryPrettyJson(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}
