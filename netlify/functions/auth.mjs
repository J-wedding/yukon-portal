// GET /auth?t=...  logs in with the link from the email (valid 15 minutes, a few uses, see MAX_USES).
import { findUser, firstName, sessionCookie, homeFor, safeNext, sha256, clientBrand, escapeHTML as h } from "../../lib/server.mjs";
import { store } from "../../lib/stores.mjs";

const MAX_USES = 5;
const html = (status, body) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

function page({ title, lead, form = "", brand }) {
  const ink = brand?.brandDeep || "#141414";
  const soft = brand?.brandSoft || "#F4F4F2";
  const logo = brand?.logo?.endsWith(".svg") ? `<img src="${h(brand.logo)}" alt="${h(brand.name)}" class="client">` : "";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>${h(title)} · Studio Yukon</title><link rel="icon" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--bg:${h(soft)};--card:#fff;--fg:#141414;--muted:#6A6862;--ink:${h(ink)};color-scheme:light}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 Figtree,system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
main{width:100%;max-width:420px;background:var(--card);padding:32px;display:grid;gap:22px;border-radius:${brand?.radius ?? 0}px}
.logos{display:flex;align-items:center;gap:14px}.logos .client{height:22px;width:auto}.logos .yk{width:72px;height:auto;display:block}
h1{margin:0;font-size:26px;font-weight:900;letter-spacing:-.03em;line-height:1.1;text-wrap:balance}p{margin:0;color:var(--muted)}
strong{color:var(--fg)}
button,.btn{font:inherit;font-weight:800;font-size:16px;padding:15px 18px;border:0;background:var(--ink);color:#fff;cursor:pointer;width:100%;text-align:center;text-decoration:none;display:block;border-radius:${brand?.radius ? 999 : 0}px}
button:focus-visible,.btn:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
</style></head><body><main>
<div class="logos">${logo}<img class="yk" src="/assets/studio-yukon.svg" alt="Studio Yukon"></div>
<div style="display:grid;gap:8px"><h1>${h(title)}</h1><p>${lead}</p></div>
${form}
</main></body></html>`;
}

async function readToken(t) {
  if (!t || t.length < 20) return null;
  const rec = await store("login-tokens").get(sha256(t), { type: "json" });
  if (!rec || rec.exp < Date.now()) return null;
  return rec;
}

const expired = () =>
  html(410, page({
    title: "Deze link werkt niet meer",
    lead: "De link is al gebruikt of ouder dan 15 minuten. Vraag een nieuwe aan. Dat duurt een paar seconden.",
    form: `<a class="btn" href="/login">Nieuwe link aanvragen</a>`,
  }));

export default async (req) => {
  const url = new URL(req.url);

  // The link logs in straight away. It works up to MAX_USES times within its 15 minutes instead of once,
  // so a mail scanner that opens it first (Microsoft Defender, Mimecast) does not use it up for the client.
  // POST /api/auth stays for links sent before this change.
  if ((req.method === "GET" && url.pathname === "/auth") || (req.method === "POST" && url.pathname === "/api/auth")) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return new Response("SESSION_SECRET missing", { status: 500 });
    const t = req.method === "GET" ? url.searchParams.get("t") || "" : String((await req.formData()).get("t") || "");
    const rec = await readToken(t);
    if (!rec) return expired();
    const uses = (rec.uses || 0) + 1;
    if (uses >= MAX_USES) await store("login-tokens").delete(sha256(t));
    else await store("login-tokens").setJSON(sha256(t), { ...rec, uses });
    const user = findUser(rec.email);
    if (!user) return expired();
    const headers = new Headers({ Location: safeNext(rec.next, user) || homeFor(user), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", sessionCookie(user, secret));
    // One-time greeting on the dashboard ("Hey Aafke"). Readable by the page, holds only a first name,
    // lives two minutes and is cleared as soon as the dashboard has shown it.
    const first = firstName(user);
    headers.append("Set-Cookie", `yk_hello=${encodeURIComponent(first || "-")}; Path=/; Max-Age=120; Secure; SameSite=Lax`);
    return new Response(null, { status: 303, headers });
  }

  return new Response("Not found", { status: 404 });
};

export const config = { path: ["/auth", "/api/auth"] };
