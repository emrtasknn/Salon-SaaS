import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// `/` is the PWA start_url: signed-out users get the sign-in screen, signed-in users
// are forwarded by role (navigation only). The auth lookup is mocked at the adapter.
const { readIdentity } = vi.hoisted(() => ({ readIdentity: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  redirect: vi.fn(),
}));
vi.mock("../infrastructure/auth/supabase-server-client", () => ({ createNextSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("../infrastructure/auth/supabase-server-env", () => ({ readSupabaseServerClientConfig: vi.fn(() => ({})) }));
vi.mock("../infrastructure/auth/supabase-auth-adapter", () => ({ createSupabaseAuthAdapter: vi.fn(() => ({ readIdentity })) }));
vi.mock("../infrastructure/auth/supabase-browser-client", () => ({ createNextSupabaseBrowserClient: vi.fn() }));
// vitest has no "@/" alias; login-form imports the browser client through it.
vi.mock("@/infrastructure/auth/supabase-browser-client", () => ({ createNextSupabaseBrowserClient: vi.fn() }));

import Home from "./page";

async function renderHome(): Promise<string> {
  return renderToStaticMarkup(await Home());
}

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("entry screen (/)", () => {
  beforeEach(() => {
    readIdentity.mockReset();
  });

  it("shows the sign-in form when not signed in", async () => {
    readIdentity.mockResolvedValue({ state: "unauthenticated" });
    const html = await renderHome();
    expect(html).toContain("Salon-SaaS");
    expect(html).toContain('id="email"');
    expect(html).toContain('id="password"');
    expect(html).toContain("Giriş yap");
    expect(html).toContain("Şifremi unuttum");
    expect(html).not.toContain("Yönlendiriliyor");
  });

  it("removes the stale MVP stub", async () => {
    readIdentity.mockResolvedValue({ state: "unauthenticated" });
    const html = await renderHome();
    expect(html).not.toContain("W10.3");
    expect(html).not.toContain("Yönetim alanı");
  });

  it("forwards a platform SUPER_ADMIN to /platform/tenants", async () => {
    readIdentity.mockResolvedValue({ state: "authenticated", subjectId: "user-1", platformRole: "SUPER_ADMIN" });
    const html = await renderHome();
    expect(html).toContain('href="/platform/tenants"');
    expect(html).not.toContain('id="password"');
    expect(readIdentity).toHaveBeenCalledTimes(1);
  });

  it("forwards a signed-in tenant user to /admin", async () => {
    readIdentity.mockResolvedValue({ state: "authenticated", subjectId: "user-2", tenantId: TENANT_ID });
    const html = await renderHome();
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("/platform/tenants");
    expect(html).not.toContain('id="password"');
  });

  it("does not treat a client-claimed or malformed role as SUPER_ADMIN", async () => {
    readIdentity.mockResolvedValue({ state: "authenticated", subjectId: "user-3", platformRole: "super_admin", tenantId: TENANT_ID });
    const html = await renderHome();
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("/platform/tenants");
  });

  it("falls back to sign-in when a session has neither tenant nor platform role", async () => {
    readIdentity.mockResolvedValue({ state: "authenticated", subjectId: "user-4" });
    const html = await renderHome();
    expect(html).toContain('id="password"');
  });

  it("falls back to sign-in when the auth lookup fails", async () => {
    readIdentity.mockRejectedValue(new Error("network"));
    const html = await renderHome();
    expect(html).toContain('id="password"');
  });
});
