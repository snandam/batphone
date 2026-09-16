import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createContact, updateContact } from "@/actions/contacts";
import { render, screen, waitFor } from "@/test/test-utils";

import { ContactForm } from "./contact-form";

vi.mock("@/actions/contacts", () => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
}));
const contacts = [
  { id: "alice", name: "Alice", phone: "+14155552671", speedDial: 1 },
  { id: "bob", name: "Bob", phone: "+16045551234", speedDial: 2 },
];
function hasCode(select: HTMLElement, code: number) {
  return select.querySelector(`option[value="${code}"]`) !== null;
}

describe("available speed dials", () => {
  it("hides occupied codes and offers the lowest free code as automatic", () => {
    const { rerender } = render(
      <ContactForm contacts={contacts} onSaved={vi.fn()} />
    );
    const select = screen.getByRole("combobox", { name: "Speed dial" });
    expect(hasCode(select, 1)).toBe(false);
    expect(hasCode(select, 2)).toBe(false);
    expect(hasCode(select, 3)).toBe(true);
    expect(hasCode(select, 12)).toBe(true);
    expect(hasCode(select, 13)).toBe(false);
    expect(select.querySelectorAll("option")).toHaveLength(12);
    expect(select).toHaveValue("");
    expect(select.querySelector('option[value=""]')).toHaveTextContent(
      "Automatic (3)"
    );
    // Removing a contact immediately makes its code available again.
    rerender(<ContactForm contacts={[contacts[1]!]} onSaved={vi.fn()} />);
    expect(hasCode(select, 1)).toBe(true);
    expect(hasCode(select, 2)).toBe(false);
    expect(select.querySelector('option[value=""]')).toHaveTextContent(
      "Automatic (1)"
    );
  });

  it("retains the edited contact’s code and submits a newly chosen free code", async () => {
    vi.mocked(updateContact).mockResolvedValue({
      success: true,
      data: { contact: { ...contacts[0]!, speedDial: 3 }, sameNumberAs: null },
    });
    const onSaved = vi.fn();
    render(
      <ContactForm
        contacts={contacts}
        contact={contacts[0]}
        onSaved={onSaved}
      />
    );
    const select = screen.getByRole("combobox", { name: "Speed dial" });
    expect(select).toHaveValue("1");
    expect(hasCode(select, 1)).toBe(true);
    expect(hasCode(select, 2)).toBe(false);
    fireEvent.change(select, { target: { value: "3" } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit Alice" }));
    await waitFor(() =>
      expect(updateContact).toHaveBeenCalledWith({
        id: "alice",
        name: "Alice",
        phone: "+14155552671",
        speedDial: "3",
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("keeps automatic allocation on the server rather than submitting a potentially stale suggestion", async () => {
    vi.mocked(createContact).mockResolvedValue({
      success: true,
      data: {
        sameNumberAs: null,
        contact: {
          id: "new",
          name: "Carol",
          phone: "+14155552672",
          speedDial: 3,
        },
      },
    });
    render(<ContactForm contacts={contacts} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Carol" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), {
      target: { value: "+14155552672" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Add contact" }));
    await waitFor(() =>
      expect(createContact).toHaveBeenCalledWith({
        name: "Carol",
        phone: "+14155552672",
        speedDial: "",
      })
    );
  });
  it("keeps a current code outside the suggested range available when editing", () => {
    const contact = { ...contacts[0]!, speedDial: 8888 };
    render(
      <ContactForm
        contacts={[contact, contacts[1]!]}
        contact={contact}
        onSaved={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox", { name: "Speed dial" });
    expect(select).toHaveValue("8888");
    expect(hasCode(select, 8888)).toBe(true);
    expect(select.querySelectorAll("option")).toHaveLength(12);
  });

  it("accepts a specific available number outside the suggestions", async () => {
    vi.mocked(updateContact).mockResolvedValue({
      success: true,
      data: {
        contact: { ...contacts[0]!, speedDial: 9999 },
        sameNumberAs: null,
      },
    });
    render(
      <ContactForm
        contacts={contacts}
        contact={contacts[0]}
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Speed dial" }), {
      target: { value: "custom" },
    });
    const input = screen.getByRole("spinbutton", {
      name: "Specific speed dial",
    });
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "9999");
    expect(input).toHaveAttribute("step", "1");
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit Alice" }));
    await waitFor(() =>
      expect(updateContact).toHaveBeenCalledWith({
        id: "alice",
        name: "Alice",
        phone: "+14155552671",
        speedDial: "9999",
      })
    );
  });

  it.each(["2", "0", "10000", "1.5", ""])(
    "blocks invalid or occupied custom number %s",
    (value) => {
      vi.mocked(updateContact).mockClear();
      render(
        <ContactForm
          contacts={contacts}
          contact={contacts[0]}
          onSaved={vi.fn()}
        />
      );
      fireEvent.change(screen.getByRole("combobox", { name: "Speed dial" }), {
        target: { value: "custom" },
      });
      const input = screen.getByRole("spinbutton", {
        name: "Specific speed dial",
      });
      fireEvent.change(input, { target: { value } });
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      if (value === "2") {
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(
          screen.getByText(
            "This speed dial is already taken. Choose another number."
          )
        ).toHaveAttribute("role", "alert");
      }
      fireEvent.submit(screen.getByRole("form", { name: "Edit Alice" }));
      expect(updateContact).not.toHaveBeenCalled();
      // Returning to a suggestion removes custom validation and its submitted value.
      fireEvent.change(screen.getByRole("combobox", { name: "Speed dial" }), {
        target: { value: "3" },
      });
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    }
  );
});
