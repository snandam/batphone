import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@/test/test-utils";

import { Navbar } from "./navbar";

const state = vi.hoisted(() => ({
  pathname: "/calls/call-123",
  session: {
    data: {
      user: { name: "Alice Chen", email: "alice@example.com", image: null },
    } as { user: { name: string; email: string; image: null } } | null,
    isPending: false,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => state.session,
  signOut: vi.fn(),
}));
vi.mock("@/components/layouts/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

vi.mock("@/components/ui/logo", () => ({ Logo: () => <span>Bat Phone</span> }));

describe("Navbar", () => {
  beforeEach(() => {
    state.pathname = "/calls/call-123";
    state.session = {
      data: {
        user: { name: "Alice Chen", email: "alice@example.com", image: null },
      },
      isPending: false,
    };
  });

  it.each(["Main navigation", "Mobile navigation"])(
    "marks nested call details current in %s",
    (label) => {
      render(<Navbar />);
      const navigation = within(
        screen.getByRole("navigation", { name: label })
      );
      expect(navigation.getByRole("link", { name: "Calls" })).toHaveAttribute(
        "aria-current",
        "page"
      );
      expect(
        navigation.getByRole("link", { name: "Contacts" })
      ).not.toHaveAttribute("aria-current");
      expect(
        navigation.getByRole("link", { name: "Home" })
      ).not.toHaveAttribute("aria-current");
    }
  );

  it("matches route segments instead of unrelated path prefixes", () => {
    state.pathname = "/calls-other";
    render(<Navbar />);
    for (const link of screen.getAllByRole("link", { name: "Calls" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("exposes an accessible account trigger and skip link", async () => {
    const { user } = render(<Navbar />);
    expect(
      screen.getByRole("link", { name: "Skip to content" })
    ).toHaveAttribute("href", "#main-content");
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(
      await screen.findByRole("menuitem", { name: "Account" })
    ).toHaveAttribute("href", "/account");
    expect(
      screen.getByRole("menuitem", { name: "Sign out" })
    ).toBeInTheDocument();
  });

  it("offers sign in with a return path for a signed-out visitor", () => {
    state.session.data = null;
    render(<Navbar />);
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Account menu" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?callbackUrl=%2Fcalls%2Fcall-123"
    );
  });

  it("does not flash a sign-in action while the session is loading", () => {
    state.session = { data: null, isPending: true };
    render(<Navbar />);
    expect(
      screen.queryByRole("link", { name: "Sign in" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Account menu" })
    ).not.toBeInTheDocument();
  });
});
