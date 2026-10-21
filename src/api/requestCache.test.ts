import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedGet, invalidateCachedGets } from "./requestCache";

describe("cachedGet", () => {
  afterEach(() => {
    invalidateCachedGets();
    vi.useRealTimers();
  });

  it("shares an in-flight GET and reuses its result for the configured lifetime", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ value: "initial" }));

    const first = cachedGet("/resources/", load, 1_000);
    const second = cachedGet("/resources/", load, 1_000);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual({ value: "initial" });
    expect(secondResult).toBe(firstResult);

    const cachedResult = await cachedGet(
      "/resources/",
      vi.fn(async () => ({ value: "unexpected" })),
      1_000,
    );
    expect(cachedResult).toBe(firstResult);

    await vi.advanceTimersByTimeAsync(1_001);
    const refreshedResult = await cachedGet(
      "/resources/",
      async () => ({ value: "refreshed" }),
      1_000,
    );
    expect(refreshedResult).toEqual({ value: "refreshed" });
  });

  it("does not retain failed requests", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("recovered");

    await expect(cachedGet("/resources/", load, 1_000)).rejects.toThrow(
      "temporary failure",
    );
    await expect(cachedGet("/resources/", load, 1_000)).resolves.toBe(
      "recovered",
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates only matching cached GETs", async () => {
    const resourcesLoader = vi.fn(async () => ["resource"]);
    const constraintsLoader = vi.fn(async () => ["constraint"]);

    await cachedGet("https://api.test/api/resources/", resourcesLoader, 1_000);
    await cachedGet(
      "https://api.test/api/resources/1/constraints/",
      constraintsLoader,
      1_000,
    );
    invalidateCachedGets("https://api.test/api/resources/1/");

    await cachedGet("https://api.test/api/resources/", resourcesLoader, 1_000);
    await cachedGet(
      "https://api.test/api/resources/1/constraints/",
      constraintsLoader,
      1_000,
    );

    expect(resourcesLoader).toHaveBeenCalledTimes(1);
    expect(constraintsLoader).toHaveBeenCalledTimes(2);
  });
});
