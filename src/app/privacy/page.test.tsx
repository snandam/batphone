import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

vi.mock("@/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants")>()),
  SUPPORT_EMAIL: "support@example.com",
}));

import PrivacyPage, { metadata } from "./page";

describe("PrivacyPage", () => {
  it("renders without a session and names the data it covers", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy policy" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What we collect" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Who we share it with" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  it("links the configured support address for deletion requests", () => {
    render(<PrivacyPage />);
    const links = screen.getAllByRole("link", { name: "support@example.com" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "mailto:support@example.com");
    }
  });

  it("links to the terms of service", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("link", { name: "terms of service" })
    ).toHaveAttribute("href", "/terms");
  });

  it("sets page metadata", () => {
    expect(metadata.title).toBe("Privacy policy");
  });
});
