// GET  /auth?t=...   shows a confirm page. It does NOT log in, so mail scanners
//                    that open links (Microsoft Defender, Mimecast) cannot use up the link.
// POST /api/auth     the "Inloggen" button. Uses the link once and sets the session.
import { findUser, sessionCookie, homeFor, safeNext, sha256, clientBrand, escapeHTML as h } from "../../lib/server.mjs";
import { store } from "../../lib/stores.mjs";

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

  if (req.method === "GET" && url.pathname === "/auth") {
    const t = url.searchParams.get("t") || "";
    const rec = await readToken(t);
    if (!rec) return expired();
    const user = findUser(rec.email);
    if (!user) return expired();
    const brand = user.client ? clientBrand(user.client) : null;
    return html(200, page({
      brand,
      title: brand ? `Inloggen bij ${brand.name}` : "Inloggen",
      lead: `Je logt in als <strong>${h(user.email)}</strong>.`,
      form: `<form method="post" action="/api/auth"><input type="hidden" name="t" value="${h(t)}"><button type="submit">Inloggen</button></form>`,
    }));
  }

  if (req.method === "POST" && url.pathname === "/api/auth") {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return new Response("SESSION_SECRET missing", { status: 500 });
    const form = await req.formData();
    const t = String(form.get("t") || "");
    const rec = await readToken(t);
    if (!rec) return expired();
    await store("login-tokens").delete(sha256(t));
    const user = findUser(rec.email);
    if (!user) return expired();
    return new Response(null, {
      status: 303,
      headers: { Location: safeNext(rec.next, user) || homeFor(user), "Set-Cookie": sessionCookie(user, secret), "Cache-Control": "no-store" },
    });
  }

  return new Response("Not found", { status: 404 });
};

export const config = { path: ["/auth", "/api/auth"] };
