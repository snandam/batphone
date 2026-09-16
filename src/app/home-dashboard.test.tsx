import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@/test/test-utils";

import {
  HomeDashboard,
  type HomeDashboardProps,
  type RecentCall,
} from "./home-dashboard";

vi.mock("@/app/calls/call-refresh", () => ({ CallRefresh: () => null }));

function recentCall(status: RecentCall["status"]): RecentCall {
  return {
    id: `call-${status}`,
    contactName: "Bob Smith",
    status,
    startedAt: new Date("2026-09-15T20:00:00Z"),
    durationSec: null,
    hasTranscript: false,
    answeredBy: null,
    callerSpoke: null,
  };
}

const ready: HomeDashboardProps = {
  name: "Alice Chen",
  email: "alice@example.com",
  verifiedNumber: "+14155552671",
  batPhoneNumber: "+15555550199",
  contactCount: 1,
  numberLink: "connected",
  firstContact: { name: "Bob Smith", speedDial: 42 },
  recentCalls: [],
  timeZone: "America/Vancouver",
};

describe("HomeDashboard next action", () => {
  it("asks unverified users to verify before offering a call", () => {
    const { container } = render(
      <HomeDashboard {...ready} verifiedNumber={null} />
    );
    const calling = screen.getByRole("region", {
      name: "One number. Every conversation.",
    });
    expect(
      within(calling).getByRole("link", { name: "Verify your phone" })
    ).toHaveAttribute("href", "/setup");
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("asks verified users without contacts to add their first contact", () => {
    const { container } = render(
      <HomeDashboard {...ready} contactCount={0} firstContact={null} />
    );
    expect(
      screen.getByRole("link", { name: "Add your first contact" })
    ).toHaveAttribute("href", "/contacts");
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("calls the Bat Phone number and identifies the verified caller separately", () => {
    render(<HomeDashboard {...ready} />);
    expect(
      screen.getByRole("link", { name: "Call Bat Phone" })
    ).toHaveAttribute("href", "tel:+15555550199");
    expect(screen.getByText("+1 415 555 2671")).toBeInTheDocument();
    expect(screen.getByText(/Try “Bob Smith”/)).toHaveTextContent("42#");
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("shows setup readiness in the header when no call is live", () => {
    render(<HomeDashboard {...ready} />);
    expect(screen.getByText("Ready to call")).toBeInTheDocument();
  });

  it("shows the live call in the header while the caller is on the line", () => {
    render(
      <HomeDashboard
        {...ready}
        recentCalls={[
          recentCall("dialing"),
          recentCall("transcribing"),
          recentCall("emailed"),
        ]}
      />
    );
    expect(screen.getByText("Call in progress")).toBeInTheDocument();
    expect(screen.queryByText("Ready to call")).toBeNull();
  });

  it("shows processing in the header until the last call is emailed", () => {
    const { rerender } = render(
      <HomeDashboard {...ready} recentCalls={[recentCall("transcribing")]} />
    );
    expect(screen.getByText("Processing your last call")).toBeInTheDocument();
    rerender(
      <HomeDashboard {...ready} recentCalls={[recentCall("emailed")]} />
    );
    expect(screen.getByText("Ready to call")).toBeInTheDocument();
  });

  it("warns when the number's webhook does not point at this app, above any call state", () => {
    render(
      <HomeDashboard
        {...ready}
        numberLink="disconnected"
        recentCalls={[recentCall("dialing")]}
      />
    );
    expect(screen.getByText("Number not connected")).toBeInTheDocument();
    expect(screen.queryByText("Call in progress")).toBeNull();
  });

  it("does not alarm the caller when the link could not be checked", () => {
    render(<HomeDashboard {...ready} numberLink="unknown" />);
    expect(screen.getByText("Ready to call")).toBeInTheDocument();
  });

  it("returns to ready after a failure that needs the caller's action", () => {
    render(
      <HomeDashboard {...ready} recentCalls={[recentCall("email_failed")]} />
    );
    expect(screen.getByText("Ready to call")).toBeInTheDocument();
  });

  it("explains unavailable calling without constructing an empty call link", () => {
    const { container } = render(
      <HomeDashboard {...ready} batPhoneNumber="" />
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Calling is temporarily unavailable"
    );
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(
      screen.getByRole("link", { name: "View all calls" })
    ).toHaveAttribute("href", "/calls");
  });

  it("renders long user content as text instead of HTML", () => {
    const name = `<img/src=x/onerror=alert(1)>${"Alex".repeat(30)}`;
    const email = `${"long".repeat(40)}<script>alert(1)</script>@example.com`;
    const { container } = render(
      <HomeDashboard
        {...ready}
        name={name}
        email={email}
        firstContact={{ name: "<iframe>Bob</iframe>", speedDial: 42 }}
      />
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `Hello, ${name}.`
    );
    expect(screen.getByText(email)).toBeInTheDocument();
    expect(screen.getByText(/Try “<iframe>Bob<\/iframe>”/)).toBeInTheDocument();
    expect(container.querySelector("script, img, iframe")).toBeNull();
  });
});
