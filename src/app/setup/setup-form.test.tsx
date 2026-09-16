import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveMyDetails } from "@/actions/user/details";
import {
  confirmPhoneVerification,
  startPhoneVerification,
} from "@/actions/user/phone";
import { render, screen, waitFor } from "@/test/test-utils";

import { SetupForm } from "./setup-form";

const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/actions/user/details", () => ({ saveMyDetails: vi.fn() }));
const initialDetails = { firstName: "Sanjeev", lastName: "Nandam" };

vi.mock("@/actions/user/phone", () => ({
  startPhoneVerification: vi.fn(),
  confirmPhoneVerification: vi.fn(),
  removeMyPhone: vi.fn(),
}));

describe("SetupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveMyDetails).mockResolvedValue({
      success: true,
      data: initialDetails,
    });
    vi.mocked(startPhoneVerification).mockResolvedValue({
      success: true,
      data: { phone: "+14155552671" },
    });
  });

  it("lets users resend without validating an empty or incomplete verification code", async () => {
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={initialDetails}
        batPhoneNumber="+15555550199"
      />
    );
    await user.type(
      screen.getByRole("textbox", { name: "Mobile number" }),
      "+14155552671"
    );
    await user.click(screen.getByRole("button", { name: "Send code" }));
    const resend = await screen.findByRole("button", { name: "Send again" });
    const code = screen.getByRole("textbox", { name: /Enter the code/ });
    expect(code).toBeInvalid();
    expect(resend).toHaveAttribute("formnovalidate");
    expect(screen.getByRole("button", { name: "Verify" })).not.toHaveAttribute(
      "formnovalidate"
    );
    await user.type(code, "12");
    expect(code).toBeInvalid();
    // jsdom does not implement formNoValidate when clicking submit buttons.
    // The attribute above verifies the browser bypass; submit directly to verify routing.
    code.closest("form")!.noValidate = true;
    await user.click(resend);
    await waitFor(() =>
      expect(startPhoneVerification).toHaveBeenCalledTimes(2)
    );
    expect(startPhoneVerification).toHaveBeenLastCalledWith({
      phone: "+14155552671",
    });
  });
  it("requires an explicit name before offering phone verification", async () => {
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={{ firstName: null, lastName: null }}
        batPhoneNumber="+15555550199"
      />
    );
    expect(
      screen.queryByRole("textbox", { name: "Mobile number" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add contacts" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(saveMyDetails).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole("textbox", { name: "First name" }),
      "Sanjeev"
    );
    await user.type(
      screen.getByRole("textbox", { name: "Last name" }),
      "Nandam"
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("textbox", { name: "Mobile number" })
    ).toBeInTheDocument();
    expect(saveMyDetails).toHaveBeenCalledWith(initialDetails);
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps name validation errors on the first step", async () => {
    vi.mocked(saveMyDetails).mockResolvedValue({
      success: false,
      error: "Enter your first name",
    });
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={{ firstName: null, lastName: null }}
        batPhoneNumber="+15555550199"
      />
    );
    await user.type(screen.getByRole("textbox", { name: "First name" }), " ");
    await user.type(
      screen.getByRole("textbox", { name: "Last name" }),
      "Nandam"
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your first name"
    );
    expect(
      screen.queryByRole("textbox", { name: "Mobile number" })
    ).not.toBeInTheDocument();
  });

  it("finishes setup after our SMS verification succeeds", async () => {
    vi.mocked(confirmPhoneVerification).mockResolvedValue({
      success: true,
      data: {
        phoneNumber: "+14155552671",
        phoneVerifiedAt: new Date(),
        timezone: "America/Vancouver",
      },
    });
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={initialDetails}
        batPhoneNumber="+15555550199"
      />
    );
    await user.type(
      screen.getByRole("textbox", { name: "Mobile number" }),
      "+14155552671"
    );
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(
      await screen.findByRole("textbox", { name: /Enter the code/ }),
      "123456"
    );
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup/contact"));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Continuing…");
    expect(screen.queryByText("You’re ready to call")).not.toBeInTheDocument();
  });

  it("preserves an existing verified number when completing missing names", async () => {
    const { user } = render(
      <SetupForm
        initial={{
          phoneNumber: "+14155552671",
          verifiedAt: new Date().toISOString(),
          timezone: "America/Vancouver",
        }}
        initialDetails={{ firstName: null, lastName: null }}
        batPhoneNumber="+15555550199"
      />
    );
    await user.type(
      screen.getByRole("textbox", { name: "First name" }),
      "Sanjeev"
    );
    await user.type(
      screen.getByRole("textbox", { name: "Last name" }),
      "Nandam"
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup/contact"));
    expect(startPhoneVerification).not.toHaveBeenCalled();
  });
  it("prefills Google names but requires confirmation and accepts edits", async () => {
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={{ firstName: null, lastName: null }}
        suggestedDetails={{ firstName: "Sanjeev", lastName: "Nandam" }}
        batPhoneNumber="+15555550199"
      />
    );
    const firstName = screen.getByRole("textbox", { name: "First name" });
    expect(firstName).toHaveValue("Sanjeev");
    expect(screen.getByRole("textbox", { name: "Last name" })).toHaveValue(
      "Nandam"
    );
    expect(
      screen.getByText(
        "We filled in your name from Google. Check it or make changes."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Mobile number" })
    ).not.toBeInTheDocument();
    expect(saveMyDetails).not.toHaveBeenCalled();
    await user.clear(firstName);
    await user.type(firstName, "Sam");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("textbox", { name: "Mobile number" })
    ).toBeInTheDocument();
    expect(saveMyDetails).toHaveBeenCalledWith({
      firstName: "Sam",
      lastName: "Nandam",
    });
  });

  it("keeps saved names when editing a profile with different Google suggestions", async () => {
    const { user } = render(
      <SetupForm
        initial={{
          phoneNumber: "+14155552671",
          verifiedAt: new Date().toISOString(),
          timezone: "America/Vancouver",
        }}
        initialDetails={{ firstName: "Sam", lastName: "N" }}
        suggestedDetails={{ firstName: "Sanjeev", lastName: "Nandam" }}
        batPhoneNumber="+15555550199"
      />
    );
    await user.click(screen.getByRole("button", { name: "Edit name" }));
    expect(screen.getByRole("textbox", { name: "First name" })).toHaveValue(
      "Sam"
    );
    expect(screen.getByRole("textbox", { name: "Last name" })).toHaveValue("N");
    expect(screen.getByRole("textbox", { name: "First name" })).toHaveAttribute(
      "maxlength",
      "80"
    );
    expect(
      screen.queryByText(
        "We filled in your name from Google. Check it or make changes."
      )
    ).not.toBeInTheDocument();
  });
  it("verifies a delivered code after sending reports failure without sending again", async () => {
    vi.mocked(startPhoneVerification).mockResolvedValue({
      success: false,
      error: "Verification is unavailable right now.",
    });
    vi.mocked(confirmPhoneVerification).mockResolvedValue({
      success: true,
      data: {
        phoneNumber: "+14155552671",
        phoneVerifiedAt: new Date(),
        timezone: "America/Vancouver",
      },
    });
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={initialDetails}
        batPhoneNumber="+15555550199"
      />
    );
    await user.type(
      screen.getByRole("textbox", { name: "Mobile number" }),
      "+14155552671"
    );
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.click(
      await screen.findByRole("button", { name: "I already have a code" })
    );
    expect(
      screen.getByRole("textbox", { name: /Enter the code/ })
    ).toHaveAccessibleName("Enter the code we texted to +1 415 555 2671");
    expect(replace).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole("textbox", { name: /Enter the code/ }),
      "123456"
    );
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup/contact"));
    expect(confirmPhoneVerification).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+14155552671", code: "123456" })
    );
    expect(startPhoneVerification).toHaveBeenCalledTimes(1);
  });

  it("keeps a previously verified number when a recovered code fails validation", async () => {
    vi.mocked(startPhoneVerification).mockResolvedValue({
      success: false,
      error: "Verification is unavailable right now.",
    });
    vi.mocked(confirmPhoneVerification).mockResolvedValue({
      success: false,
      error: "That code is not right.",
    });
    const { user } = render(
      <SetupForm
        initial={{
          phoneNumber: "+14155552671",
          verifiedAt: new Date().toISOString(),
          timezone: "America/Vancouver",
        }}
        initialDetails={initialDetails}
        batPhoneNumber="+15555550199"
      />
    );
    await user.click(screen.getByRole("button", { name: "Change number" }));
    const phone = screen.getByRole("textbox", { name: "Mobile number" });
    await user.clear(phone);
    await user.type(phone, "+14155552672");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.click(
      await screen.findByRole("button", { name: "I already have a code" })
    );
    await user.type(
      screen.getByRole("textbox", { name: /Enter the code/ }),
      "123456"
    );
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That code is not right."
      )
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("+1 415 555 2671")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(startPhoneVerification).toHaveBeenCalledTimes(1);
  });
  it("lets a returning user enter an existing SMS code without sending another", async () => {
    const { user } = render(
      <SetupForm
        initial={null}
        initialDetails={initialDetails}
        batPhoneNumber="+15555550199"
      />
    );
    await user.click(
      screen.getByRole("button", { name: "I already have a code" })
    );
    expect(
      screen.getByRole("textbox", { name: "Mobile number" })
    ).toBeInvalid();
    await user.type(
      screen.getByRole("textbox", { name: "Mobile number" }),
      "+14155552671"
    );
    await user.click(
      screen.getByRole("button", { name: "I already have a code" })
    );
    expect(
      screen.getByRole("textbox", { name: /Enter the code/ })
    ).toHaveAccessibleName("Enter the code we texted to +1 415 555 2671");
    expect(startPhoneVerification).not.toHaveBeenCalled();
    expect(confirmPhoneVerification).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Use a different number" })
    );
    expect(screen.getByRole("textbox", { name: "Mobile number" })).toHaveValue(
      "+14155552671"
    );
  });
});
