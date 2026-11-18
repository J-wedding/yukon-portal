// The email a client gets when their remaining budget drops to 50%, 20% or 10%.
import { escapeHTML as h } from "./server.mjs";

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
const dLong = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// One text for every threshold. Only the percentage changes, plus one extra line at 0%.
const COPY = {
  subject: (c, t) => `${100 - t}% van de retainer van ${c} is verbruikt`,
  lead: (t) => [`Graag houden we je even op de hoogte. Op dit moment hebben we ${100 - t}% van de retainer verbruikt.`, "Hieronder kan je de urenspecificatie bekijken."],
  empty: "Werk dat nu loopt maken we af. Die uren verrekenen we met de volgende aanvulling. Nieuwe aanvragen pakken we op zodra de retainer is aangevuld.",
  ask: "Mocht je de retainer willen aanvullen, dan kan dat natuurlijk altijd.",
};

const SITE = "https://studioyukon.com";

export function buildAlertEmail({ summary, threshold, firstName, portalUrl, logoUrl, signature = "Jordy" }) {
  const c = summary.client.name;
  const t = threshold;
  const pct = Math.max(0, Math.round(summary.pctRemaining));
  const rows = [
    ["Resterend", eur.format(summary.remaining)],
    ["Totaal gestort", eur.format(summary.budget)],
    ["Besteed", `${eur.format(summary.spent)} (${num.format(summary.hours)} uur)`],
  ];
  const hi = firstName ? `Hey ${firstName},` : "Hey,";
  const lead = COPY.lead(t);
  const after = t === 0 ? [COPY.empty, COPY.ask] : [COPY.ask];
  const topupUrl = `${portalUrl}?aanvullen=1`;
  // At 50% and 20% the hours are the main button. At 10% and 0% topping up is.
  const topupFirst = t <= 10;

  const text = [
    hi, "", ...lead.flatMap((l) => [l, ""]),
    ...rows.map(([k, v]) => `${k}: ${v}`), "",
    `Alle uren per project: ${portalUrl}`,
    `Retainer aanvullen: ${topupUrl}`, "",
    ...after.flatMap((l) => [l, ""]),
    "Groet,", "", signature, `Studio Yukon (${SITE})`,
  ].join("\n");

  const solid = "display:inline-block;background:#ED1C24;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border:2px solid #ED1C24";
  const ghost = "display:inline-block;background:#ffffff;color:#141414;text-decoration:none;font-weight:bold;padding:12px 20px;border:2px solid #141414";
  const hoursBtn = (st) => `<a href="${h(portalUrl)}" style="${st}">Bekijk je uren per project</a>`;
  const topupBtn = (st) => `<a href="${h(topupUrl)}" style="${st}">Retainer aanvullen</a>`;
  const buttons = topupFirst
    ? [topupBtn(solid), hoursBtn(ghost)]
    : [hoursBtn(solid), topupBtn(ghost)];

  const html = `<!doctype html><html lang="nl"><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff">
<tr><td style="padding:28px 32px 0"><img src="${h(logoUrl)}" width="120" height="47" alt="Studio Yukon" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.55">
<p style="margin:0 0 16px">${h(hi)}</p>
${lead.map((l, i) => `<p style="margin:0 0 ${i === lead.length - 1 ? 24 : 16}px">${h(l)}</p>`).join("")}
</td></tr>
<tr><td style="padding:0 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141414;color:#ffffff">
<tr><td style="padding:22px 24px 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#bdbdbd">Nog over</td></tr>
<tr><td style="padding:0 24px 4px;font-size:40px;font-weight:bold;line-height:1.1">${pct}%</td></tr>
<tr><td style="padding:0 24px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="height:8px;background:#ED1C24;width:${100 - pct}%;font-size:0;line-height:0">&nbsp;</td>
${pct > 0 ? `<td style="height:8px;background:#3a3a3a;font-size:0;line-height:0">&nbsp;</td>` : ""}
</tr></table></td></tr>
</table></td></tr>
<tr><td style="padding:16px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e6e6e3;color:#6a6862">${h(k)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e6e6e3;font-weight:bold">${h(v)}</td></tr>`).join("")}
</table></td></tr>
<tr><td style="padding:20px 32px 8px;font-size:15px;line-height:1.55">
<p style="margin:0 0 24px;line-height:3">${buttons.join("&nbsp;&nbsp;")}</p>
${after.map((l) => `<p style="margin:0 0 16px">${h(l)}</p>`).join("")}
<p style="margin:24px 0 16px">Groet,</p>
<p style="margin:0">${h(signature)}<br><a href="${SITE}" style="color:#141414">Studio Yukon</a></p>
</td></tr>
<tr><td style="padding:28px 32px 28px;font-size:12px;color:#8a8882;border-top:1px solid #eeeeeb">Je ontvangt deze mail omdat je contactpersoon bent voor de retainer van ${h(c)}. Meldingen gaan uit bij 50%, 20% en 10% resterend budget en als de retainer op is.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: COPY.subject(c, t), text, html };
}
