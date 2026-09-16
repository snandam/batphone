import { beforeEach, describe, expect, it, vi } from "vitest";

import { signIn } from "@/lib/auth-client";
import { render, screen, waitFor } from "@/test/test-utils";

import { LoginForm } from "./login-form";

vi.mock("@/lib/auth-client", () => ({ signIn: { social: vi.fn() } }));
vi.mock("@/components/ui/logo", () => ({ Logo: () => <span>Bat Phone</span> }));

beforeEach(() => vi.clearAllMocks());

describe("LoginForm failure recovery", () => {
  it.each([
    {
      data: null,
      error: {
        message: "Provider unavailable",
        status: 500,
        statusText: "Internal Server Error",
      },
    },
    { data: null, error: null },
  ])(
    "releases the sign-in button after a response without a redirect",
    async (result) => {
      vi.mocked(signIn.social).mockResolvedValue(
        result as Awaited<ReturnType<typeof signIn.social>>
      );
      const { user } = render(<LoginForm callbackUrl="/calls/example" />);
      const button = screen.getByRole("button", {
        name: "Continue with Google",
      });
      await user.click(button);
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Couldn’t start Google sign-in"
        )
      );
      expect(button).toBeEnabled();
      await user.click(button);
      expect(signIn.social).toHaveBeenCalledTimes(2);
      expect(signIn.social).toHaveBeenLastCalledWith(
        expect.objectContaining({
          errorCallbackURL: "/login?callbackUrl=%2Fcalls%2Fexample",
          callbackURL: "/auth/callback?next=%2Fcalls%2Fexample",
        })
      );
    }
  );
  it("releases the button after a network failure", async () => {
    vi.mocked(signIn.social).mockRejectedValue(
      new Error("Network unavailable")
    );
    const { user } = render(<LoginForm />);
    const button = screen.getByRole("button", { name: "Continue with Google" });
    await user.click(button);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sign-in did not complete"
      )
    );
    expect(button).toBeEnabled();
  });
});
