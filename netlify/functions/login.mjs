// POST /api/login
// Default: email only. If the address is known, a single-use login link goes to it.
// Fallback: email + password, for accounts that have one (usually only admins).
// The answer is the same whether or not the address is known, so nobody can probe for clients.
import crypto from "node:crypto";
import { findUser, verifyPassword, sessionCookie, homeFor, safeNext, sha256, clientBrand } from "../../lib/server.mjs";
import { store } from "../../lib/stores.mjs";
import { sendMail } from "../../lib/mail.mjs";
import { buildLoginEmail } from "../../lib/login-email.mjs";

export const LINK_MINUTES = 15;
const RATE = { max: 5, windowMin: 15 };
const DUMMY = "scrypt$00000000000000000000000000000000$" + "0".repeat(64);

const redirect = (location, cookie) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });

function back(params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `/login?${q}`;
}

async function allowed(email) {
  const s = store("login-rate");
  const key = sha256(email);
  const now = Date.now();
  const cur = (await s.get(key, { type: "json" })) || { n: 0, t: now };
  const fresh = now - cur.t > RATE.windowMin * 60000 ? { n: 0, t: now } : cur;
  if (fresh.n >= RATE.max) return false;
  await s.setJSON(key, { n: fresh.n + 1, t: fresh.t });
  return true;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = process.env.SESSION_SECRET;
  if (!secret) return new Response("Portal is not configured: SESSION_SECRET missing.", { status: 500 });

  const form = await req.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const next = String(form.get("next") || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect(back({ e: "email", next }));

  const user = findUser(email);

  // Password fallback
  if (password) {
    const ok = verifyPassword(password, user?.password || DUMMY) && Boolean(user?.password);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 400));
      return redirect(back({ e: "1", mode: "password", email, next }));
    }
    return redirect(safeNext(next, user) || homeFor(user), sessionCookie(user, secret));
  }

  // Login link
  if (!(await allowed(email))) return redirect(back({ e: "rate", email, next }));
  if (user) {
    const token = crypto.randomBytes(32).toString("base64url");
    const exp = Date.now() + LINK_MINUTES * 60000;
    await store("login-tokens").setJSON(sha256(token), { email: user.email, next, exp });
    const base = (process.env.PORTAL_URL || new URL(req.url).origin).replace(/\/$/, "");
    const brand = user.client ? clientBrand(user.client) : null;
    const mail = buildLoginEmail({
      link: `${base}/auth?t=${token}`,
      clientName: brand?.name || null,
      firstName: (user.name || "").split(" ")[0],
      logoUrl: `${base}/assets/studio-yukon.png`,
      minutes: LINK_MINUTES,
    });
    try {
      await sendMail({ to: user.email, ...mail });
    } catch (err) {
      console.error("login mail failed", err.message);
      return redirect(back({ e: "mail", email, next }));
    }
  } else {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
  }
  return redirect(back({ sent: "1", email, next }));
};

export const config = { path: "/api/login" };
