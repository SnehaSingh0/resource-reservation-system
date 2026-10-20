// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "../../api/adminApi";
import { AdminFormPage } from "./AdminFormPage";
import { AdminsPage } from "./AdminsPage";

vi.mock("../../api/adminApi", () => ({
  adminApi: vi.fn(),
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, email: "root@example.com", role: "ADMIN" },
  }),
}));

const admins = [
  {
    id: 1,
    first_name: "Root",
    last_name: "Admin",
    email: "root@example.com",
    phone: "",
    role: "ADMIN" as const,
  },
  {
    id: 2,
    first_name: "Second",
    last_name: "Admin",
    email: "second@example.com",
    phone: "",
    role: "ADMIN" as const,
  },
];

describe("administrator account management", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(adminApi).mockReset();
  });

  it("loads administrator-only records and links to edit actions", async () => {
    vi.mocked(adminApi).mockResolvedValue(admins);
    render(
      <MemoryRouter>
        <AdminsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("second@example.com")).toBeTruthy();
    expect(vi.mocked(adminApi)).toHaveBeenCalledWith(
      "/admins/",
      {},
      "Could not load administrators.",
    );
    expect(screen.queryByText("ordinary@example.com")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Edit" })[1].getAttribute("href")).toContain(
      "/admin/admins/edit?adminId=2",
    );
  });

  it("edits safe admin details without presenting role or password controls", async () => {
    vi.mocked(adminApi).mockImplementation(async <T,>(path: string, options?: RequestInit) => {
      if (path === "/admins/8/") {
        if (options?.method === "PUT") {
          return {
            id: 8,
            first_name: "Updated",
            last_name: "Administrator",
            email: "updated@example.com",
            phone: "555-0123",
            role: "ADMIN",
          } as T;
        }
        return {
          id: 8,
          first_name: "Existing",
          last_name: "Administrator",
          email: "existing@example.com",
          phone: "555-0100",
          role: "ADMIN",
        } as T;
      }
      return undefined as T;
    });
    render(
      <MemoryRouter initialEntries={["/admin/admins/edit?adminId=8"]}>
        <AdminFormPage mode="edit" />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Updated Administrator" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "updated@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "555-0123" },
    });
    expect(screen.queryByLabelText("Role")).toBeNull();
    expect(screen.queryByLabelText("Temporary password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(vi.mocked(adminApi)).toHaveBeenCalledWith(
        "/admins/8/",
        expect.objectContaining({ method: "PUT" }),
        "Could not update the administrator.",
      );
    });
    const updateOptions = vi.mocked(adminApi).mock.calls.find(
      ([, options]) => options?.method === "PUT",
    )?.[1];
    expect(JSON.parse(String(updateOptions?.body))).toEqual({
      first_name: "Updated",
      last_name: "Administrator",
      email: "updated@example.com",
      phone: "555-0123",
    });
  });

  it("creates a user with the role selected in the form", async () => {
    vi.mocked(adminApi).mockResolvedValue({
      id: 12,
      first_name: "New",
      last_name: "User",
      email: "new-user@example.com",
      phone: "",
      role: "ADMIN",
    });
    render(
      <MemoryRouter initialEntries={["/admin/admins/add"]}>
        <AdminFormPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "New User" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "new-user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "ADMIN" },
    });
    fireEvent.change(screen.getByLabelText("Temporary password"), {
      target: { value: "Strong-User-Pass-47!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add User" }));

    await waitFor(() => {
      expect(vi.mocked(adminApi)).toHaveBeenCalledWith(
        "/users/",
        expect.objectContaining({ method: "POST" }),
        "Could not create the user account.",
      );
    });
    const createOptions = vi.mocked(adminApi).mock.calls.find(
      ([, options]) => options?.method === "POST",
    )?.[1];
    expect(JSON.parse(String(createOptions?.body))).toEqual({
      first_name: "New",
      last_name: "User",
      email: "new-user@example.com",
      phone: "",
      role: "ADMIN",
      password: "Strong-User-Pass-47!",
    });
  });
});
