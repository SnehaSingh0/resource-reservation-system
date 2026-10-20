// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, RequireAuth, useAuth } from "./AuthContext";

vi.mock("../api/csrf", () => ({
  requireCsrfToken: vi.fn(async () => "csrf-token"),
}));

const user = {
  id: 4,
  username: "booker",
  email: "booker@example.com",
  first_name: "Book",
  last_name: "User",
  role: "USER" as const,
};

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
}

function LogoutControl() {
  const { user: currentUser, logout } = useAuth();
  const [error, setError] = useState("");
  return (
    <>
      <p>{currentUser?.email}</p>
      <button
        type="button"
        onClick={() => {
          void logout().catch((logoutError: Error) => setError(logoutError.message));
        }}
      >
        Logout
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

function LoginControl() {
  const { login } = useAuth();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void login("booker@example.com", "not-a-real-password").catch(
            (loginError: Error) => setError(loginError.message),
          );
        }}
      >
        Attempt login
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

describe("authentication session reliability", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps protected routes in place and offers retry when session validation cannot reach the server", async () => {
    let shouldFail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (shouldFail) {
          throw new TypeError("Failed to fetch");
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
        } as Response;
      }),
    );

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AuthProvider>
          <CurrentPath />
          <RequireAuth>
            <p>Protected page</p>
          </RequireAuth>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Could not connect to the server to verify your session."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Current path").textContent).toBe("/admin");
    expect(screen.queryByText("Protected page")).toBeNull();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Current path").textContent).toBe("/login");
    });
  });

  it("does not clear the local user when the logout endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/users/me/")) {
          return {
            ok: true,
            status: 200,
            json: async () => user,
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
        } as Response;
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutControl />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(user.email)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(
      await screen.findByText("Could not end your session. Please try again."),
    ).toBeTruthy();
    expect(screen.getByText(user.email)).toBeTruthy();
  });

  it("clears a stale local user when the logout session has already expired", async () => {
    let sessionRequestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/users/me/")) {
          sessionRequestCount += 1;
          const authenticated = sessionRequestCount === 1;
          return {
            ok: authenticated,
            status: authenticated ? 200 : 403,
            json: async () => user,
          } as Response;
        }
        if (String(input).endsWith("/auth/logout/")) {
          return {
            ok: false,
            status: 403,
            json: async () => ({}),
          } as Response;
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({}),
        } as Response;
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutControl />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(user.email)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    await waitFor(() => {
      expect(screen.queryByText(user.email)).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retains the local user when a logout 403 is caused by CSRF and the session remains active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/users/me/")) {
          return {
            ok: true,
            status: 200,
            json: async () => user,
          } as Response;
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({}),
        } as Response;
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LogoutControl />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(user.email)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(
      await screen.findByText("Could not end your session. Please try again."),
    ).toBeTruthy();
    expect(screen.getByText(user.email)).toBeTruthy();
  });

  it("shows a useful connection error when login cannot reach the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginControl />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attempt login" }));
    expect(
      await screen.findByText(
        "Could not connect to the server. Check that the backend is running and try again.",
      ),
    ).toBeTruthy();
  });
});
