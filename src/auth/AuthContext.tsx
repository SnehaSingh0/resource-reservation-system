import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { apiUrl } from "../api/apiUrl";

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "ADMIN" | "USER";
  phone?: string;
  created_at?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getCsrfToken() {
  const csrfCookie = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("csrftoken="));

  return csrfCookie
    ? decodeURIComponent(csrfCookie.slice("csrftoken=".length))
    : null;
}

async function ensureCsrfCookie() {
  const response = await fetch(apiUrl("/auth/csrf/"), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not prepare secure authentication. Please try again.");
  }

  const token = getCsrfToken();
  if (!token) {
    throw new Error("Could not read the security token. Please try again.");
  }

  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch(apiUrl("/users/me/"), {
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        setUser(null);
        return null;
      }

      if (!response.ok) {
        setUser(null);
        return null;
      }

      const nextUser = (await response.json()) as AuthUser;
      setUser(nextUser);
      return nextUser;
    } catch {
      setUser(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const csrfToken = await ensureCsrfCookie();

    const response = await fetch(apiUrl("/auth/login/"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
      },
      body: JSON.stringify({ email, password }),
    });

    const responseBody: unknown = await response.json().catch(() => ({}));

    if (response.status === 401) {
      const detail =
        typeof responseBody === "object" && responseBody && "detail" in responseBody
          ? String((responseBody as { detail?: string }).detail)
          : "Email or password is incorrect.";
      throw new Error(detail || "Email or password is incorrect.");
    }

    if (response.status === 403) {
      throw new Error("Login security check failed. Refresh the page and try again.");
    }

    if (!response.ok || typeof responseBody !== "object" || responseBody === null || !("user" in responseBody)) {
      throw new Error("The server returned an unexpected login response.");
    }

    const nextUser = responseBody.user as AuthUser;
    setUser(nextUser);
    return nextUser;
  }, []);

  const register = useCallback(
    async ({ fullName, email, password, confirmPassword }: { fullName: string; email: string; password: string; confirmPassword: string }) => {
      if (!fullName.trim()) {
        throw new Error("Full name is required.");
      }
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      const csrfToken = await ensureCsrfCookie();
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] ?? "";
      const lastName = nameParts.slice(1).join(" ");

      const response = await fetch(apiUrl("/auth/register/"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken,
        },
        body: JSON.stringify({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          username: email.split("@")[0] || "user",
        }),
      });

      const responseBody: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          typeof responseBody === "object" && responseBody && "detail" in responseBody
            ? String((responseBody as { detail?: string }).detail)
            : "Could not create the account.";
        throw new Error(detail || "Could not create the account.");
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    const csrfToken = getCsrfToken();

    try {
      if (csrfToken) {
        await fetch(apiUrl("/auth/logout/"), {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": csrfToken,
          },
        });
      }
    } catch {
      // Continue to end the local session even if the backend request fails.
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, isLoading, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}

export function RequireAuth({
  children,
  requireAdmin = false,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-live="polite">
          <p className="auth-subtitle">Checking your session...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireAdmin && user.role !== "ADMIN") {
    return <Navigate to="/resources" replace />;
  }

  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-live="polite">
          <p className="auth-subtitle">Checking your session...</p>
        </section>
      </main>
    );
  }

  if (user) {
    return <Navigate to={user.role === "ADMIN" ? "/admin" : "/resources"} replace />;
  }

  return <>{children}</>;
}
