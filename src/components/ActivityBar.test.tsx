import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

describe("ActivityBar", () => {
  it("renders the four rail buttons", () => {
    render(<ActivityBar collectionsActive={false} onToggleCollections={() => {}} />);
    for (const label of ["Collections", "Environments", "History", "More"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("toggles collections on click", () => {
    const onToggle = vi.fn();
    render(<ActivityBar collectionsActive={false} onToggleCollections={onToggle} />);
    fireEvent.click(screen.getByLabelText("Collections"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("marks the collections button active", () => {
    render(<ActivityBar collectionsActive={true} onToggleCollections={() => {}} />);
    expect(screen.getByLabelText("Collections").className).toContain("bg-secondary");
  });
});
