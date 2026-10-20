// GET /admin  — your overview of every client (admins only; the edge gate also checks).
// GET /admin?preview=<slug>&t=20 — shows the alert email that client would get.
import { getStore } from "@netlify/blobs";
import { summarize, THRESHOLDS } from "../../public/assets/retainer.js";
import { listClients, readJSON, readSession, escapeHTML as h } from "../../lib/server.mjs";
import { buildAlertEmail } from "../../lib/alert-email.mjs";

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dShort = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STATUS = { over: "Overschreden", low: "Bijna op", fast: "Sneller dan gepland", slow: "Ruimte over", "on-track": "Op schema" };

export default async (req) => {
  const s = readSession(req, process.env.SESSION_SECRET || "");
  if (!s || s.r !== "admin") return new Response(null, { status: 303, headers: { Location: "/login" } });

  const url = new URL(req.url);
  const base = (process.env.PORTAL_URL || url.origin).replace(/\/$/, "");
  const clients = listClients();
  const users = readJSON("config/users.json", { clients: {} });

  const preview = url.searchParams.get("preview");
  if (preview) {
    const data = clients.find((c) => c.client.slug === preview);
    if (!data) return new Response("Onbekende klant", { status: 404 });
    const t = THRESHOLDS.includes(Number(url.searchParams.get("t"))) ? Number(url.searchParams.get("t")) : 20;
    const first = (users.clients?.[preview]?.[0]?.name || "").split(" ")[0];
    const mail = buildAlertEmail({ summary: summarize(data), threshold: t, firstName: first, portalUrl: `${base}/${preview}/`, logoUrl: `${base}/assets/studio-yukon.png` });
    return new Response(mail.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  let store = null, usage = null;
  try { store = getStore("retainer-alerts"); usage = getStore("portal-usage"); } catch {}
  const since = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  const rows = [];
  for (const data of clients.sort((a, b) => a.client.name.localeCompare(b.client.name))) {
    const m = summarize(data);
    const slug = data.client.slug;
    let alerts = null;
    try { alerts = store ? await store.get(slug, { type: "json" }) : null; } catch {}
    let use = null;
    try { use = usage ? await usage.get(slug, { type: "json" }) : null; } catch {}
    const d30 = Object.entries(use?.days || {}).filter(([d]) => d >= since(30));
    const views30 = d30.reduce((n, [, v]) => n + v, 0);
    const usageCell = use?.last
      ? `<span>${views30}× bekeken</span><small>${d30.length} ${d30.length === 1 ? "dag" : "dagen"} in 30 dagen · laatst ${dShort.format(new Date(use.last))}</small>`
      : `<span>Nog niet bekeken</span><small>Telt vanaf nu, zonder namen</small>`;
    const contacts = (users.clients?.[slug] || []).map((u) => `${h(u.name || u.email)}${u.notify === false ? " (geen meldingen)" : ""}`).join(", ") || "<em>Nog geen logins</em>";
    const pct = Math.max(0, Math.min(100, m.pctRemaining));
    rows.push(`<article class="row">
      <div class="who"><a href="/${h(slug)}/">${h(data.client.name)}</a>${data.example ? ' <span class="tag">voorbeeld</span>' : ""}<small>${contacts}</small></div>
      <div class="bar" title="${pct.toFixed(0)}% over"><i style="width:${pct}%"></i>${THRESHOLDS.map((t) => `<b style="left:${t}%"></b>`).join("")}</div>
      <div class="num"><strong>${eur.format(m.remaining)}</strong><small>van ${eur.format(m.budget)} · ${Math.round(m.pctRemaining)}%</small></div>
      <div class="meta"><span>${STATUS[m.status]}</span><small>${m.runOut ? `Op rond ${dShort.format(m.runOut)}` : "Geen verbruik"}</small></div>
      <div class="meta">${usageCell}</div>
      <div class="meta"><span>${alerts?.sent?.length ? `Verstuurd: ${alerts.sent.map((x) => x + "%").join(", ")}` : "Nog geen meldingen"}</span><small><a href="/admin?preview=${h(slug)}&t=20">Voorbeeldmail</a></small></div>
    </article>`);
  }

  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Overzicht · Studio Yukon</title><link rel="icon" href="/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#F4F4F2;--card:#fff;--fg:#141414;--muted:#6A6862;--line:#E2E0DB;--red:#ED1C24;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--card:#1B1A19;--fg:#F2F1EE;--muted:#A19E97;--line:#302E2B;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 Figtree,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.wrap{max-width:1100px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-right)) 48px max(16px,env(safe-area-inset-left));display:grid;gap:24px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
header img{width:120px;display:block}h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em}
a{color:inherit}.out{font-size:13px;font-weight:700;color:var(--muted);text-decoration:none;border:1px solid var(--line);padding:6px 10px}
.list{display:grid;gap:1px;background:var(--line);border:1px solid var(--line)}
.row{background:var(--card);display:grid;grid-template-columns:1.3fr 1.1fr .9fr .9fr .9fr 1fr;gap:18px;align-items:center;padding:16px 18px}
.row small{display:block;color:var(--muted);font-size:13px}.who a{font-weight:800;font-size:17px;text-decoration:none}
.tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border:1px solid var(--line);padding:1px 5px;color:var(--muted)}
.bar{position:relative;height:10px;background:var(--line)}.bar i{position:absolute;inset:0 auto 0 0;background:var(--fg)}
.bar b{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--red)}
.num strong{font-size:18px}.meta span{font-weight:600}
.hint{color:var(--muted);font-size:13px;margin:0}
@media (max-width:860px){.row{grid-template-columns:1fr 1fr}.who,.bar{grid-column:1/-1}}
</style></head><body><div class="wrap">
<header><div style="display:flex;gap:16px;align-items:center"><img src="/assets/studio-yukon.svg" alt="Studio Yukon"><h1>Retainers</h1></div><a class="out" href="/logout">Uitloggen</a></header>
<div class="list">${rows.join("") || '<article class="row"><div>Nog geen klanten. Vraag Claude om er een aan te maken.</div></article>'}</div>
<p class="hint">Rode streepjes zijn de meldmomenten bij 50%, 20% en 10% resterend. Meldingen gaan elk uur de deur uit zodra een grens is gepasseerd.</p>
</div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
};

export const config = { path: "/admin" };
