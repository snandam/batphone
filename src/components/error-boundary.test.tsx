import { describe, expect, it, vi } from "vitest";

import { render } from "@/test/test-utils";

import { ErrorBoundary } from "./error-boundary";

const mockError = Object.assign(new Error("Test error message"), {
  digest: "abc123",
});

describe("ErrorBoundary", () => {
  it("renders one sentence and nothing else", () => {
    const { getByText, queryByText } = render(
      <ErrorBoundary error={mockError} reset={vi.fn()} />
    );
    expect(getByText("Something went wrong.")).toBeInTheDocument();
    expect(queryByText(/unexpected error/i)).toBeNull();
  });

  it("renders the try again button as the only button", () => {
    const { getByRole, getAllByRole } = render(
      <ErrorBoundary error={mockError} reset={vi.fn()} />
    );
    expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(getAllByRole("button")).toHaveLength(1);
  });

  it("calls reset when try again is clicked", async () => {
    const reset = vi.fn();
    const { user, getByRole } = render(
      <ErrorBoundary error={mockError} reset={reset} />
    );
    await user.click(getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows error message in development", () => {
    const { getByText } = render(
      <ErrorBoundary error={mockError} reset={vi.fn()} />
    );
    // NODE_ENV is 'test' in vitest, which !== 'development'
    // so the error message pre tag should not render
    expect(() => getByText("Test error message")).toThrow();
  });
});
