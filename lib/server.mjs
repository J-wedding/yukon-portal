// Shared helpers for the Netlify Functions (Node runtime).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COOKIE = "yk_session";
export const SESSION_DAYS = 14;
const SCRYPT = { N: 16384, r: 8, p: 1 };

// ---------- files bundled with included_files ----------
function roots() {
  const out = [process.cwd(), process.env.LAMBDA_TASK_ROOT].filter(Boolean);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) { out.push(dir); dir = path.dirname(dir); }
  return [...new Set(out)];
}

export function resolveFile(rel) {
  for (const root of roots()) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readJSON(rel, fallback = null) {
  const p = resolveFile(rel);
  return p ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
}

export function listClients() {
  const dir = resolveFile("public/data");
  if (!dir) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

// ---------- users ----------
// Clients live in config/users.json (managed by scripts/portal.mjs).
// Admins live in the PORTAL_ADMINS env var: "you@studioyukon.com=scrypt$..$..,other@...=scrypt$.."
export function findUser(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  // Each admin entry is "email" (login link only) or "email=scrypt$..." (link or password).
  for (const pair of String(process.env.PORTAL_ADMINS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = pair.indexOf("=");
    const addr = (i > 0 ? pair.slice(0, i) : pair).trim().toLowerCase();
    if (addr === e) return { email: e, name: "", role: "admin", client: null, password: i > 0 ? pair.slice(i + 1).trim() : null };
  }
  const users = readJSON("config/users.json", { clients: {} });
  for (const [client, list] of Object.entries(users.clients || {})) {
    const u = list.find((x) => x.email.toLowerCase() === e);
    if (u) return { ...u, email: e, role: "client", client };
  }
  return null;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored || "").split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
  return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
}

// ---------- session cookie (same format the edge function verifies) ----------
export function signSession(data, secret) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSession(req, secret) {
  const raw = req.headers.get("cookie") || "";
  const token = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

export function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

export function sessionCookie(user, secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = signSession({ e: user.email, r: user.role, c: user.client, exp }, secret);
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export const homeFor = (user) => (user.role === "admin" ? "/admin" : `/${user.client}/`);

// Only follow a "next" that stays inside what this user may see.
export function safeNext(next, user) {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return null;
  if (user.role === "admin") return next;
  return next.startsWith(`/${user.client}/`) ? next : null;
}

export function clientBrand(slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  return readJSON(`public/assets/clients/${slug}.json`, null);
}

export const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
