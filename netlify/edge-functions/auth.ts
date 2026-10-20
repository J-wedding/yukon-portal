// The gate. Runs at the edge in front of every page and data file.
//
//   /                    -> your own dashboard (admins: the overview)
//   /<client>/           -> dashboard, only for that client's contacts (or an admin)
//   /data/<client>.json  -> hours + budget, same rule
//   /admin               -> overview of all clients, admins only
//   /logout              -> clears the session
//
// The session cookie is signed by netlify/functions/login.mjs:
// { e: email, r: "client" | "admin", c: client slug or null, exp }
import type { Config, Context } from "https://edge.netlify.com";

const COOKIE = "yk_session";
const enc = new TextEncoder();
const dec = new TextDecoder();

type Session = { e: string; r: "client" | "admin"; c: string | null; exp: number };

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function readSession(token: string | null, secret: string): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(payload)))) return null;
    const data = JSON.parse(dec.decode(fromB64url(payload)));
    if (typeof data.e !== "string" || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

const redirect = (to: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...extra } });

function notFound() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Niet gevonden</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f4f2;color:#141414}main{padding:24px}a{color:#ed1c24}</style>
<main><p>Deze pagina bestaat niet.</p><p><a href="/">Terug naar je dashboard</a></p></main>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const secret = Netlify.env.get("SESSION_SECRET");
  if (!secret) return new Response("SESSION_SECRET is missing in the Netlify environment variables.", { status: 500 });

  if (path === "/logout") {
    return redirect("/login", { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  }

  const s = await readSession(getCookie(req, COOKIE), secret);
  const home = s ? (s.r === "admin" ? "/admin" : `/${s.c}/`) : "/login";

  if (path === "/login" || path === "/login/") {
    if (s) return redirect(home);
    return new URL("/login.html", req.url);
  }

  if (!s) {
    if (path.startsWith("/data/")) return new Response("Unauthorized", { status: 401 });
    return redirect(path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);
  }

  const isAdmin = s.r === "admin";
  const canSee = (slug: string) => isAdmin || slug === s.c;

  if (path === "/") return redirect(home);

  if (path === "/admin" || path === "/admin/") {
    if (!isAdmin) return redirect(home);
    return context.next();
  }

  const data = path.match(/^\/data\/([a-z0-9-]+)\.json$/);
  if (data) {
    if (!canSee(data[1])) return new Response("Forbidden", { status: 403 });
    const res = await context.next();
    // Usage counter for /admin: one view per data load, per client, no names. Admin views are skipped.
    if (!isAdmin && res.ok) {
      const key = await sha256hex("seen:" + secret);
      const ping = fetch(new URL("/api/seen", req.url), { method: "POST", headers: { "x-yk-key": key, "content-type": "application/json" }, body: JSON.stringify({ c: data[1] }) }).catch(() => {});
      (context as any).waitUntil ? (context as any).waitUntil(ping) : await ping;
    }
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "no-store");
    return out;
  }

  const dash = path.match(/^\/([a-z0-9-]+)\/?$/);
  if (dash) {
    if (!canSee(dash[1])) return redirect(home);
    if (!path.endsWith("/")) return redirect(`/${dash[1]}/`);
    return new URL("/dashboard.html", req.url);
  }

  return notFound();
};

export const config: Config = {
  path: "/*",
  excludedPath: ["/login.html", "/dashboard.html", "/assets/*", "/api/*", "/auth", "/favicon.svg"],
};
