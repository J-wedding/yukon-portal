// POST /api/seen  (called only by the edge gate, never by the browser)
// Counts dashboard views per client per day. No names, no email addresses: only "vandebron, 2026-10-20, 3 views".
// Admin views are not counted. Used for the usage column in /admin.
import { store } from "../../lib/stores.mjs";
import { sha256 } from "../../lib/server.mjs";

const KEEP_DAYS = 400;

export default async (req) => {
  const secret = process.env.SESSION_SECRET;
  if (req.method !== "POST" || !secret || req.headers.get("x-yk-key") !== sha256("seen:" + secret)) return new Response("Not found", { status: 404 });
  let slug = "";
  try { slug = String((await req.json()).c || ""); } catch {}
  if (!/^[a-z0-9-]+$/.test(slug)) return new Response("Bad request", { status: 400 });
  const s = store("portal-usage");
  const rec = (await s.get(slug, { type: "json" })) || { days: {} };
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  rec.days[day] = (rec.days[day] || 0) + 1;
  rec.last = now.toISOString();
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(rec.days)) if (d < cutoff) delete rec.days[d];
  await s.setJSON(slug, rec);
  return new Response(null, { status: 204 });
};

export const config = { path: "/api/seen" };
