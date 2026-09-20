import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

type PasswordStore = { getHash: () => string | null; saveHash: (hash: string) => void };

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

function verifyHash(password: string, encoded: string) {
  const [scheme, saltText, hashText] = encoded.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = scryptSync(password, Buffer.from(saltText, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function installSecurity(app: Hono, password: string, production = false, store?: PasswordStore) {
  const sessions = new Map<string, number>();
  const sessionLifetime = 12 * 60 * 60 * 1000;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  let failures: number[] = [];
  const storedHash = () => store?.getHash() ?? null;
  const passwordRequired = () => Boolean(storedHash() || password);
  const matchesPassword = (candidate: string) => {
    const persisted = storedHash();
    if (persisted) return verifyHash(candidate, persisted);
    return Boolean(password) && timingSafeEqual(digest(candidate), digest(password));
  };
  const authenticated = (token: string | undefined) => {
    if (!passwordRequired()) return true;
    const expiry = token ? sessions.get(token) : undefined;
    if (token && expiry && expiry > Date.now()) return true;
    if (token) sessions.delete(token);
    return false;
  };

  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    if (production) c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!passwordRequired() && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.req.url).hostname)) return c.json({ error: "Local-only mode requires a loopback hostname." }, 403);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      if (origin) { try { if (new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "Cross-origin writes are not allowed." }, 403); } catch { return c.json({ error: "Invalid request origin." }, 403); } }
    }
    if (["/api/health", "/api/auth/status", "/api/auth/login"].includes(c.req.path)) return next();
    if (!authenticated(getCookie(c, "sumplog_session"))) return c.json({ error: "Your session ended. Sign in again." }, 401);
    return next();
  });
  app.get("/api/auth/status", (c) => c.json({ required: passwordRequired(), authenticated: authenticated(getCookie(c, "sumplog_session")) }));
  app.post("/api/auth/login", async (c) => {
    failures = failures.filter((time) => Date.now() - time < 15 * 60 * 1000);
    if (failures.length >= 10) { c.header("Retry-After", "900"); return c.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429); }
    const body = await c.req.json().catch(() => null);
    if (!passwordRequired() || typeof body?.password !== "string" || body.password.length > 1000 || !matchesPassword(body.password)) {
      failures.push(Date.now());
      return c.json({ error: "Incorrect password." }, 401);
    }
    failures = [];
    for (const [token, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(token);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + sessionLifetime);
    setCookie(c, "sumplog_session", token, { httpOnly: true, sameSite: "Strict", secure: production, path: "/", maxAge: sessionLifetime / 1000 });
    return c.json({ ok: true });
  });
  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, "sumplog_session"); if (token) sessions.delete(token);
    deleteCookie(c, "sumplog_session", { path: "/", secure: production, httpOnly: true, sameSite: "Strict" });
    return c.json({ ok: true });
  });
  app.post("/api/auth/password", async (c) => {
    if (!store) return c.json({ error: "Password changes are unavailable on this server." }, 409);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.currentPassword !== "string" || typeof body?.newPassword !== "string" || body.newPassword.length < 12 || body.newPassword.length > 1000) return c.json({ error: "Use a new password between 12 and 1000 characters." }, 400);
    if (!matchesPassword(body.currentPassword)) return c.json({ error: "Current password is incorrect." }, 401);
    store.saveHash(hashPassword(body.newPassword));
    sessions.clear();
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + sessionLifetime);
    setCookie(c, "sumplog_session", token, { httpOnly: true, sameSite: "Strict", secure: production, path: "/", maxAge: sessionLifetime / 1000 });
    return c.json({ ok: true });
  });
}
