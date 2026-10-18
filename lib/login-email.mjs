// The email with a login link.
import { escapeHTML as h } from "./server.mjs";

export function buildLoginEmail({ link, clientName, firstName, logoUrl, minutes = 15 }) {
  const where = clientName ? `de retainer van ${clientName}` : "de Studio Yukon portal";
  const hi = firstName ? `Hoi ${firstName},` : "Hoi,";
  const subject = clientName ? `Je inloglink voor de retainer van ${clientName}` : "Je inloglink voor de Studio Yukon portal";

  const text = [
    hi, "",
    `Met deze link log je in op ${where}:`, link, "",
    `De link werkt ${minutes} minuten. Daarna blijf je 14 dagen ingelogd op dit apparaat.`, "",
    "Heb je deze link niet aangevraagd? Dan kun je deze mail negeren. Er gebeurt niets.", "",
    "Studio Yukon",
  ].join("\n");

  const html = `<!doctype html><html lang="nl"><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff">
<tr><td style="padding:28px 32px 0"><img src="${h(logoUrl)}" width="110" height="43" alt="Studio Yukon" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.55">
<p style="margin:0 0 14px">${h(hi)}</p>
<p style="margin:0 0 24px">Met de knop hieronder log je in op ${h(where)}.</p>
<p style="margin:0 0 24px"><a href="${h(link)}" style="display:inline-block;background:#141414;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px">Inloggen</a></p>
<p style="margin:0 0 14px;color:#6a6862;font-size:14px">De link werkt ${minutes} minuten. Daarna blijf je 14 dagen ingelogd op dit apparaat.</p>
<p style="margin:0 0 8px;color:#6a6862;font-size:14px">Heb je deze link niet aangevraagd? Dan kun je deze mail negeren. Er gebeurt niets.</p>
</td></tr>
<tr><td style="padding:20px 32px 28px;font-size:12px;color:#8a8882;border-top:1px solid #eeeeeb">Werkt de knop niet? Kopieer dan deze link in je browser:<br><span style="word-break:break-all">${h(link)}</span></td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
