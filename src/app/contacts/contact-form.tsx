"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createContact,
  updateContact,
  type ContactSummary,
  type SavedContact,
} from "@/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidSpeedDial, MAX_SPEED_DIAL } from "@/lib/batphone/speed-dial";

interface FormState {
  message: string;
  success: boolean;
}

const EMPTY: FormState = { message: "", success: false };

/**
 * Wording for the line under the form after a save. Names the other contact
 * that already has the number so a household line or front desk is saved
 * knowingly (R27).
 */
export function savedMessage(saved: SavedContact, verb: string): string {
  const base = `${verb} ${saved.contact.name} with speed dial ${saved.contact.speedDial}.`;
  return saved.sameNumberAs
    ? `${base} Same number as ${saved.sameNumberAs}.`
    : base;
}

export function Feedback({ state }: { state: FormState }) {
  return (
    <p
      role="alert"
      className={`text-sm ${state.message ? "" : "invisible"} ${state.success ? "text-foreground" : "text-destructive"}`}
    >
      {state.message || " "}
    </p>
  );
}

interface ContactFormProps {
  showHeading?: boolean;
  contacts: ContactSummary[];
  /** When set the form edits this contact; otherwise it adds a new one. */
  contact?: ContactSummary;
  onSaved: (saved: SavedContact) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

/**
 * The same form adds a contact or edits one, with a native selector that
 * excludes codes assigned to other contacts.
 * An empty speed dial on add means the next free code is assigned.
 */
export function ContactForm({
  showHeading = true,
  contacts,
  contact,
  onSaved,
  onCancel,
  submitLabel,
}: ContactFormProps) {
  const editing = contact !== undefined;
  const idPrefix = editing ? `contact-${contact.id}` : "contact-new";
  const [selection, setSelection] = useState(String(contact?.speedDial ?? ""));
  const [customCode, setCustomCode] = useState("");
  const takenCodes = useMemo(
    () =>
      new Set(
        contacts
          .filter((item) => item.id !== contact?.id)
          .map((item) => item.speedDial)
      ),
    [contacts, contact?.id]
  );
  const availableCodes = useMemo(() => {
    const codes: number[] = [];
    for (let code = 1; code <= MAX_SPEED_DIAL && codes.length < 10; code++) {
      if (!takenCodes.has(code)) codes.push(code);
    }
    return codes;
  }, [takenCodes]);
  const suggestedCodes =
    contact && !availableCodes.includes(contact.speedDial)
      ? [...availableCodes, contact.speedDial].sort((a, b) => a - b)
      : availableCodes;
  const noCodesAvailable = availableCodes.length === 0;
  const custom = selection === "custom";
  const speedDial = custom ? customCode : selection;
  const speedDialError =
    speedDial !== "" && !isValidSpeedDial(Number(speedDial))
      ? `Enter a whole number from 1 to ${MAX_SPEED_DIAL}.`
      : speedDial !== "" && takenCodes.has(Number(speedDial))
        ? "This speed dial is already taken. Choose another number."
        : "";
  const invalidSpeedDial =
    Boolean(speedDialError) || (custom && customCode === "");

  const [state, formAction, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      if (invalidSpeedDial || noCodesAvailable) {
        return {
          message: speedDialError || "Choose an available speed dial.",
          success: false,
        };
      }
      const input = {
        name: String(formData.get("name") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        speedDial: String(formData.get("speedDial") ?? ""),
      };
      const result = editing
        ? await updateContact({ id: contact.id, ...input })
        : await createContact(input);
      if (!result.success) {
        return { message: result.error, success: false };
      }
      onSaved(result.data);
      return {
        message: savedMessage(result.data, editing ? "Saved" : "Added"),
        success: true,
      };
    },
    EMPTY
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (invalidSpeedDial || noCodesAvailable) event.preventDefault();
      }}
      className="bg-card space-y-4 rounded-xl border p-4 sm:p-6"
      aria-label={editing ? `Edit ${contact.name}` : "Add contact"}
    >
      <div>
        {showHeading && (
          <h2 className="text-lg font-semibold sm:text-xl">
            {editing ? "Edit contact" : "Add contact"}
          </h2>
        )}
        <p className="text-muted-foreground mt-1 text-sm">
          Use the name you will say on a call.
          {!editing &&
            " Choose a free speed dial or let us assign one automatically."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex-1 space-y-1.5">
          <label
            htmlFor={`${idPrefix}-name`}
            className="block text-sm font-medium"
          >
            Name
          </label>
          <Input
            id={`${idPrefix}-name`}
            name="name"
            type="text"
            autoComplete="off"
            placeholder="Mike Anderson"
            defaultValue={contact?.name ?? ""}
            maxLength={100}
            className="h-11"
            required
            autoFocus
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <label
            htmlFor={`${idPrefix}-phone`}
            className="block text-sm font-medium"
          >
            Phone number
          </label>
          <Input
            id={`${idPrefix}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+1 415 555 2671"
            defaultValue={contact?.phone ?? ""}
            maxLength={32}
            className="h-11"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={`${idPrefix}-speed-dial`}
            className="block text-sm font-medium"
          >
            Speed dial
          </label>
          <select
            id={`${idPrefix}-speed-dial`}
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
            disabled={pending || noCodesAvailable}
            aria-describedby={`${idPrefix}-speed-dial-help`}
            className="bg-card border-input focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full cursor-pointer rounded-md border px-3 text-base tabular-nums shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs md:text-sm"
          >
            {!editing && (
              <option value="">
                {noCodesAvailable
                  ? "No speed dials available"
                  : `Automatic (${availableCodes[0]})`}
              </option>
            )}
            {suggestedCodes.map((code) => (
              <option key={code} value={code}>
                {code}
                {code === contact?.speedDial ? " (current)" : ""}
              </option>
            ))}
            {!noCodesAvailable && (
              <option value="custom">Choose a specific number…</option>
            )}
          </select>
          <input type="hidden" name="speedDial" value={speedDial} />
          {custom && (
            <div className="space-y-1.5 pt-2">
              <label
                htmlFor={`${idPrefix}-custom-speed-dial`}
                className="block text-sm font-medium"
              >
                Specific speed dial
              </label>
              <Input
                id={`${idPrefix}-custom-speed-dial`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_SPEED_DIAL}
                step={1}
                required
                value={customCode}
                onChange={(event) => setCustomCode(event.target.value)}
                disabled={pending}
                aria-invalid={Boolean(speedDialError)}
                aria-describedby={`${idPrefix}-speed-dial-help${speedDialError ? ` ${idPrefix}-speed-dial-error` : ""}`}
                className="h-11 sm:max-w-xs"
              />
            </div>
          )}
          {speedDialError && (
            <p
              id={`${idPrefix}-speed-dial-error`}
              role="alert"
              className="text-destructive text-sm"
            >
              {speedDialError}
            </p>
          )}
          <p
            id={`${idPrefix}-speed-dial-help`}
            className="text-muted-foreground text-xs sm:text-sm"
          >
            {noCodesAvailable
              ? "Free a speed dial by deleting a contact before adding another."
              : `A few available numbers are shown. Choose a specific number from 1 to ${MAX_SPEED_DIAL}.`}
          </p>
        </div>
        <div className="flex items-end gap-4">
          <Button
            type="submit"
            disabled={pending || noCodesAvailable || invalidSpeedDial}
            className="min-h-11 cursor-pointer"
          >
            {pending
              ? editing
                ? "Saving…"
                : "Adding…"
              : (submitLabel ?? (editing ? "Save" : "Add contact"))}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="link"
              className="text-muted-foreground min-h-11 cursor-pointer px-2"
              disabled={pending}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      <Feedback state={state} />
    </form>
  );
}
