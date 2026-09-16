"use client";

import { useActionState, useState } from "react";

import { Plus, Search, Users } from "lucide-react";

import {
  deleteContact,
  type ContactSummary,
  type SavedContact,
} from "@/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatForDisplay } from "@/lib/batphone/phone";

import { CONTACT_COLUMNS } from "./columns";
import { ContactForm, savedMessage } from "./contact-form";

interface ContactListProps {
  initial: ContactSummary[];
}

interface DeleteState {
  error: string;
}

const NO_ERROR: DeleteState = { error: "" };

/** The table's column order; the loading skeleton mirrors it. */

/** The form is open for a new contact, for one contact being edited, or closed. */
type Editor =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; contact: ContactSummary };

interface ContactActionsProps {
  contact: ContactSummary;
  onEdit: () => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}

/** Edit and Delete as quiet text, with an inline confirmation for Delete. */
function ContactActions({
  contact,
  onEdit,
  onDeleted,
  onError,
}: ContactActionsProps) {
  const [confirming, setConfirming] = useState(false);

  const [, deleteAction, deleting] = useActionState(
    async (): Promise<DeleteState> => {
      const result = await deleteContact({ id: contact.id });
      if (!result.success) {
        setConfirming(false);
        onError(result.error);
        return { error: result.error };
      }
      onDeleted(contact.id);
      return NO_ERROR;
    },
    NO_ERROR
  );

  if (confirming) {
    return (
      <form action={deleteAction} className="flex items-center gap-4">
        <Button
          type="submit"
          variant="link"
          className="text-destructive min-h-11 cursor-pointer px-2"
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Confirm delete"}
        </Button>
        <Button
          type="button"
          variant="link"
          className="text-muted-foreground min-h-11 cursor-pointer px-2"
          disabled={deleting}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Button
        type="button"
        variant="link"
        className="min-h-11 cursor-pointer px-2"
        aria-label={`Edit ${contact.name}`}
        onClick={onEdit}
      >
        Edit
      </Button>
      <Button
        type="button"
        variant="link"
        className="text-destructive min-h-11 cursor-pointer px-2"
        aria-label={`Delete ${contact.name}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    </div>
  );
}

/**
 * The contacts screen body: the Add contact button beside the title, the
 * add or edit form above the list while one is open, then a table from md
 * up and labelled cards below.
 */
export function ContactList({ initial }: ContactListProps) {
  const [contacts, setContacts] = useState<ContactSummary[]>(initial);
  const [editor, setEditor] = useState<Editor>(
    initial.length === 0 ? { kind: "add" } : { kind: "closed" }
  );
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(normalizedQuery) ||
      String(contact.speedDial).includes(normalizedQuery) ||
      formatForDisplay(contact.phone).includes(normalizedQuery) ||
      (/[0-9]/.test(normalizedQuery) &&
        contact.phone.includes(normalizedQuery.replace(/[^0-9]/g, "")))
  );

  const [deleteError, setDeleteError] = useState("");
  /** The line after a save, kept once the form has closed (R27). */
  const [notice, setNotice] = useState("");

  const upsert = (saved: SavedContact) => {
    const existed = contacts.some((c) => c.id === saved.contact.id);
    setContacts((current) => {
      const next = current.some((c) => c.id === saved.contact.id)
        ? current.map((c) => (c.id === saved.contact.id ? saved.contact : c))
        : [...current, saved.contact];
      return next.sort((a, b) => a.speedDial - b.speedDial);
    });
    setDeleteError("");
    setNotice(savedMessage(saved, existed ? "Saved" : "Added"));
    setQuery("");
    setEditor({ kind: "closed" });
  };

  const remove = (id: string) => {
    setDeleteError("");
    setNotice("");
    setContacts((current) => current.filter((c) => c.id !== id));
  };

  const close = () => setEditor({ kind: "closed" });

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3 sm:space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Contacts
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg">
            Call Bat Phone, then say a name or enter its speed dial followed by
            #.
          </p>
        </div>
        {editor.kind !== "add" && (
          <Button
            type="button"
            className="min-h-11 cursor-pointer"
            onClick={() => setEditor({ kind: "add" })}
          >
            <Plus aria-hidden="true" />
            Add contact
          </Button>
        )}
      </div>

      {editor.kind === "add" && (
        <ContactForm
          contacts={contacts}
          onSaved={upsert}
          onCancel={contacts.length === 0 ? undefined : close}
        />
      )}
      {editor.kind === "edit" && (
        <ContactForm
          key={editor.contact.id}
          contacts={contacts}
          contact={editor.contact}
          onSaved={upsert}
          onCancel={close}
        />
      )}

      {deleteError ? (
        <p role="alert" className="text-destructive text-sm">
          {deleteError}
        </p>
      ) : notice ? (
        <p role="status" className="text-foreground text-sm">
          {notice}
        </p>
      ) : null}

      {contacts.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="contact-search" className="sr-only">
            Search contacts
          </label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-3.5 left-3 size-4"
              aria-hidden="true"
            />
            <Input
              id="contact-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, number or speed dial"
              className="bg-card h-11 pl-10"
            />
          </div>
          <p className="text-muted-foreground text-sm" role="status">
            {visibleContacts.length} of {contacts.length} contacts
          </p>
        </div>
      )}
      {contacts.length === 0 ? (
        <div className="bg-muted/40 rounded-xl border border-dashed p-6 text-center sm:p-8">
          <Users
            className="text-muted-foreground mx-auto mb-3 size-6"
            aria-hidden="true"
          />
          <h2 className="text-lg font-semibold sm:text-xl">
            Your first call starts with a contact
          </h2>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Add their name and number above. Bat Phone will connect you when you
            say their name.
          </p>
        </div>
      ) : visibleContacts.length === 0 ? (
        <div className="rounded-xl border p-6 text-center sm:p-8">
          <h2 className="text-lg font-semibold sm:text-xl">
            No matching contacts
          </h2>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Try another name, phone number or speed dial.
          </p>
          <Button
            variant="outline"
            className="mt-4 min-h-11 cursor-pointer"
            onClick={() => setQuery("")}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card hidden rounded-xl border md:block">
            <Table aria-label="Contacts">
              <TableHeader>
                <TableRow>
                  {CONTACT_COLUMNS.map((column) => (
                    <TableHead key={column} className="px-3">
                      {column}
                    </TableHead>
                  ))}
                  <TableHead className="px-3">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleContacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="px-3 font-medium">
                      {contact.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-3">
                      {formatForDisplay(contact.phone)}
                    </TableCell>
                    <TableCell className="px-3 tabular-nums">
                      {contact.speedDial}
                    </TableCell>
                    <TableCell className="px-3 text-right">
                      <div className="flex justify-end">
                        <ContactActions
                          contact={contact}
                          onEdit={() => setEditor({ kind: "edit", contact })}
                          onDeleted={remove}
                          onError={setDeleteError}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-4 md:hidden" aria-label="Contacts">
            {visibleContacts.map((contact) => (
              <li key={contact.id}>
                <div className="bg-card rounded-xl border p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold break-words sm:text-lg">
                        {contact.name}
                      </h2>
                      <p className="text-muted-foreground mt-1 text-sm tabular-nums">
                        {formatForDisplay(contact.phone)}
                      </p>
                    </div>
                    <p className="bg-muted shrink-0 rounded-lg px-3 py-2 text-center text-xs">
                      <span className="text-muted-foreground block">
                        Speed dial
                      </span>
                      <span className="text-base font-semibold tabular-nums">
                        {contact.speedDial}
                      </span>
                    </p>
                  </div>
                  <div className="mt-3 border-t pt-2">
                    <ContactActions
                      contact={contact}
                      onEdit={() => setEditor({ kind: "edit", contact })}
                      onDeleted={remove}
                      onError={setDeleteError}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
