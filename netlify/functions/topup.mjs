// /api/topup  A logged-in client contact asks to top up the retainer.
//   GET  -> { pending: { amount, at, name } | null } for the dashboard
//   POST -> { amount, reference } : emails Jordy, stores the request as pending
// Nothing is invoiced or added automatically. Jordy checks, sends the invoice and logs the
// deposit with `node scripts/portal.mjs deposit`. A higher budget clears the pending request.
// Admins can test it: their request is mailed (marked as test) but never stored.
import { readSession, readJSON, findUser, firstName, escapeHTML as h } from "../../lib/server.mjs";
import { store } from "../../lib/stores.mjs";
import { sendMail } from "../../lib/mail.mjs";
import { summarize } from "../../public/assets/retainer.js";

const MIN = 500, MAX = 50000, PER_DAY = 3, KEEP_DAYS = 60;
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function owner() {
  const admin = String(process.env.PORTAL_ADMINS || "").split(",")[0]?.split("=")[0]?.trim();
  return process.env.ALERT_BCC || process.env.MAIL_REPLY_TO || admin || null;
}

function clean(s, max) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export default async (req) => {
  const secret = process.env.SESSION_SECRET;
  const s = secret ? readSession(req, secret) : null;
  if (!s) return json(401, { error: "Je sessie is verlopen. Log opnieuw in." });

  const url = new URL(req.url);
  const isAdmin = s.r === "admin";
  const slug = isAdmin ? String(url.searchParams.get("c") || "") : s.c;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return json(400, { error: "Onbekende klant." });
  const data = readJSON(`public/data/${slug}.json`, null);
  if (!data) return json(404, { error: "Onbekende klant." });
  const summary = summarize(data);
  const requests = store("topup-requests");

  const current = async () => {
    const rec = await requests.get(slug, { type: "json" });
    if (!rec) return null;
    const stale = Date.now() - Date.parse(rec.at) > KEEP_DAYS * 864e5;
    if (stale || summary.budget > rec.budget) return null; // paid and logged, or too old to matter
    return rec;
  };

  if (req.method === "GET") {
    const rec = await current();
    return json(200, { pending: rec ? { amount: rec.amount, at: rec.at, name: rec.name } : null });
  }

  if (req.method !== "POST") return json(405, { error: "Niet toegestaan." });
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return json(403, { error: "Niet toegestaan." });
  if (data.example) return json(400, { error: "Dit is een voorbeeldomgeving." });

  let body = {};
  try { body = await req.json(); } catch {}
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < MIN || amount > MAX) {
    return json(400, { error: `Kies een bedrag tussen ${eur.format(MIN)} en ${eur.format(MAX)}.` });
  }
  const reference = clean(body.reference, 80);
  const to = owner();
  if (!to) return json(500, { error: "Aanvragen werkt nog niet. Neem contact op met Studio Yukon." });

  // At most a few requests per client per day, so a double click or a loop can't flood the inbox.
  const day = new Date().toISOString().slice(0, 10);
  const rate = store("topup-rate");
  const count = (await rate.get(`${slug}:${day}`, { type: "json" })) || 0;
  if (!isAdmin && count >= PER_DAY) return json(429, { error: "Er zijn vandaag al meerdere aanvragen gedaan. Neem contact op met Studio Yukon." });

  const user = isAdmin ? { email: s.e, name: "" } : findUser(s.e) || { email: s.e, name: "" };
  const name = user.name || firstName(user) || user.email;
  const client = data.client?.name || slug;
  const test = isAdmin ? "[Test] " : "";

  const lines = [
    ["Klant", client],
    ["Aangevraagd door", `${name} <${user.email}>`],
    ["Bedrag", eur.format(amount)],
    ["PO-nummer of referentie", reference || "Niet ingevuld"],
    ["Stand nu", `${eur.format(summary.remaining)} van ${eur.format(summary.budget)} (${Math.round(summary.pctRemaining)}% over)`],
  ];
  const cmd = `node scripts/portal.mjs deposit ${slug} --amount ${amount} --label "Aanvulling"`;
  const text = [
    `${test}${name} wil de retainer van ${client} aanvullen.`, "",
    ...lines.map(([k, v]) => `${k}: ${v}`), "",
    "Er is nog niets gefactureerd of toegevoegd. Check het verzoek en stuur de factuur.",
    `Na betaling: ${cmd}`,
    "Antwoorden op deze mail gaan naar de aanvrager.",
  ].join("\n");
  const html = `<!doctype html><html lang="nl"><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#141414;font-size:15px;line-height:1.55">
<p style="margin:0 0 16px"><strong>${h(test)}${h(name)}</strong> wil de retainer van ${h(client)} aanvullen.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 16px">
${lines.map(([k, v]) => `<tr><td style="padding:6px 24px 6px 0;color:#6a6862">${h(k)}</td><td style="padding:6px 0;font-weight:bold">${h(v)}</td></tr>`).join("")}
</table>
<p style="margin:0 0 8px">Er is nog niets gefactureerd of toegevoegd. Check het verzoek en stuur de factuur.</p>
<p style="margin:0 0 8px">Na betaling: <code>${h(cmd)}</code></p>
<p style="margin:0;color:#6a6862">Antwoorden op deze mail gaan naar de aanvrager.</p>
</body></html>`;

  try {
    await sendMail({ to, replyTo: user.email, subject: `${test}Aanvulverzoek ${client}: ${eur.format(amount)}`, text, html });
  } catch (err) {
    console.error("topup mail failed", err.message);
    return json(502, { error: "Je aanvraag kon niet worden verstuurd. Probeer het later opnieuw of mail Studio Yukon." });
  }

  const rec = { amount, reference, email: user.email, name, at: new Date().toISOString(), budget: summary.budget };
  if (!isAdmin) {
    await rate.setJSON(`${slug}:${day}`, count + 1);
    await requests.setJSON(slug, rec);
  }
  return json(200, { pending: { amount, at: rec.at, name }, test: isAdmin });
};

export const config = { path: "/api/topup" };
