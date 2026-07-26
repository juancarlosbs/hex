import { describe, expect, it } from "vitest";
import { hasVarRefs, previewInterpolate } from "./interpolate";

describe("previewInterpolate", () => {
  it("replaces known vars", () => {
    expect(previewInterpolate("https://{{host}}/x", { host: "api.dev" })).toBe(
      "https://api.dev/x",
    );
  });
  it("trims whitespace inside braces", () => {
    expect(previewInterpolate("{{ host }}", { host: "a" })).toBe("a");
  });
  it("leaves unknown vars literal", () => {
    expect(previewInterpolate("{{nope}}", {})).toBe("{{nope}}");
  });
  it("leaves empty braces literal", () => {
    expect(previewInterpolate("a{{}}b", {})).toBe("a{{}}b");
  });
});

describe("hasVarRefs", () => {
  it("detects a reference", () => expect(hasVarRefs("x{{a}}")).toBe(true));
  it("ignores empty braces", () => expect(hasVarRefs("x{{}}y")).toBe(false));
  it("ignores plain text", () => expect(hasVarRefs("plain")).toBe(false));
});
