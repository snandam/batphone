import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@/test/test-utils";

import { ContactList } from "./contact-list";

vi.mock("@/actions/contacts", () => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));

const contacts = [
  { id: "alice", name: "Alice Chen", phone: "+14155552671", speedDial: 1 },
  { id: "bob", name: "Bob Smith", phone: "+16045551234", speedDial: 42 },
];

describe("ContactList search", () => {
  it("finds names, formatted phone numbers and speed dials, and clears an empty result", async () => {
    const { user } = render(<ContactList initial={contacts} />);
    const search = screen.getByRole("searchbox", { name: "Search contacts" });
    await user.type(search, "ALICE");
    expect(screen.getAllByText("Alice Chen")).toHaveLength(2);
    expect(screen.queryByText("Bob Smith")).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "604-555-1234");
    expect(screen.getAllByText("Bob Smith")).toHaveLength(2);
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "42");
    expect(screen.getAllByText("Bob Smith")).toHaveLength(2);
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "Nobody");
    expect(
      screen.getByRole("heading", { name: "No matching contacts" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getAllByText("Alice Chen")).toHaveLength(2);
    expect(screen.getAllByText("Bob Smith")).toHaveLength(2);
  });
});
