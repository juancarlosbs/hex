// ponytail: plain <textarea> for now. Upgrade path: swap for @uiw/react-codemirror
// with lang-json when the polish milestone lands.

interface BodyJsonEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function BodyJsonEditor({ value, onChange }: BodyJsonEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      placeholder={'{\n  "key": "value"\n}'}
      className="w-full h-full min-h-[240px] resize-none bg-background text-foreground p-3 text-[12px] outline-none border-0 placeholder:text-muted"
      style={{ fontFamily: "var(--font-mono)" }}
    />
  );
}
