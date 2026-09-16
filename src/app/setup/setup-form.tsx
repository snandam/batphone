"use client";

import { useActionState, useState, useSyncExternalStore } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CircleCheck, Phone, Plus } from "lucide-react";

import { saveMyDetails } from "@/actions/user/details";
import {
  confirmPhoneVerification,
  removeMyPhone,
  startPhoneVerification,
} from "@/actions/user/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatForDisplay, toTelHref } from "@/lib/batphone/phone";

/** What the page already knows; ISO string so no Date crosses the boundary. */
export interface VerifiedPhone {
  phoneNumber: string;
  verifiedAt: string;
  timezone: string;
}

interface SetupFormProps {
  initial: VerifiedPhone | null;
  initialDetails: { firstName: string | null; lastName: string | null };
  suggestedDetails?: { firstName: string | null; lastName: string | null };
  batPhoneNumber: string;
}

interface FormState {
  message: string;
  success: boolean;
}

type Mode = "view" | "enter" | "code";

const EMPTY: FormState = { message: "", success: false };

const noop = () => () => {};
/** Browser zone after hydration, empty on the server so markup matches. */
function useBrowserTimezone(): string {
  return useSyncExternalStore(
    noop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    () => ""
  );
}

function Feedback({ state }: { state: FormState }) {
  return (
    <p
      role="alert"
      className={`text-sm ${state.message ? "" : "invisible"} ${state.success ? "text-foreground" : "text-destructive"}`}
    >
      {state.message || " "}
    </p>
  );
}

