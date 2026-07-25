import { describe, it, expect } from "vitest";
import { hasPlaceholder, interpolatePreview } from "./interpolate";

describe("interpolatePreview", () => {
  it("replaces known vars and trims whitespace inside braces", () => {
    expect(interpolatePreview("https://{{host}}/x/{{ id }}", { host: "api.dev", id: "42" })).toBe(
      "https://api.dev/x/42",
    );
  });

  it("leaves unknown vars literal (Rust errors at Send, preview never breaks)", () => {
    expect(interpolatePreview("https://{{host}}/x", {})).toBe("https://{{host}}/x");
  });

  it("leaves empty and unclosed braces literal", () => {
    expect(interpolatePreview("a{{}}b{{c", { c: "1" })).toBe("a{{}}b{{c");
  });
});

describe("hasPlaceholder", () => {
  it("detects {{var}} and ignores plain text", () => {
    expect(hasPlaceholder("{{host}}")).toBe(true);
    expect(hasPlaceholder("no vars")).toBe(false);
    expect(hasPlaceholder("{{}}")).toBe(false);
  });
});
