import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { installSecurity } from "./security";

function createApp(password = "test-owner-password", production = false) {
  const app = new Hono(); installSecurity(app, password, production);
  app.get("/api/private", (c) => c.json({ ok: true })); return app;
}
const login = (password: string) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
describe("Owner session security", () => {
  it("requires authentication and revokes signed-out sessions", async () => {
    const app = createApp();
    expect((await app.request("/api/private")).status).toBe(401);
    expect((await app.request("/api/auth/login", login("wrong"))).status).toBe(401);
    const response = await app.request("/api/auth/login", login("test-owner-password"));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
    const headers = { Cookie: cookie.split(";")[0] };
    expect((await app.request("/api/private", { headers })).status).toBe(200);
    expect((await app.request("/api/auth/logout", { method: "POST", headers })).status).toBe(200);
    expect((await app.request("/api/private", { headers })).status).toBe(401);
  });
  it("throttles failed passwords and rejects hostile origins", async () => {
    const app = createApp();
    for (let index = 0; index < 10; index++) expect((await app.request("/api/auth/login", login("wrong"))).status).toBe(401);
    expect((await app.request("/api/auth/login", login("test-owner-password"))).status).toBe(429);
    for (const origin of ["https://evil.example", "null", "not a URL"]) expect((await app.request("/api/auth/login", { ...login("test-owner-password"), headers: { "Content-Type": "application/json", Origin: origin } })).status).toBe(403);
  });
  it("uses secure production cookies and blocks DNS rebinding in local-only mode", async () => {
    const response = await createApp("test-owner-password", true).request("/api/auth/login", login("test-owner-password"));
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect((await createApp("").request("http://evil.example/api/private")).status).toBe(403);
    expect((await createApp("").request("http://localhost/api/private")).status).toBe(200);
  });

  it("persists a changed owner password and invalidates existing sessions", async () => {
    let savedHash: string | null = null;
    const app = new Hono(); installSecurity(app, "initial-owner-password", false, { getHash: () => savedHash, saveHash: (hash) => { savedHash = hash; } });
    const initial = await app.request("/api/auth/login", login("initial-owner-password"));
    const cookie = initial.headers.get("set-cookie")!.split(";")[0];
    const changed = await app.request("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ currentPassword: "initial-owner-password", newPassword: "replacement-owner-password" }) });
    expect(changed.status).toBe(200);
    expect(savedHash).toStartWith("scrypt$");
    expect((await app.request("/api/private", { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await app.request("/api/auth/login", login("initial-owner-password"))).status).toBe(401);
    expect((await app.request("/api/auth/login", login("replacement-owner-password"))).status).toBe(200);
  });
});