export function SetupForm({
  initial,
  initialDetails,
  suggestedDetails,
  batPhoneNumber,
}: SetupFormProps) {
  const router = useRouter();
  const [continuing, setContinuing] = useState(false);
  const [details, setDetails] = useState(initialDetails);
  const [editingDetails, setEditingDetails] = useState(
    !initialDetails.firstName || !initialDetails.lastName
  );
  const [onboarding] = useState(
    !initial || !initialDetails.firstName || !initialDetails.lastName
  );
  const [saved, setSaved] = useState<VerifiedPhone | null>(initial);
  const [mode, setMode] = useState<Mode>(initial ? "view" : "enter");
  const [pendingPhone, setPendingPhone] = useState("");
  const [attemptedPhone, setAttemptedPhone] = useState("");
  const [usingReceivedCode, setUsingReceivedCode] = useState(false);
  const browserTimezone = useBrowserTimezone();
  const hasGoogleSuggestions = Boolean(
    (!details.firstName && suggestedDetails?.firstName) ||
    (!details.lastName && suggestedDetails?.lastName)
  );

  const [detailsState, detailsAction, savingDetails] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await saveMyDetails({
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
      });
      if (!result.success) return { message: result.error, success: false };
      setDetails(result.data);
      setEditingDetails(false);
      if (saved && onboarding) {
        setContinuing(true);
        router.replace("/setup/contact");
      }
      return { message: "", success: true };
    },
    EMPTY
  );

  const [sendState, sendAction, sending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const phone = String(formData.get("phone") ?? "");
      setAttemptedPhone(phone);
      setUsingReceivedCode(false);
      const result = await startPhoneVerification({ phone });
      if (!result.success) {
        return { message: result.error, success: false };
      }
      setPendingPhone(result.data.phone);
      setMode("code");
      return { message: "", success: true };
    },
    EMPTY
  );

  const [confirmState, confirmAction, confirming] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await confirmPhoneVerification({
        phone: String(formData.get("phone") ?? ""),
        code: String(formData.get("code") ?? ""),
        timezone: String(formData.get("timezone") ?? ""),
      });
      if (!result.success) {
        return { message: result.error, success: false };
      }
      setSaved({
        phoneNumber: result.data.phoneNumber ?? "",
        verifiedAt: result.data.phoneVerifiedAt?.toISOString() ?? "",
        timezone: result.data.timezone,
      });
      setMode("view");
      if (onboarding) {
        setContinuing(true);
        router.replace("/setup/contact");
      }
      return { message: "", success: true };
    },
    EMPTY
  );

  const [removeState, removeAction, removing] = useActionState(
    async (): Promise<FormState> => {
      const result = await removeMyPhone();
      if (!result.success) {
        return { message: result.error, success: false };
      }
      setSaved(null);
      setMode("enter");
      return { message: "Number removed.", success: true };
    },
    EMPTY
  );

  if (continuing) {
    return (
      <div className="bg-card space-y-4 rounded-xl border p-4 sm:p-6">
        <p className="text-muted-foreground text-sm">
          Step 1 of 2 · Your details
        </p>
        <p role="status">Continuing…</p>
      </div>
    );
  }

  if (editingDetails) {
    return (
      <form
        key="details"
        action={detailsAction}
        className="bg-card space-y-6 rounded-xl border p-4 sm:p-6"
      >
        <div className="space-y-2">
          {onboarding && (
            <p className="text-muted-foreground text-sm">Step 1 of 2</p>
          )}
          <h2 className="text-xl font-semibold">What should we call you?</h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            {hasGoogleSuggestions
              ? "We filled in your name from Google. Check it or make changes."
              : "Enter your name, then verify the mobile number you’ll call from."}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-sm font-medium">
              First name
            </label>
            <Input
              id="firstName"
              name="firstName"
              autoComplete="given-name"
              defaultValue={
                details.firstName ?? suggestedDetails?.firstName ?? ""
              }
              maxLength={80}
              required
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm font-medium">
              Last name
            </label>
            <Input
              id="lastName"
              name="lastName"
              autoComplete="family-name"
              defaultValue={
                details.lastName ?? suggestedDetails?.lastName ?? ""
              }
              maxLength={80}
              required
              className="h-11"
            />
          </div>
        </div>
        <Feedback state={detailsState} />
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={savingDetails}
            className="min-h-11 cursor-pointer"
          >
            {savingDetails
              ? "Saving…"
              : onboarding
                ? saved
                  ? "Continue"
                  : "Continue"
                : "Save name"}
          </Button>
          {!onboarding && (
            <Button
              type="button"
              variant="link"
              className="min-h-11 cursor-pointer"
              onClick={() => setEditingDetails(false)}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }

  if (mode === "view" && saved) {
    return (
      <div className="bg-card space-y-6 rounded-xl border p-4 sm:space-y-8 sm:p-6">
        <div className="space-y-2">
          <p className="text-xl font-semibold">
            {details.firstName} {details.lastName}
          </p>
          <p className="text-muted-foreground text-sm">Your calling number</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {formatForDisplay(saved.phoneNumber)}
          </p>
          <p className="text-foreground inline-flex items-center gap-1.5 text-sm sm:text-base">
            <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
            Verified
          </p>
          <p className="text-muted-foreground text-xs sm:text-sm">
            {saved.timezone}
          </p>
        </div>

        <div className="bg-muted/40 space-y-4 rounded-lg p-4 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold sm:text-xl">
              You’re ready to call
            </h2>
            <p className="mt-2 text-sm sm:text-base">
              Save a contact, then call Bat Phone from your verified number
              above and say their name.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="min-h-11 cursor-pointer">
              <Link href="/contacts">
                <Plus aria-hidden="true" />
                Add contacts
              </Link>
            </Button>
            {batPhoneNumber && (
              <Button
                asChild
                variant="outline"
                className="min-h-11 cursor-pointer"
              >
                <a href={toTelHref(batPhoneNumber)}>
                  <Phone aria-hidden="true" />
                  Call Bat Phone
                </a>
              </Button>
            )}
          </div>
          {batPhoneNumber ? (
            <p className="text-muted-foreground text-sm tabular-nums">
              Bat Phone: {formatForDisplay(batPhoneNumber)}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              The calling number is not available yet. Contact your
              administrator.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Feedback state={removeState} />
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Button
              type="button"
              variant="link"
              className="min-h-11 cursor-pointer px-2"
              onClick={() => setEditingDetails(true)}
            >
              Edit name
            </Button>
            <Button
              type="button"
              variant="link"
              className="min-h-11 cursor-pointer px-2"
              onClick={() => setMode("enter")}
            >
              Change number
            </Button>
            <form action={removeAction}>
              <Button
                type="submit"
                variant="link"
                className="text-destructive min-h-11 cursor-pointer px-2"
                disabled={removing}
              >
                {removing ? "Removing…" : "Remove"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "code") {
    return (
      <form
        key="code"
        action={confirmAction}
        className="bg-card space-y-6 rounded-xl border p-4 sm:p-6"
      >
        {onboarding && (
          <p className="text-muted-foreground text-sm">
            Step 1 of 2 · Verify your phone
          </p>
        )}
        <input type="hidden" name="phone" value={pendingPhone} />
        <input type="hidden" name="timezone" value={browserTimezone} />
        <div className="space-y-3">
          <label
            htmlFor="code"
            className="block text-base font-medium sm:text-lg"
          >
            Enter the code we texted to {formatForDisplay(pendingPhone)}
          </label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            className="h-11 max-w-xs text-lg tracking-widest tabular-nums"
            required
            autoFocus
          />
        </div>

        <Feedback
          state={
            confirmState.message
              ? confirmState
              : usingReceivedCode
                ? EMPTY
                : sendState
          }
        />

        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <Button
            type="submit"
            disabled={confirming || sending}
            className="min-h-11 cursor-pointer"
          >
            {confirming ? "Checking…" : "Verify"}
          </Button>
          <Button
            type="submit"
            variant="link"
            formAction={sendAction}
            formNoValidate
            disabled={confirming || sending}
            className="min-h-11 cursor-pointer px-2"
          >
            {sending ? "Sending…" : "Send again"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="text-muted-foreground min-h-11 cursor-pointer px-2"
            disabled={confirming || sending}
            onClick={() => setMode(saved ? "view" : "enter")}
          >
            {saved ? "Cancel" : "Use a different number"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      key="phone"
      action={sendAction}
      className="bg-card space-y-6 rounded-xl border p-4 sm:p-6"
    >
      {onboarding && (
        <p className="text-muted-foreground text-sm">
          Step 1 of 2 · Verify your phone
        </p>
      )}
      <p className="text-base sm:text-lg">
        Bat Phone knows it&apos;s you by the number you call from.
      </p>
      <div className="space-y-3">
        <label htmlFor="phone" className="block text-sm font-medium">
          Mobile number
        </label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+1 415 555 2671"
          defaultValue={
            pendingPhone || attemptedPhone || saved?.phoneNumber || ""
          }
          maxLength={32}
          className="h-11 max-w-sm"
          required
        />
      </div>

      <Feedback state={sendState.message ? sendState : removeState} />

      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        <Button
          type="submit"
          disabled={sending}
          className="min-h-11 cursor-pointer"
        >
          {sending ? "Sending…" : "Send code"}
        </Button>
        <Button
          type="submit"
          variant="outline"
          disabled={sending || confirming}
          className="min-h-11 cursor-pointer"
          formAction={(formData: FormData) => {
            setPendingPhone(String(formData.get("phone") ?? ""));
            setUsingReceivedCode(true);
            setMode("code");
          }}
        >
          I already have a code
        </Button>
        {onboarding && (
          <Button
            type="button"
            variant="link"
            className="min-h-11 cursor-pointer"
            onClick={() => setEditingDetails(true)}
          >
            Edit name
          </Button>
        )}
        {saved && (
          <Button
            type="button"
            variant="link"
            className="text-muted-foreground min-h-11 cursor-pointer px-2"
            onClick={() => setMode("view")}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
