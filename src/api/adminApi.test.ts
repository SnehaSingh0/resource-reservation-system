import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "./adminApi";
import { invalidateCachedGets } from "./requestCache";

vi.mock("./csrf", () => ({
  requireCsrfToken: vi.fn(async () => "csrf-test-token"),
}));

describe("adminApi request caching", () => {
  afterEach(() => {
    invalidateCachedGets();
    vi.unstubAllGlobals();
  });

  it("reuses resources data briefly and refreshes after a successful mutation", async () => {
    let listVersion = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        listVersion = 1;
        return new Response("{}", { status: 201 });
      }
      return new Response(JSON.stringify([{ id: listVersion }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminApi<Array<{ id: number }>>("/resources/")).resolves.toEqual([
      { id: 0 },
    ]);
    await expect(adminApi<Array<{ id: number }>>("/resources/")).resolves.toEqual([
      { id: 0 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await adminApi("/resources/", {
      method: "POST",
      body: JSON.stringify({ name: "New resource" }),
    });
    await expect(adminApi<Array<{ id: number }>>("/resources/")).resolves.toEqual([
      { id: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("invalidates cached constraints after a successful constraint mutation", async () => {
    let constraintVersion = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        constraintVersion = 1;
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify([{ id: constraintVersion }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      adminApi<Array<{ id: number }>>("/resources/12/constraints/"),
    ).resolves.toEqual([{ id: 0 }]);
    await expect(
      adminApi<Array<{ id: number }>>("/resources/12/constraints/"),
    ).resolves.toEqual([{ id: 0 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await adminApi("/resource-constraints/3/", {
      method: "PUT",
      body: JSON.stringify({ is_active: false }),
    });
    await expect(
      adminApi<Array<{ id: number }>>("/resources/12/constraints/"),
    ).resolves.toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
