import { describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "./supabase-server-client";

describe("createSupabaseServerClient", () => {
  it("passes server configuration to the injected factory", () => {
    const client = { auth: { getUser: vi.fn() } };
    const factory = vi.fn().mockReturnValue(client);

    const result = createSupabaseServerClient(
      {
        url: "https://example.supabase.co",
        anonKey: "public-key",
      },
      factory,
    );

    expect(result).toBe(client);
    expect(factory).toHaveBeenCalledWith({
      url: "https://example.supabase.co",
      anonKey: "public-key",
    });
  });

  it("rejects missing configuration", () => {
    const factory = vi.fn();

    expect(() =>
      createSupabaseServerClient(
        { url: "", anonKey: "public-key" },
        factory,
      ),
    ).toThrow(TypeError);

    expect(() =>
      createSupabaseServerClient(
        { url: "https://example.supabase.co", anonKey: "" },
        factory,
      ),
    ).toThrow(TypeError);

    expect(factory).not.toHaveBeenCalled();
  });
});
