import { beforeEach, describe, expect, it, vi } from "vitest";

import { createContact } from "@/actions/contacts";
import { render, screen, waitFor } from "@/test/test-utils";

import { FirstContactForm } from "./first-contact-form";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/actions/contacts", () => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
}));

describe("first contact onboarding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens home only after saving a valid first contact", async () => {
    vi.mocked(createContact).mockResolvedValue({
      success: true,
      data: {
        contact: {
          id: "contact-1",
          name: "Mike",
          phone: "+14155552671",
          speedDial: 1,
        },
        sameNumberAs: null,
      },
    });
    const { user } = render(<FirstContactForm contacts={[]} />);
    expect(
      screen.queryByRole("button", { name: /Cancel|Skip/ })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Save and finish setup" })
    );
    expect(createContact).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Mike");
    await user.type(
      screen.getByRole("textbox", { name: "Phone number" }),
      "+14155552671"
    );
    await user.click(
      screen.getByRole("button", { name: "Save and finish setup" })
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Opening your Bat Phone…"
    );
  });

  it("keeps the contact form available when the save fails", async () => {
    vi.mocked(createContact).mockResolvedValue({
      success: false,
      error: "This speed dial is already taken.",
    });
    const { user } = render(<FirstContactForm contacts={[]} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Mike");
    await user.type(
      screen.getByRole("textbox", { name: "Phone number" }),
      "+14155552671"
    );
    await user.click(
      screen.getByRole("button", { name: "Save and finish setup" })
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This speed dial is already taken."
      )
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });
});
