// The email a client gets when their remaining budget drops to 50%, 20% or 10%.
import { escapeHTML as h } from "./server.mjs";

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
const dLong = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const COPY = {
  50: {
    subject: (c) => `De helft van het retainerbudget van ${c} is besteed`,
    lead: () => ["Graag houden we je even op de hoogte. Op dit moment hebben we 50% van de retainer verbruikt.", "Hieronder kan je de urenspecificatie bekijken."],
    forecast: false,
    ask: "Mocht je de retainer willen aanvullen, dan kan dat natuurlijk altijd.",
  },
  20: {
    subject: (c) => `Nog 20% van het retainerbudget van ${c}`,
    lead: (c) => [`Van het retainerbudget van ${c} is nog een vijfde over.`],
    forecast: true,
    ask: "Wil je het werk zonder onderbreking laten doorlopen? Antwoord op deze mail met het bedrag dat je wilt aanvullen. Dan stuur ik de factuur.",
  },
  10: {
    subject: (c) => `Nog 10% van het retainerbudget van ${c}`,
    lead: (c) => [`Het retainerbudget van ${c} is bijna op. Er is nog 10% over.`],
    forecast: true,
    ask: "Antwoord op deze mail met het bedrag dat je wilt aanvullen. Zo blijft er capaciteit klaarstaan voor de volgende aanvraag.",
  },
};

const SITE = "https://studioyukon.com";

export function buildAlertEmail({ summary, threshold, firstName, portalUrl, logoUrl, signature = "Jordy" }) {
  const c = summary.client.name;
  const copy = COPY[threshold];
  const forecast = summary.runOut && summary.runOut <= summary.end
    ? `Bij het huidige tempo is het budget rond ${dLong.format(summary.runOut)} op.`
    : `Bij het huidige tempo loopt het budget door tot het einde van de periode.`;
  const pct = Math.max(0, Math.round(summary.pctRemaining));
  const rows = [
    ["Resterend", eur.format(summary.remaining)],
    ["Totaal gestort", eur.format(summary.budget)],
    ["Besteed", `${eur.format(summary.spent)} (${num.format(summary.hours)} uur)`],
  ];
  const hi = firstName ? `Hey ${firstName},` : "Hey,";
  const lead = copy.lead(c);

  const text = [
    hi, "", ...lead.flatMap((l) => [l, ""]),
    ...rows.map(([k, v]) => `${k}: ${v}`), "",
    `Alle uren per project: ${portalUrl}`, "",
    ...(copy.forecast ? [forecast, ""] : []), copy.ask, "",
    "Groet,", "", signature, `Studio Yukon (${SITE})`,
  ].join("\n");

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
<td style="height:8px;background:#3a3a3a;font-size:0;line-height:0">&nbsp;</td>
</tr></table></td></tr>
</table></td></tr>
<tr><td style="padding:16px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e6e6e3;color:#6a6862">${h(k)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e6e6e3;font-weight:bold">${h(v)}</td></tr>`).join("")}
</table></td></tr>
<tr><td style="padding:20px 32px 8px;font-size:15px;line-height:1.55">
<p style="margin:0 0 24px"><a href="${h(portalUrl)}" style="display:inline-block;background:#ED1C24;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px">Bekijk je uren per project</a></p>
${copy.forecast ? `<p style="margin:0 0 14px">${h(forecast)}</p>` : ""}
<p style="margin:0 0 24px">${h(copy.ask)}</p>
<p style="margin:0 0 16px">Groet,</p>
<p style="margin:0">${h(signature)}<br><a href="${SITE}" style="color:#141414">Studio Yukon</a></p>
</td></tr>
<tr><td style="padding:28px 32px 28px;font-size:12px;color:#8a8882;border-top:1px solid #eeeeeb">Je ontvangt deze mail omdat je contactpersoon bent voor de retainer van ${h(c)}. Meldingen gaan uit bij 50%, 20% en 10% resterend budget.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: copy.subject(c), text, html };
}
