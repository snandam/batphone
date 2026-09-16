import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

vi.mock("@/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants")>()),
  SUPPORT_EMAIL: "",
}));

import TermsPage, { metadata } from "./page";

describe("TermsPage", () => {
  it("renders without a session and covers recording consent", () => {
    render(<TermsPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Terms of service" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Recording consent is your responsibility",
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot reach 911/)).toBeInTheDocument();
  });

  it("falls back to generic wording when no support email is configured", () => {
    render(<TermsPage />);
    expect(screen.queryByRole("link", { name: /@/ })).toBeNull();
    expect(
      screen.getByText("the operator of this deployment")
    ).toBeInTheDocument();
  });

  it("links to the privacy policy", () => {
    render(<TermsPage />);
    expect(
      screen.getByRole("link", { name: "privacy policy" })
    ).toHaveAttribute("href", "/privacy");
  });

  it("sets page metadata", () => {
    expect(metadata.title).toBe("Terms of service");
  });
});
