import { describe, expect, it } from "vitest";

import { render, screen } from "@/test/test-utils";

import { Footer } from "./footer";

describe("Footer", () => {
  it("links to the public privacy and terms pages", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Legal" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy"
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms"
    );
  });
});
